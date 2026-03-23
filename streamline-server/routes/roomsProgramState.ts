import { Router } from "express";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import {
  requireRoomAccessToken,
  type RoomAccessClaims,
} from "../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import {
  normalizeProgramState,
  DEFAULT_PROGRAM_STATE,
  type ProgramState,
} from "../lib/programState";
import { getLiveKitSdk } from "../lib/livekit";

const router = Router();

function isHostOrCohost(role?: string): boolean {
  const r = String(role || "").toLowerCase();
  return r === "host" || r === "cohost";
}

// ---------------------------------------------------------------------------
// Broadcast program state to all room participants via LiveKit room metadata
// ---------------------------------------------------------------------------
async function broadcastProgramState(
  livekitRoomName: string,
  programState: ProgramState,
): Promise<void> {
  try {
    const sdk = await getLiveKitSdk();
    const RoomServiceClient = (sdk as any).RoomServiceClient;
    if (
      !RoomServiceClient ||
      !process.env.LIVEKIT_URL ||
      !process.env.LIVEKIT_API_KEY ||
      !process.env.LIVEKIT_API_SECRET
    ) {
      return;
    }
    const svc = new RoomServiceClient(
      process.env.LIVEKIT_URL,
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
    );
    // Room metadata is a JSON string read by all participants (incl. compositor)
    const rooms = await svc.listRooms([livekitRoomName]);
    if (!rooms || rooms.length === 0) return;

    const existing = rooms[0].metadata
      ? JSON.parse(rooms[0].metadata)
      : {};
    const merged = { ...existing, programState };
    await svc.updateRoomMetadata(
      livekitRoomName,
      JSON.stringify(merged),
    );
  } catch (err) {
    console.warn("[programState] broadcastProgramState failed", err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/rooms/:roomId/program-state
// ---------------------------------------------------------------------------
router.get(
  "/:roomId/program-state",
  requireRoomAccessToken as any,
  async (req: any, res) => {
    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const access = (req as any).roomAccess as RoomAccessClaims | undefined;
    if (!access || !access.roomId)
      return res
        .status(401)
        .json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
    if (access.roomId !== roomId)
      return res
        .status(403)
        .json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });

    try {
      const snap = await db.collection("rooms").doc(roomId).get();
      const data = snap.exists ? ((snap.data() as any) || {}) : {};
      const programState: ProgramState | null = data.programState
        ? { ...DEFAULT_PROGRAM_STATE, ...data.programState }
        : null;

      return res.json({ ok: true, roomId, programState });
    } catch (err) {
      console.error("[programState] GET error", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/rooms/:roomId/program-state
// Auth: Firebase auth + roomAccessToken, host or cohost.
// ---------------------------------------------------------------------------
router.patch(
  "/:roomId/program-state",
  requireAuth as any,
  requireRoomAccessToken as any,
  async (req: any, res) => {
    const roomId = String(req.params.roomId || "").trim();
    if (!roomId) return res.status(400).json({ error: "roomId_required" });

    const access = (req as any).roomAccess as RoomAccessClaims | undefined;
    if (!access || !access.roomId)
      return res
        .status(401)
        .json({ error: PERMISSION_ERRORS.ROOM_TOKEN_REQUIRED });
    if (access.roomId !== roomId)
      return res
        .status(403)
        .json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    if (!isHostOrCohost(access.role))
      return res
        .status(403)
        .json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const uid = (req as any).user?.uid as string | undefined;
    if (!uid)
      return res
        .status(401)
        .json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const patch = normalizeProgramState(req.body);
    if (!patch) {
      return res.status(400).json({ error: "invalid_program_state" });
    }

    try {
      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
      const now = new Date().toISOString();

      // Read current state, merge, persist
      const roomRef = db.collection("rooms").doc(roomId);
      const snap = await roomRef.get();
      const existing =
        snap.exists && (snap.data() as any)?.programState
          ? (snap.data() as any).programState
          : {};
      const merged: ProgramState = {
        ...DEFAULT_PROGRAM_STATE,
        ...existing,
        ...patch,
        updatedAt: now,
      };

      await roomRef.set(
        { programState: merged, updatedAt: serverTimestamp } as any,
        { merge: true },
      );

      // Broadcast to LiveKit room metadata for real-time sync
      const livekitRoomName =
        access.livekitRoomName ||
        ((snap.data() as any)?.livekitRoomName as string | undefined);
      if (livekitRoomName) {
        // Fire-and-forget; don't block the HTTP response
        broadcastProgramState(livekitRoomName, merged).catch(() => {});
      }

      return res.json({ ok: true, roomId, programState: merged });
    } catch (err) {
      console.error("[programState] PATCH error", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

export default router;
