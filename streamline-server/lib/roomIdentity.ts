import { firestore } from "../firebaseAdmin";

export type ResolvedRoomIdentity = {
  roomId: string;
  roomName: string;
  found: boolean;
};

async function resolveByRoomId(roomId: string): Promise<ResolvedRoomIdentity | null> {
  const id = String(roomId || "").trim();
  if (!id) return null;

  const snap = await firestore.collection("rooms").doc(id).get();
  if (!snap.exists) return null;
  const data = (snap.data() as any) || {};
  const roomName = String(data.livekitRoomName || data.roomName || data.name || id).trim() || id;

  return { roomId: snap.id, roomName, found: true };
}

async function resolveByRoomName(roomName: string): Promise<ResolvedRoomIdentity | null> {
  const name = String(roomName || "").trim();
  if (!name) return null;

  // Prefer the canonical field, but support legacy schemas as well.
  // (Firestore doesn't support simple OR queries without composite indexes,
  // so we try a few common fields in order.)
  const candidates: Array<{ field: string; value: string }> = [
    { field: "livekitRoomName", value: name },
    { field: "roomName", value: name },
    { field: "name", value: name },
  ];

  for (const candidate of candidates) {
    const snap = await firestore
      .collection("rooms")
      .where(candidate.field as any, "==", candidate.value)
      .limit(1)
      .get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      const data = (doc.data() as any) || {};
      const resolvedName = String(data.livekitRoomName || data.roomName || data.name || name).trim() || name;
      return { roomId: doc.id, roomName: resolvedName, found: true };
    }
  }

  // Legacy fallback: treat roomName as doc id if it exists
  const direct = await firestore.collection("rooms").doc(name).get();
  if (direct.exists) {
    const data = (direct.data() as any) || {};
    const resolvedName = String(data.livekitRoomName || name).trim() || name;
    return { roomId: direct.id, roomName: resolvedName, found: true };
  }

  return null;
}

export async function resolveRoomIdentity(input: { roomId?: string | null; roomName?: string | null }): Promise<ResolvedRoomIdentity | null> {
  const roomId = String(input.roomId || "").trim();
  const roomName = String(input.roomName || "").trim();

  // Prefer canonical id.
  if (roomId) {
    const resolved = await resolveByRoomId(roomId);
    if (resolved) return resolved;
    // If id is unknown (e.g., brand new), still return a best-effort mapping.
    return { roomId, roomName: roomName || roomId, found: false };
  }

  if (roomName) {
    const resolved = await resolveByRoomName(roomName);
    if (resolved) return resolved;
    // Do NOT treat a human-facing roomName as a Firestore doc id.
    // Callers that only have a roomName must create/lookup a room doc
    // separately and pass the canonical roomId.
    return null;
  }

  return null;
}
