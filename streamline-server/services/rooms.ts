import admin from "firebase-admin";
import { randomUUID } from "node:crypto";
import { firestore as db } from "../firebaseAdmin";
import type { HlsPresetId } from "./livekitEgress";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import type { RoomLayout } from "../lib/roomLayout";
import { decideHlsStart } from "../lib/mediaPure";

export type RoomHlsConfig = {
  enabled: boolean;
  title?: string;
  subtitle?: string;
  logoUrl?: string;
  offlineMessage?: string;
  theme?: "light" | "dark";
  updatedAt?: string; // ISO
};

// Shared defaults for viewer-facing HLS config (rooms/{roomId}.hlsConfig).
// This is distinct from runtime HLS state (rooms/{roomId}.hls).
export const DEFAULT_ROOM_HLS_CONFIG: RoomHlsConfig = {
  enabled: false,
  title: "",
  subtitle: "",
  logoUrl: "",
  theme: "dark",
  offlineMessage: "This stream is offline.",
};

export type RoomDoc = {
  ownerId: string;
  livekitRoomName?: string;
  // Canonical room layout configuration (controls viewer/participant layout;
  // recordings inherit this by default).
  roomLayout?: RoomLayout;
  // Room access policy (server-enforced during token issuance).
  // Defaults are intentionally secure.
  visibility?: "public" | "unlisted" | "private";
  requiresAuth?: boolean;
  requiresPayment?: boolean;
  // Optional link to a saved embed / viewer page
  savedEmbedId?: string;
  roomType?: string;
  status?: "idle" | "live" | "ended" | "scheduled" | string;
  createdAt?: FirebaseFirestore.Timestamp | admin.firestore.FieldValue | number | null;
  updatedAt?: FirebaseFirestore.Timestamp | admin.firestore.FieldValue | number | null;
  hls?: {
    status?: "idle" | "starting" | "live" | "error";
    runId?: string | null;
    egressId?: string | null;
    playlistUrl?: string | null;
    error?: string | null;
    stopAt?: string | null; // ISO
    capMinutes?: number | null;
    presetId?: HlsPresetId;
    prefix?: string;
    startedAt?: FirebaseFirestore.Timestamp | null;
    updatedAt?: FirebaseFirestore.Timestamp | null;
    heartbeatAt?: FirebaseFirestore.Timestamp | null;
  };
  hlsConfig?: RoomHlsConfig;
  /** Room-level monetization toggle (requires HLS). */
  monetizationEnabled?: boolean;
  /** Room-level PPV toggle (requires HLS + monetizationEnabled). */
  payPerViewEnabled?: boolean;
  [key: string]: any;
};

export async function ensureRoomDoc(params: {
  roomId: string;
  ownerId: string;
  livekitRoomName: string;
  roomType?: string;
  initialStatus?: string;
  initialRoomLayout?: RoomLayout;
  // When provided, bind this room to a specific saved embed.
  savedEmbedId?: string;
  // Optional policy overrides (otherwise defaults apply).
  visibility?: RoomDoc["visibility"];
  requiresAuth?: boolean;
  requiresPayment?: boolean;
}): Promise<{
  ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  data: RoomDoc;
}> {
  const { roomId, ownerId, livekitRoomName, roomType, initialStatus, savedEmbedId, initialRoomLayout } = params;
  const ref = db.collection("rooms").doc(roomId);
  const snap = await ref.get();
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

  const visibility: RoomDoc["visibility"] =
    params.visibility === "public" || params.visibility === "unlisted" || params.visibility === "private"
      ? params.visibility
      : "unlisted";
  const requiresAuth = params.requiresAuth === undefined ? false : !!params.requiresAuth;
  const requiresPayment = params.requiresPayment === undefined ? false : !!params.requiresPayment;

  if (!snap.exists) {
    const doc: Partial<RoomDoc> = {
      ownerId,
      roomType: roomType || "rtc",
      livekitRoomName,
      ...(initialRoomLayout ? { roomLayout: initialRoomLayout } : {}),
      visibility,
      requiresAuth,
      requiresPayment,
      ...(savedEmbedId ? { savedEmbedId } : {}),
      createdAt: serverTimestamp,
      updatedAt: serverTimestamp,
      status: initialStatus || "live",
      hls: { status: "idle" },
    };

    await ref.set(doc as any, { merge: false });
  } else {
    const existing = (snap.data() || {}) as RoomDoc;
    const patch: Partial<RoomDoc> = {};

    if (!existing.ownerId) patch.ownerId = ownerId;
    if (!existing.roomType) patch.roomType = roomType || "rtc";
    if (!existing.livekitRoomName) patch.livekitRoomName = livekitRoomName;
    if (existing.visibility !== "public" && existing.visibility !== "unlisted" && existing.visibility !== "private") {
      patch.visibility = visibility;
    }
    if (typeof existing.requiresAuth !== "boolean") patch.requiresAuth = requiresAuth;
    if (typeof existing.requiresPayment !== "boolean") patch.requiresPayment = requiresPayment;
    if (savedEmbedId && !existing.savedEmbedId) patch.savedEmbedId = savedEmbedId;
    if (initialRoomLayout && !existing.roomLayout) patch.roomLayout = initialRoomLayout;
    if (!("createdAt" in existing)) patch.createdAt = serverTimestamp;
    patch.updatedAt = serverTimestamp;
    if (!existing.status) patch.status = initialStatus || "live";
    if (!existing.hls) patch.hls = { status: "idle" };

    if (Object.keys(patch).length) {
      await ref.set(patch as any, { merge: true });
    }
  }

  const finalSnap = await ref.get();
  const data = (finalSnap.data() || {}) as RoomDoc;
  return { ref, data };
}

