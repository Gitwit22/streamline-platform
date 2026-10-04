/**
 * Internal CLI (Stage 6b): consolidate content into the two working concepts
 *   Project    = projects (+ timeline v2 on the project doc)
 *   SavedVideo = saved_videos
 * NOT reachable over HTTP. Dry run by default; nothing is written unless
 * --apply is passed. Never deletes anything: legacy docs are only stamped
 * (migratedToProjectId / migratedToSavedVideoId) so re-runs are no-ops and
 * the runtime stops falling back to them.
 *
 *   npx tsx scripts/migrateContentToProjects.ts                  # dry run, all steps
 *   npx tsx scripts/migrateContentToProjects.ts --apply          # write
 *   npx tsx scripts/migrateContentToProjects.ts --only=editing_projects|timeline_clips|content_items
 *   npx tsx scripts/migrateContentToProjects.ts --limit=500      # cap docs per step
 *
 * Steps:
 *   1. editing_projects -> projects. Linked docs (projectId set by the old
 *      bridge) put their timeline on projects/{projectId} when it has none;
 *      standalone docs become projects/{sameId} so editor URLs keep working.
 *   2. timeline_clips (Layer 3) -> projects/{projectId}.timeline when the
 *      project still has no timeline (clips reference the saved video).
 *   3. content_items (recording references) -> saved_videos, skipped when a
 *      saved video for the same (userId, recording) exists.
 *
 * Runtime reads already fall back to (and lazily migrate) steps 1–2 per
 * project, so running this is safe at any time and only finishes the job.
 */
import { firestore } from "../firebaseAdmin";
import { contentItemToSavedVideo, projectNeedsTimeline } from "../lib/contentMigrationPure";
import { applyLayeredTimeline, loadLayeredTimeline, migrateEditingProjectSnap } from "../lib/projectStore";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const only = argv.find((a) => a.startsWith("--only="))?.split("=")[1] || "";
const limitArg = Number(argv.find((a) => a.startsWith("--limit="))?.split("=")[1]);
const LIMIT = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : 10_000;
const PAGE = 200;

const mode = APPLY ? "APPLY" : "DRY-RUN";

async function* pages(collection: string) {
  let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let seen = 0;
  while (seen < LIMIT) {
    let q = firestore.collection(collection).orderBy("__name__").limit(Math.min(PAGE, LIMIT - seen));
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    for (const d of snap.docs) yield d;
    seen += snap.size;
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) return;
  }
}

async function migrateEditingProjects() {
  const counts: Record<string, number> = { scanned: 0, create_project: 0, migrate_into_linked: 0, skip_already_migrated: 0, skip_no_owner: 0, applied: 0, not_applied: 0 };
  for await (const doc of pages("editing_projects")) {
    counts.scanned++;
    const { step, applied, reason } = await migrateEditingProjectSnap(doc, { apply: APPLY });
    counts[step.action] = (counts[step.action] || 0) + 1;
    if (step.action === "create_project" || step.action === "migrate_into_linked") {
      if (applied) counts.applied++;
      else if (APPLY) counts.not_applied++;
      console.log(
        `  [${APPLY ? (applied ? "write" : `skip:${reason}`) : "dry"}] editing_projects/${doc.id} -> projects/${step.targetProjectId}` +
          ` (${step.action}, clips=${step.timeline?.clips.length ?? 0})`,
      );
    }
  }
  return counts;
}

async function migrateLayered() {
  const counts = { clipDocs: 0, projects: 0, needsTimeline: 0, applied: 0, missingProject: 0 };
  const projectIds = new Set<string>();
  for await (const doc of pages("timeline_clips")) {
    counts.clipDocs++;
    const pid = (doc.data() as any)?.projectId;
    if (typeof pid === "string" && pid) projectIds.add(pid);
  }
  counts.projects = projectIds.size;
  for (const pid of projectIds) {
    const proj = await firestore.collection("projects").doc(pid).get();
    if (!proj.exists) {
      counts.missingProject++;
      console.log(`  [skip] timeline_clips for missing projects/${pid}`);
      continue;
    }
    if (!projectNeedsTimeline(proj.data())) continue;
    const timeline = await loadLayeredTimeline(pid);
    if (!timeline) continue;
    counts.needsTimeline++;
    console.log(`  [${APPLY ? "write" : "dry"}] timeline_clips -> projects/${pid}.timeline (clips=${timeline.clips.length})`);
    if (APPLY && (await applyLayeredTimeline(pid, timeline))) counts.applied++;
  }
  return counts;
}

async function migrateContentItems() {
  const counts = { scanned: 0, alreadyMigrated: 0, duplicate: 0, invalid: 0, create: 0, applied: 0 };
  const now = new Date();
  for await (const doc of pages("content_items")) {
    counts.scanned++;
    const item = doc.data() as any;
    if (item?.migratedToSavedVideoId) {
      counts.alreadyMigrated++;
      continue;
    }
    const sv = contentItemToSavedVideo(doc.id, item, now);
    if (!sv) {
      counts.invalid++;
      continue;
    }
    const dup = await firestore
      .collection("saved_videos")
      .where("userId", "==", sv.userId)
      .where("sourceType", "==", "recording")
      .where("sourceId", "==", sv.sourceId)
      .limit(1)
      .get();
    if (!dup.empty) {
      counts.duplicate++;
      if (APPLY) await doc.ref.set({ migratedToSavedVideoId: dup.docs[0].id, migratedAt: now }, { merge: true });
      continue;
    }
    counts.create++;
    console.log(`  [${APPLY ? "write" : "dry"}] content_items/${doc.id} -> saved_videos (recording ${sv.sourceId})`);
    if (APPLY) {
      const ref = firestore.collection("saved_videos").doc(`ci_${doc.id}`);
      await firestore.runTransaction(async (tx) => {
        const existing = await tx.get(ref);
        if (!existing.exists) tx.create(ref, sv);
        tx.set(doc.ref, { migratedToSavedVideoId: ref.id, migratedAt: now }, { merge: true });
      });
      counts.applied++;
    }
  }
  return counts;
}

async function main() {
  console.log(`[migrateContentToProjects] mode=${mode} only=${only || "all"} limit=${LIMIT}`);
  const results: Record<string, unknown> = {};
  if (!only || only === "editing_projects") {
    console.log("\n== editing_projects -> projects ==");
    results.editing_projects = await migrateEditingProjects();
  }
  if (!only || only === "timeline_clips") {
    console.log("\n== timeline_clips (Layer 3) -> projects.timeline ==");
    results.timeline_clips = await migrateLayered();
  }
  if (!only || only === "content_items") {
    console.log("\n== content_items -> saved_videos ==");
    results.content_items = await migrateContentItems();
  }
  console.log(`\n[migrateContentToProjects] ${mode} summary:\n${JSON.stringify(results, null, 2)}`);
  if (!APPLY) console.log("\nNothing was written. Re-run with --apply to migrate.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrateContentToProjects] failed:", err?.message || err);
    process.exit(1);
  });
