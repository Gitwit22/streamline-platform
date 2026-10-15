import { Router } from "express";
import admin from "firebase-admin";
import { firestore as db } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import {
  requireRoomAccessToken,
  type RoomAccessClaims,
} from "../middleware/roomAccessToken";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { actorMay } from "../lib/roomModerationPolicy";
import {
  applyProgramStatePatch,
  upgradeProgramState,
  type ProgramStateV2,
} from "../lib/programState";
import { getLiveKitSdk } from "../lib/livekit";
import { getRoomProgramOverlay } from "../services/programOverlay";
import { mergeRoomMetadata, type ProgramOverlay } from "../lib/programOverlayPure";

const router = Router();

// ---------------------------------------------------------------------------
// Broadcast program state to all room participants via LiveKit room metadata
// ---------------------------------------------------------------------------
const BROADCAST_MAX_RETRIES = 3;
const BROADCAST_BASE_DELAY_MS = 200;

async function broadcastProgramStateOnce(
  livekitRoomName: string,
  programState: ProgramStateV2,
  // The room's current overlay (undefined = leave the metadata's as is).
  programOverlay?: ProgramOverlay | null,
): Promise<void> {
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

  const next = mergeRoomMetadata(rooms[0].metadata, { programState, programOverlay });
  if (next === null) throw new Error("room metadata is not a JSON object");
  await svc.updateRoomMetadata(livekitRoomName, next);
}

async function broadcastProgramStateWithRetry(
  livekitRoomName: string,
  programState: ProgramStateV2,
  programOverlay?: ProgramOverlay | null,
): Promise<void> {
  for (let attempt = 1; attempt <= BROADCAST_MAX_RETRIES; attempt++) {
    try {
      await broadcastProgramStateOnce(livekitRoomName, programState, programOverlay);
      return; // success
    } catch (err) {
      const isLastAttempt = attempt === BROADCAST_MAX_RETRIES;
      if (isLastAttempt) {
        console.error(
          `[programState] broadcastProgramState failed after ${BROADCAST_MAX_RETRIES} attempts`,
          { livekitRoomName, error: (err as any)?.message || String(err) },
        );
      } else {
        const delay = BROADCAST_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[programState] broadcastProgramState attempt ${attempt}/${BROADCAST_MAX_RETRIES} failed, retrying in ${delay}ms`,
          { livekitRoomName, error: (err as any)?.message || String(err) },
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}

/** LiveKit identity of the room owner (host tokens use the owner uid). */
function roomHostIdentity(roomData: any): string | null {
  const v = roomData?.ownerId || roomData?.ownerUid || roomData?.uid || null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
      // Always answer in v2 (stored v1 documents are upgraded on read).
      const programState: ProgramStateV2 | null = data.programState
        ? upgradeProgramState(data.programState, roomHostIdentity(data))
        : null;

      // On-video branding (also pushed into room metadata when outputs start
      // or the kit changes); here so the stage shows it before going live.
      const programOverlay = await getRoomProgramOverlay(data).catch((err) => {
        console.warn("[programState] overlay lookup failed", { roomId, error: err?.message || String(err) });
        return null;
      });

      return res.json({ ok: true, roomId, programState, programOverlay });
    } catch (err) {
      console.error("[programState] GET error", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /api/rooms/:roomId/program-state
// Auth: Firebase auth + roomAccessToken; host, or cohost with canLayout.
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
    if (!actorMay(access, access.permissions, "canLayout"))
      return res
        .status(403)
        .json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });

    const uid = (req as any).user?.uid as string | undefined;
    if (!uid)
      return res
        .status(401)
        .json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    try {
      const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

      // Read current state, apply the (v2 or legacy v1) patch, persist v2 +
      // legacy mirror fields.
      // In a transaction so two concurrent edits (host + producer, two
      // tabs) can't each apply their patch to the same old state and drop
      // the other's change (audit P2).
      const roomRef = db.collection("rooms").doc(roomId);
      const txResult = await db.runTransaction(async (tx) => {
        const snap = await tx.get(roomRef);
        const roomData = snap.exists ? ((snap.data() as any) || {}) : {};
        const result = applyProgramStatePatch(
          roomData.programState,
          req.body,
          roomHostIdentity(roomData),
          Date.now(),
        );
        if (!result.ok) return { error: result.error, roomData, merged: null as ProgramStateV2 | null };
        tx.set(
          roomRef,
          { programState: result.value, updatedAt: serverTimestamp } as any,
          { merge: true },
        );
        return { error: null as string | null, roomData, merged: result.value };
      });
      if (txResult.error || !txResult.merged) {
        return res.status(400).json({ error: "invalid_program_state", detail: txResult.error });
      }
      const merged = txResult.merged;
      const roomData = txResult.roomData;

      // Broadcast to LiveKit room metadata for real-time sync.
      // Await the broadcast so the HTTP response only returns once the
      // compositor has (or will imminently have) the updated metadata.
      const livekitRoomName =
        access.livekitRoomName ||
        (roomData?.livekitRoomName as string | undefined);
      if (livekitRoomName) {
        // Re-send the overlay too, so this write can't drop one an overlay
        // sync wrote in between. Lookup failure leaves the overlay as is.
        const overlay = await getRoomProgramOverlay(roomData).catch(() => undefined);
        try {
          await broadcastProgramStateWithRetry(livekitRoomName, merged, overlay);
        } catch (err) {
          // Log but don't fail the request — Firestore is already updated
          // and the compositor's poll fallback will pick it up.
          console.warn("[programState] broadcast failed, compositor poll will catch up", err);
        }
      }

      return res.json({ ok: true, roomId, programState: merged });
    } catch (err) {
      console.error("[programState] PATCH error", err);
      return res.status(500).json({ error: "internal_error" });
    }
  },
);

export default router;

// Exported for testing
export { broadcastProgramStateWithRetry, BROADCAST_MAX_RETRIES, BROADCAST_BASE_DELAY_MS };