export async function getRoom(roomId: string): Promise<{
  ref: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>;
  data: RoomDoc;
}> {
  const ref = db.collection("rooms").doc(roomId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(PERMISSION_ERRORS.ROOM_NOT_FOUND);
  }
  const data = snap.data() as RoomDoc;
  return { ref, data };
}

/** A "starting" claim older than this is treated as abandoned and may be taken over. */
export const HLS_STALE_STARTING_MS = 3 * 60_000;

export type HlsStartClaim = {
  /** true when this call moved the room to "starting" and owns the run. */
  started: boolean;
  runId: string | null;
  /** Current hls state when started=false (existing starting/live session). */
  hls: RoomDoc["hls"];
};

/**
 * Atomically move hls idle/error → starting. If the room is already live, or
 * another request claimed "starting" recently, nothing is written and the
 * existing state is returned (started=false).
 */
export async function setHlsStarting(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  params: { presetId: HlsPresetId; prefix: string; stopAt?: string | null; capMinutes?: number | null }
): Promise<HlsStartClaim> {
  const runId = randomUUID();
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists) throw new Error(PERMISSION_ERRORS.ROOM_NOT_FOUND);
    const hls = ((snap.data() || {}) as RoomDoc).hls || {};
    if (decideHlsStart(hls, Date.now(), HLS_STALE_STARTING_MS).action === "existing") {
      return { started: false, runId: hls.runId ?? null, hls };
    }

    tx.update(roomRef, {
      "hls.status": "starting",
      "hls.egressId": null,
      "hls.playlistUrl": null,
      "hls.error": null,
      "hls.stopAt": params.stopAt ?? null,
      "hls.capMinutes": params.capMinutes ?? null,
      "hls.presetId": params.presetId,
      "hls.prefix": params.prefix,
      "hls.runId": runId,
      "hls.startedAt": serverTimestamp,
      "hls.updatedAt": serverTimestamp,
      "hls.heartbeatAt": serverTimestamp,
    });
    return { started: true, runId, hls: undefined };
  });
}

/**
 * starting → live, only for the run that claimed "starting". Throws if the
 * run was superseded (stopped / purged / taken over) so the caller can stop
 * the egress it just started instead of leaking it.
 */
export async function setHlsLive(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  params: { egressId: string; playlistUrl: string; runId?: string | null }
): Promise<void> {
  const patch = {
    "hls.status": "live",
    "hls.egressId": params.egressId,
    "hls.playlistUrl": params.playlistUrl,
    "hls.error": null,
    "hls.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    "hls.heartbeatAt": admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!params.runId) {
    await roomRef.update(patch);
    return;
  }
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef);
    const hls = ((snap.data() || {}) as RoomDoc).hls || {};
    if (!snap.exists || hls.runId !== params.runId || hls.status !== "starting") {
      throw new Error("hls_run_superseded");
    }
    tx.update(roomRef, patch);
  });
}

/** Record a start failure. With runId, only writes if that run still owns the room. */
export async function setHlsError(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  message: string,
  runId?: string | null
): Promise<void> {
  const patch = {
    "hls.status": "error",
    "hls.egressId": null,
    "hls.playlistUrl": null,
    "hls.error": message,
    "hls.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!runId) {
    await roomRef.update(patch);
    return;
  }
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef);
    const hls = ((snap.data() || {}) as RoomDoc).hls || {};
    if (!snap.exists || hls.runId !== runId) return;
    tx.update(roomRef, patch);
  });
}

export async function setHlsIdle(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>
): Promise<void> {
  await roomRef.update({
    "hls.status": "idle",
    "hls.egressId": null,
    "hls.playlistUrl": null,
    "hls.error": null,
    "hls.runId": null,
    "hls.startedAt": null,
    "hls.stopAt": null,
    "hls.capMinutes": null,
    "hls.heartbeatAt": null,
    "hls.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Atomically set idle only if `runId` still owns the room. Returns true when
 * this call performed the transition (so exactly one caller bills minutes).
 */
export async function setHlsIdleIfRun(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  runId: string | null
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists) return false;
    const hls = ((snap.data() || {}) as RoomDoc).hls || {};
    const status = String(hls.status || "idle");
    if (status === "idle") return false;
    if ((hls.runId ?? null) !== (runId ?? null)) return false;
    tx.update(roomRef, {
      "hls.status": "idle",
      "hls.egressId": null,
      "hls.playlistUrl": null,
      "hls.error": null,
      "hls.runId": null,
      "hls.startedAt": null,
      "hls.stopAt": null,
      "hls.capMinutes": null,
      "hls.heartbeatAt": null,
      "hls.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
}

/** Liveness signal written while a host polls /api/hls/status. */
export async function touchHlsHeartbeat(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>
): Promise<void> {
  await roomRef.update({ "hls.heartbeatAt": admin.firestore.FieldValue.serverTimestamp() });
}
