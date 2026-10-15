/**
 * Everything a closed account owns besides recordings / saved videos (which
 * accountPurge.ts already handles), removed when the account is purged.
 * Audit P1-5: the purge used to leave saved stream keys, uploads, project
 * files, rooms (with chat), channels, brand kits, the audio deck,
 * collaborator links, invites and the Firebase Auth user behind, while the UI
 * promises "permanently removes your content".
 *
 * Every step is bounded and idempotent. `complete` is false when any step
 * failed or hit its batch limit; the caller then keeps the user doc so the
 * hourly job retries instead of losing track of what's left.
 *
 * Kept on purpose: pay-per-view purchases / revenue ledger / entitlements
 * (financial records other people's access depends on) and audit logs.
 */
import { firestore, auth } from "../../firebaseAdmin";
import { deleteFile, deletePrefix } from "../storageClient";

const BATCH = 300;
const PREFIX_BATCH = 5000;

export type UserDataPurgeResult = { complete: boolean; counts: Record<string, number>; failures: string[] };

async function deleteQueryDocs(q: FirebaseFirestore.Query, onDoc?: (d: FirebaseFirestore.QueryDocumentSnapshot) => Promise<void>) {
  const snap = await q.limit(BATCH).get();
  for (const d of snap.docs) {
    if (onDoc) await onDoc(d);
    await firestore.recursiveDelete(d.ref);
  }
  return { deleted: snap.size, more: snap.size >= BATCH };
}

export async function purgeUserOwnedData(uid: string): Promise<UserDataPurgeResult> {
  const counts: Record<string, number> = {};
  const failures: string[] = [];
  let complete = true;

  async function step(name: string, fn: () => Promise<{ deleted: number; more: boolean }>) {
    try {
      const r = await fn();
      counts[name] = r.deleted;
      if (r.more) complete = false;
    } catch (e: any) {
      complete = false;
      failures.push(name);
      console.warn("[account-purge] step failed", { uid, step: name, error: e?.message || e });
    }
  }

  // Library uploads: R2 objects first, then the docs.
  await step("editing_assets", () =>
    deleteQueryDocs(firestore.collection("editing_assets").where("userId", "==", uid), async (d) => {
      const path = (d.data() as any)?.storagePath;
      if (typeof path === "string" && path.trim()) await deleteFile(path.trim());
    })
  );
  await step("uploads_prefix", async () => {
    const r = await deletePrefix(`uploads/${uid}/`, PREFIX_BATCH);
    return { deleted: r.deleted, more: r.deleted >= PREFIX_BATCH };
  });

  // Projects and their uploaded assets.
  await step("project_assets", () =>
    deleteQueryDocs(firestore.collection("project_assets").where("ownerId", "==", uid), async (d) => {
      const data = d.data() as any;
      if (data?.type === "upload" && typeof data.storageKey === "string" && data.storageKey.trim()) {
        await deleteFile(data.storageKey.trim());
      }
    })
  );
  await step("projects", () => deleteQueryDocs(firestore.collection("projects").where("ownerId", "==", uid)));
  await step("projects_prefix", async () => {
    const r = await deletePrefix(`projects/${uid}/`, PREFIX_BATCH);
    return { deleted: r.deleted, more: r.deleted >= PREFIX_BATCH };
  });
  // Legacy editor collections.
  for (const legacy of ["editing_projects", "editing_project_assets", "timeline_clips"]) {
    await step(legacy, () => deleteQueryDocs(firestore.collection(legacy).where("userId", "==", uid)));
  }

  // Rooms (recursive: controls, chat sessions + messages, presence, viewers),
  // their invites and recording locks.
  await step("rooms", () =>
    deleteQueryDocs(firestore.collection("rooms").where("ownerId", "==", uid), async (d) => {
      const invites = await firestore.collection("roomInvites").where("roomId", "==", d.id).limit(BATCH).get();
      for (const inv of invites.docs) await inv.ref.delete();
      await firestore.collection("recordingLocks").doc(d.id).delete();
    })
  );

  await step("savedEmbeds", () => deleteQueryDocs(firestore.collection("savedEmbeds").where("ownerId", "==", uid)));
  await step("brandKits", () => deleteQueryDocs(firestore.collection("brandKits").where("ownerId", "==", uid)));
  await step("audioDecks", async () => {
    await firestore.collection("audioDecks").doc(uid).delete();
    return { deleted: 1, more: false };
  });
  await step("collaborators_as_owner", () =>
    deleteQueryDocs(firestore.collection("collaboratorRelationships").where("ownerUid", "==", uid))
  );
  await step("collaborators_as_collaborator", () =>
    deleteQueryDocs(firestore.collection("collaboratorRelationships").where("collaboratorUid", "==", uid))
  );

  // Sign-in account. Missing user = already gone.
  await step("auth_user", async () => {
    try {
      await auth.deleteUser(uid);
      return { deleted: 1, more: false };
    } catch (e: any) {
      if (e?.code === "auth/user-not-found") return { deleted: 0, more: false };
      throw e;
    }
  });

  return { complete: complete && failures.length === 0, counts, failures };
}
