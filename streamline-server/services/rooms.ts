import admin from "firebase-admin";
import { randomUUID } from "node:crypto";
import { firestore as db } from "../firebaseAdmin";
import type { HlsPresetId } from "./livekitEgress";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import type { RoomLayout } from "../lib/roomLayout";

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
  };
  hlsConfig?: RoomHlsConfig;
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
  const requiresAuth = params.requiresAuth === undefined ? true : !!params.requiresAuth;
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

export async function setHlsStarting(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  params: { presetId: HlsPresetId; prefix: string; stopAt?: string | null; capMinutes?: number | null }
): Promise<void> {
  const runId = randomUUID();
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

  await roomRef.update({
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
  });
}

export async function setHlsLive(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  params: { egressId: string; playlistUrl: string }
): Promise<void> {
  await roomRef.update({
    "hls.status": "live",
    "hls.egressId": params.egressId,
    "hls.playlistUrl": params.playlistUrl,
    "hls.error": null,
    "hls.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function setHlsError(
  roomRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  message: string
): Promise<void> {
  await roomRef.update({
    "hls.status": "error",
    "hls.egressId": null,
    "hls.playlistUrl": null,
    "hls.error": message,
    "hls.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
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
    "hls.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
  });
}
