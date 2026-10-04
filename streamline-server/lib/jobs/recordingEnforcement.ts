/**
 * Recording maximum-length enforcement (every minute).
 *
 * For every recording with status "recording":
 *   - autoStopAt set (by /recordings/start from limits.recordingMinutesPerClip)
 *     and in the past -> stop it (reason "auto_cap").
 *   - autoStopAt missing (older recordings, or started while unlimited) ->
 *     compute it once from the billing owner's effective entitlements:
 *        limit null -> unlimited: marked autoStopEvaluated, never stopped
 *        limit 0    -> recording not allowed: stopped immediately
 *        limit N    -> autoStopAt = startedAt + N minutes (persisted)
 *
 * Bounded: at most `limit` (default 300) running recordings per run.
 * Idempotent: stopRecordingInternal flips status to "processing" and counts
 * minutes once, so a recording stopped by a concurrent manual stop or
 * webhook is not double-billed.
 */
import { firestore } from "../../firebaseAdmin";
import { getEffectiveEntitlements } from "../entitlements";
import { toMillis } from "../mediaPure";
import { recordingBillingUid } from "../recordingUsage";
import { defineJob } from "./framework";
import { boundedLimit, computeAutoStop, isPastAutoStop } from "./pure";

type Stopper = (opts: { recordingId: string; reason: "auto_cap" }) => Promise<void>;

async function defaultStopper(): Promise<Stopper> {
  // Lazy: routes/recordings pulls in the whole recording stack.
  const mod = await import("../../routes/recordings.js");
  return (o) => mod.stopRecordingInternal({ recordingId: o.recordingId, reason: o.reason });
}

export async function enforceRecordingLimits(
  now: Date,
  opts: { limit?: number; stop?: Stopper } = {}
): Promise<{ considered: number; stopped: number; computed: number; errors: number; stoppedIds: string[] }> {
  const nowMs = now.getTime();
  const limit = boundedLimit(opts.limit, 300, 1000);
  const snap = await firestore.collection("recordings").where("status", "==", "recording").limit(limit).get();

  const out = { considered: 0, stopped: 0, computed: 0, errors: 0, stoppedIds: [] as string[] };
  if (snap.empty) return out;

  let stop: Stopper | null = opts.stop ?? null;
  const limitCache = new Map<string, number | null>();

  for (const doc of snap.docs) {
    out.considered += 1;
    const data = (doc.data() || {}) as any;
    let autoStopAtMs = toMillis(data.autoStopAt);
    let mustStop = false;

    try {
      if (autoStopAtMs === null && data.autoStopEvaluated !== true) {
        const uid = recordingBillingUid(data);
        if (uid) {
          let clipLimit: number | null;
          if (limitCache.has(uid)) {
            clipLimit = limitCache.get(uid)!;
          } else {
            const ent = await getEffectiveEntitlements(uid);
            const raw = ent?.limits?.recordingMinutesPerClip;
            clipLimit = raw === null || raw === undefined ? null : Number(raw);
            limitCache.set(uid, clipLimit);
          }
          const startedAtMs = toMillis(data.startedAt) ?? toMillis(data.createdAt);
          const decision = computeAutoStop(startedAtMs, clipLimit);
          if (decision.kind === "at") {
            autoStopAtMs = decision.autoStopAtMs;
            await doc.ref.set(
              { autoStopAt: new Date(autoStopAtMs), autoStopSource: "enforcement_job", maxRecordingMinutesPerClip: clipLimit, updatedAt: now },
              { merge: true }
            );
            out.computed += 1;
          } else if (decision.kind === "not_allowed") {
            mustStop = true;
            out.computed += 1;
          } else if (clipLimit === null) {
            // Unlimited plan: evaluate once, not every minute.
            await doc.ref.set({ autoStopEvaluated: true, autoStopEvaluatedAt: now }, { merge: true });
            out.computed += 1;
          }
        }
      }

      if (mustStop || isPastAutoStop(autoStopAtMs, nowMs)) {
        // Re-read: a manual stop / egress webhook may have finished it meanwhile
        // (stopping again would flip a "ready" recording back to "processing").
        const fresh = await doc.ref.get();
        if (String((fresh.data() as any)?.status || "") !== "recording") continue;
        if (!stop) stop = await defaultStopper();
        await stop({ recordingId: doc.id, reason: "auto_cap" });
        out.stopped += 1;
        out.stoppedIds.push(doc.id);
      }
    } catch (e: any) {
      out.errors += 1;
      console.error("[jobs/recording-enforcement] failed", { recordingId: doc.id, error: e?.message || e });
    }
  }

  return out;
}

export const recordingEnforcementJob = defineJob({
  name: "recording-enforcement",
  title: "Recording Enforcement",
  description:
    "Stops recordings past autoStopAt (plan limits.recordingMinutesPerClip; null = unlimited, 0 = stop immediately). Computes autoStopAt when missing.",
  intervalMs: 60_000,
  leaseMs: 5 * 60_000,
  recordNoopRuns: false,
  highlight: "stopped",
  async run(ctx) {
    const r = await enforceRecordingLimits(ctx.now, { limit: ctx.params.limit });
    return {
      processed: r.stopped,
      details: { stopped: r.stopped, considered: r.considered, autoStopComputed: r.computed, errors: r.errors, stoppedIds: r.stoppedIds },
      error: r.errors > 0 ? `${r.errors} recording(s) failed to stop` : null,
    };
  },
});
