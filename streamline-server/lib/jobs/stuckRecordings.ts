/**
 * Stuck recordings (every 10 minutes).
 *
 * A recording becomes ready when the egress_ended webhook or the one-shot
 * head-check 4s after Stop finds its file. Both can miss: the upload can take
 * longer than 4s, the head-check is lost on a restart, and recordings that end
 * with the room never get a Stop call. This job re-checks recordings that have
 * been "processing" for 10+ minutes and marks them ready when the file is in
 * storage (same code path as the head-check). After 6 hours without a file
 * they are marked failed, so the UI stops showing them as processing.
 *
 * Bounded (default 200 per run) and idempotent: finalization flips status and
 * storageCounted in a transaction.
 */
import { firestore } from "../../firebaseAdmin";
import { toMillis } from "../mediaPure";
import { mayApplyRecordingStatus, stuckRecordingAction } from "../recordingFinalizePure";
import { defineJob } from "./framework";
import { boundedLimit } from "./pure";

type Finalizer = (recordingId: string) => Promise<"ready" | "not_found" | "skipped">;

async function defaultFinalizer(): Promise<Finalizer> {
  // Lazy: routes/recordings pulls in the whole recording stack.
  const mod = await import("../../routes/recordings.js");
  return (id) => mod.finalizeRecordingIfUploaded(id, "stuck_sweep");
}

export async function sweepStuckRecordings(
  now: Date,
  opts: { limit?: number; finalize?: Finalizer } = {}
): Promise<{ considered: number; ready: number; failed: number; waiting: number; errors: number }> {
  const nowMs = now.getTime();
  const limit = boundedLimit(opts.limit, 200, 1000);
  const snap = await firestore.collection("recordings").where("status", "==", "processing").limit(limit).get();
  const out = { considered: 0, ready: 0, failed: 0, waiting: 0, errors: 0 };
  if (snap.empty) return out;
  const finalize = opts.finalize ?? (await defaultFinalizer());

  for (const doc of snap.docs) {
    out.considered += 1;
    const data = (doc.data() || {}) as any;
    const since = toMillis(data.endedAt) ?? toMillis(data.stoppedAt) ?? toMillis(data.updatedAt);
    const action = stuckRecordingAction(since, nowMs);
    if (action === "wait") {
      out.waiting += 1;
      continue;
    }
    try {
      const r = await finalize(doc.id);
      if (r === "ready") {
        out.ready += 1;
        continue;
      }
      if (action === "recheck_or_fail" && (r === "not_found" || !data.objectKey)) {
        const marked = await firestore.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          const status = (fresh.data() as any)?.status;
          if (!fresh.exists || status !== "processing" || !mayApplyRecordingStatus(status, "failed")) return false;
          tx.update(doc.ref, {
            status: "failed",
            downloadReady: false,
            errorMessage: "The recording file never arrived in storage.",
            updatedAt: now,
          });
          return true;
        });
        if (marked) out.failed += 1;
      }
    } catch (e: any) {
      out.errors += 1;
      console.warn("[jobs/stuck-recordings] failed", { recordingId: doc.id, error: e?.message || e });
    }
  }
  return out;
}

export const stuckRecordingsJob = defineJob({
  name: "stuck-recordings",
  title: "Stuck Recordings",
  description:
    "Finalizes recordings left in processing for 10+ minutes when their file is in storage; marks them failed after 6 hours without a file.",
  intervalMs: 10 * 60_000,
  highlight: "ready",
  async run(ctx) {
    const limit = ctx.params.limit !== undefined ? Number(ctx.params.limit) : undefined;
    const r = await sweepStuckRecordings(ctx.now, { limit });
    return { processed: r.ready + r.failed, details: r };
  },
});
