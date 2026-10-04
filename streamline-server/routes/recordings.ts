/**
 * StreamLine Recordings API
 * 
 * Reliable recording pipeline with:
 * - Immediate Firestore doc creation on start
 * - LiveKit Cloud egress to Cloudflare R2
 * - Proper status transitions: starting → recording → processing → ready
 * - Safe download endpoint with signed URLs
 * 
 * Routes (matching existing frontend calls):
 * - POST /api/recordings/start
 * - POST /api/recordings/stop
 * - GET /api/recordings/:id
 * - GET /api/recordings/:id/download-link
 * - GET /api/recordings/:id/download
 * - GET /api/recordings/:id/storage-check
 * - POST /api/recordings/:id/report-download-issue
 */

import { Router } from "express";
import crypto from "crypto";
import { firestore } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "../middleware/roomAccessToken";
import { canAccessFeature } from "./featureAccess";
import { clampRecordingPreset, getPresetPlanContext, resolveRequestedPresetId, toEncodingOptions } from "../lib/mediaPresets";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { Timestamp } from "firebase-admin/firestore";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { logDelegatedRoomAction } from "../lib/collaborators";
import { deleteFiles, deletePrefix } from "../lib/storageClient";
import { resolveCompositeLayoutFromRoom } from "../lib/roomLayout";
import { deleteRecordingStorage } from "../lib/recordingDeletion";
import { createSavedVideoFromRecording } from "./myContent";
import { getCurrentStorageUsage, reserveStorageUsage } from "../usageHelper";
import { countRecordingMinutes, recordingBillingUid, releaseRecordingStorageOnce } from "../lib/recordingUsage";
import { requireAdmin } from "../middleware/adminAuth";
import { DOWNLOAD_LINK_TTL_SECONDS, evaluateDownloadRules, shouldClaimStorageCount } from "../lib/mediaPure";
import { compositorUrl, warnBuiltInLayoutFallback } from "../lib/egressTemplate";
import { copyViewerStatsToRecording } from "../lib/viewerStats";
import { getPlatformFlags } from "../lib/entitlements";

const router = Router();

async function getMyContentPlatformFlags() {
  // Single platform-flag source (lib/entitlements/flags.ts defaults table).
  const flags = await getPlatformFlags();
  return {
    myContentEnabled: flags.myContentEnabled,
    myContentRecordingsEnabled: flags.myContentRecordingsEnabled,
  };
}

// NOTE: this surface switch gates the My Content recordings UI endpoints only.
// Reading, downloading and deleting the caller's OWN recordings is never
// gated (cleanup is always allowed).
async function assertMyContentRecordingsEnabled(res: any): Promise<boolean> {
  const flags = await getMyContentPlatformFlags();
  if (flags.myContentRecordingsEnabled) return true;

  res.status(403).json({
    error: LIMIT_ERRORS.FEATURE_DISABLED,
    feature: "myContentRecordingsEnabled",
    reason: "Recordings are disabled by featureFlags/myContentRecordingsEnabled",
    platformFlags: flags,
  });
  return false;
}

async function requireMyContentRecordingsEnabled(req: any, res: any, next: any) {
  if (!(await assertMyContentRecordingsEnabled(res))) return;
  return next();
}

// Emergency recordings are intentionally short-lived: 1-hour retention window.
const EMERGENCY_RETENTION_MS = 1 * 60 * 60 * 1000; // 1 hour

type EmergencyCurrentDoc = {
  recordingId?: string;
  createdAt?: any;
  expiresAt?: any;
  emergencyAvailableUntilMs?: number;
  deleteAfterMs?: number;
  status?: string;
  r2Keys?: string[];
  r2Prefix?: string;
  deletedAt?: any;
};

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  return null;
}

// =============================================================================
// ENVIRONMENT & CONFIG
// =============================================================================

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Normalize LiveKit URL for egress client (must be HTTP/HTTPS, not WS)
 */
function normalizeLiveKitUrl(url: string | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://");
}

/**
 * Validate all required env vars at module load time
 */
function validateEnvVars() {
  const required = [
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID", 
    "R2_SECRET_ACCESS_KEY",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
  ];
  
  const hasR2Endpoint = process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT;
  const hasLiveKitUrl = process.env.LIVEKIT_URL || process.env.LIVEKIT_HTTP_URL;

  const missing: string[] = [];
  for (const name of required) {
    if (!process.env[name]) missing.push(name);
  }
  if (!hasR2Endpoint) missing.push("R2_ACCOUNT_ID or R2_ENDPOINT");
  if (!hasLiveKitUrl) missing.push("LIVEKIT_URL or LIVEKIT_HTTP_URL");

  if (missing.length > 0) {
    console.error("[recordings] ❌ Missing required env vars:", missing.join(", "));
  } else {
    // Log normalized URLs at startup
    const normalizedUrl = normalizeLiveKitUrl(process.env.LIVEKIT_HTTP_URL || process.env.LIVEKIT_URL);
    console.log("[recordings] ✓ Env vars validated");
    console.log("[recordings] LiveKit egress URL:", normalizedUrl);
  }
}

// Validate on module load
validateEnvVars();

function getR2Config() {
  const bucket = mustGetEnv("R2_BUCKET");
  const accessKeyId = mustGetEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = mustGetEnv("R2_SECRET_ACCESS_KEY");
  const accountId = process.env.R2_ACCOUNT_ID;
  const endpoint = accountId
    ? `https://${accountId}.r2.cloudflarestorage.com`
    : mustGetEnv("R2_ENDPOINT");

  return { bucket, accessKeyId, secretAccessKey, endpoint };
}

function getLiveKitConfig() {
  // Use normalization function for consistency
  const url = normalizeLiveKitUrl(process.env.LIVEKIT_HTTP_URL || process.env.LIVEKIT_URL);
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  return { url, apiKey, apiSecret, isConfigured: !!(url && apiKey && apiSecret) };
}

// Lazy SDK loader
let _livekitSdk: any = null;
async function getLiveKitSdk() {
  if (_livekitSdk) return _livekitSdk;
  _livekitSdk = await import("livekit-server-sdk");
  return _livekitSdk;
}

// Lazy S3 client
let _s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (_s3Client) return _s3Client;
  const cfg = getR2Config();
  _s3Client = new S3Client({
    region: "auto",
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  });
  return _s3Client;
}

// =============================================================================
// HELPERS
// =============================================================================

const DEFAULT_RETENTION_MINUTES = 30;

function mapRecordingDoc(id: string, data: any) {
  const status = String(data.status || "unknown").toLowerCase();
  // downloadReady should mean the file is actually ready to download.
  // Do NOT treat "stopped" as ready; download-link is strict on status === "ready".
  const downloadReady = data.downloadReady === true || status === "ready";
  return {
    id,
    status,
    downloadReady,
    path: data.downloadPath || data.objectKey || null,
    startedAt: data.startedAt || null,
    stoppedAt: data.stoppedAt || null,
    duration: data.duration || 0,
    fileSize: data.fileSize || null,
  };
}

function normalizeStorageKey(key: unknown): string | null {
  const raw = String(key ?? "").trim();
  if (!raw) return null;
  return raw.startsWith("/") ? raw.slice(1) : raw;
}

function getAuthUserId(req: any): string | null {
  return req.user?.uid || req.user?.id || null;
}

function normalizeRootPrefix(raw: unknown): string {
  const v = String(raw ?? "").trim();
  const noLeadingSlash = v.replace(/^\/+/, "");
  if (!noLeadingSlash) return "";
  return noLeadingSlash.endsWith("/") ? noLeadingSlash : `${noLeadingSlash}/`;
}

/**
 * Generate recording path for R2
 * CRITICAL: No leading slash - use "recordings/..." not "/recordings/..."
 */
function generateRecordingPrefix(userId: string, roomKey: string, recordingId: string, rootPrefix: string = ""): string {
  const root = normalizeRootPrefix(rootPrefix);
  const safeRoom = roomKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRecordingId = String(recordingId || "").trim() || "unknown";
  // Ensure no leading slash - R2/S3 keys should not start with /
  return `${root}recordings/${userId}/${safeRoom}/${safeRecordingId}/`;
}

function generateRecordingPath(
  userId: string,
  roomKey: string,
  recordingId: string,
  rootPrefix: string = ""
): { objectKey: string; prefix: string } {
  const prefix = generateRecordingPrefix(userId, roomKey, recordingId, rootPrefix);
  return { prefix, objectKey: `${prefix}recording.mp4` };
}

/**
 * HEAD check on R2 to verify object exists and get size
 */
async function r2HeadObjectSize(key: string): Promise<number> {
  try {
    const cfg = getR2Config();
    const client = getS3Client();
    const resp = await client.send(
      new HeadObjectCommand({ Bucket: cfg.bucket, Key: key })
    );
    return typeof resp.ContentLength === "number" ? resp.ContentLength : 0;
  } catch (err: any) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return 0;
    }
    console.error(`[r2] HEAD error for ${key}:`, err?.message);
    return 0;
  }
}

/**
 * Generate signed download URL
 */
async function getSignedDownloadUrl(key: string, expiresIn: number = 300): Promise<string> {
  const cfg = getR2Config();
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: cfg.bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

// =============================================================================
// Internal helper: stop a recording and update usage/locks
// =============================================================================

export async function stopRecordingInternal(options: {
  recordingId: string;
  uid?: string | null;
  reason: "manual" | "auto_cap";
  enforceOwnership?: boolean;
}): Promise<void> {
  const { recordingId, uid: explicitUid, reason, enforceOwnership } = options;

  const recordingRef = firestore.collection("recordings").doc(recordingId);
  const snap = await recordingRef.get();

  if (!snap.exists) {
    console.warn("[recordings/stopInternal] Recording not found", { recordingId });
    return;
  }

  const data = snap.data() || {};

  // Resolve effective user id from explicit uid or recording owner
  const ownerUid: string | null = typeof data.userId === "string" ? data.userId : null;
  const uid = explicitUid || ownerUid;

  if (!uid) {
    console.warn("[recordings/stopInternal] No uid available for recording", { recordingId });
    return;
  }

  if (enforceOwnership && ownerUid && ownerUid !== uid) {
    // Use canonical error code for forbidden/ownership
    throw new Error(LIMIT_ERRORS.FEATURE_NOT_ENTITLED);
  }

  const now = new Date();
  const startedAt: Date | null = data.startedAt?.toDate?.()
    ? data.startedAt.toDate()
    : data.startedAt || null;
  const durationMs = startedAt ? Math.max(0, now.getTime() - startedAt.getTime()) : 0;
  const durationSeconds = Math.floor(durationMs / 1000);

  // Stop LiveKit egress using stored egressId (best-effort)
  const egressId = data.egressId;
  if (egressId) {
    try {
      const livekitCfg = getLiveKitConfig();
      if (livekitCfg.isConfigured) {
        const { EgressClient } = await getLiveKitSdk();
        const egressClient = new EgressClient(
          livekitCfg.url!,
          livekitCfg.apiKey!,
          livekitCfg.apiSecret!
        );
        await egressClient.stopEgress(egressId);
        console.log(`[recordings/stopInternal] Stopped egress: ${egressId}`);
      }
    } catch (stopErr: any) {
      console.warn("[recordings/stopInternal] stopEgress warning:", stopErr?.message);
    }
  } else {
    console.warn("[recordings/stopInternal] No egressId to stop for:", recordingId);
  }

  // Update the recording doc and count recording minutes [startedAt, stop]
  // to the room owner in one transaction (idempotent via usageCounted).
  await countRecordingMinutes(recordingRef, {
    endedAt: now,
    now,
    patch: (recData) => ({
      status: "processing",
      stoppedAt: recData.stoppedAt || now,
      endedAt: recData.endedAt || now,
      duration: recData.usageCounted === true ? recData.duration ?? durationSeconds : durationSeconds,
      durationSeconds: recData.usageCounted === true ? recData.durationSeconds ?? durationSeconds : durationSeconds,
      durationMs: recData.usageCounted === true ? recData.durationMs ?? durationMs : durationMs,
      stopReason: recData.stopReason || reason,
      updatedAt: now,
      downloadReady: false,
      downloadPath: recData.objectKey || recData.downloadPath || null,
    }),
  });

  console.log(`[recordings/stopInternal] Recording ${recordingId} now processing`);

  // Best-effort: keep the room's latest recording status in sync.
  try {
    const roomId = typeof (data as any).roomId === "string" ? String((data as any).roomId).trim() : "";
    if (roomId) {
      const roomRef = firestore.collection("rooms").doc(roomId);
      await roomRef.set(
        {
          latestRecordingId: recordingId,
          latestRecordingStatus: "processing",
          latestRecordingUpdatedAt: now,
        },
        { merge: true }
      );
    }
  } catch (e: any) {
    console.warn("[recordings/stopInternal] failed to update room latestRecording status", e?.message || e);
  }

  // Release active recording lock for this (user, room)
  try {
    const roomId = typeof (data as any).roomId === "string" ? (data as any).roomId : null;
    const roomName = typeof data.roomName === "string" ? data.roomName : null;
    const roomKey = roomId || roomName;
    if (roomKey && uid) {
      const activeKey = `${uid}_${roomKey}`;
      const activeRef = firestore.collection("activeRecordings").doc(activeKey);
      await activeRef.set(
        {
          status: "stopped",
          stoppedAt: now,
          endedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  } catch (lockErr: any) {
    console.warn("[recordings/stopInternal] failed to update activeRecordings lock", lockErr?.message);
  }

  // Best-effort post-stop verification in case webhooks are delayed or dropped
  const objectKey = data.objectKey as string | undefined;
  if (objectKey) {
    setTimeout(async () => {
      try {
        const size = await r2HeadObjectSize(objectKey);
        if (size > 0) {
          await recordingRef.update({
            status: "ready",
            downloadReady: true,
            readyAt: new Date(),
            fileSize: size,
            updatedAt: new Date(),
          });

          try {
            const roomId = typeof (data as any).roomId === "string" ? String((data as any).roomId).trim() : "";
            if (roomId) {
              await firestore
                .collection("rooms")
                .doc(roomId)
                .set(
                  {
                    latestRecordingId: recordingId,
                    latestRecordingStatus: "ready",
                    latestRecordingUpdatedAt: new Date(),
                  },
                  { merge: true }
                );
            }
          } catch (e: any) {
            console.warn("[recordings/stopInternal] failed to update room latestRecording to ready", e?.message || e);
          }

          console.log(
            `[recordings/stopInternal] ✅ File confirmed via head-check: ${objectKey} (${size} bytes)`
          );
        } else {
          console.warn(
            `[recordings/stopInternal] head-check found no file yet for ${objectKey}`
          );
        }
      } catch (checkErr: any) {
        console.warn(
          `[recordings/stopInternal] head-check error for ${objectKey}:`,
          checkErr?.message
        );
      }
    }, 4000);
  }
}

// =============================================================================
// POST /start - Start Recording
// =============================================================================

router.post(
  "/start",
  requireAuth,
  requireMyContentRecordingsEnabled as any,
  requireRoomAccessToken as any,
  async (req, res) => {
  const startTime = Date.now();
  console.log("[recordings/start] Request received");

  try {
    const uid = getAuthUserId(req);
    if (!uid) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    // Validate request
    const {
      roomId: rawRoomId,
      roomName: rawRoomName,
      mode: rawMode,
      presetId,
      usageType: rawUsageType,
      recordingClass: rawRecordingClass,
    } = req.body as {
      roomId?: string;
      roomName?: string;
      mode?: string; // "cloud" | "dual"
      presetId?: string;
      usageType?: string;
      recordingClass?: string;
    };

    const { roomId: canonicalRoomId, livekitRoomName, access: roomAccess } = getRoomAccess(req as any);

    // If caller sent a roomId/roomName in the body, ensure it matches the token (defensive only)
    if (rawRoomId && String(rawRoomId).trim() && String(rawRoomId).trim() !== canonicalRoomId) {
      return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    const roomId = canonicalRoomId;

    try {
      await assertRoomPerm(req as any, roomId, "canRecord");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    // Single mental model:
    // - Room Layout is the source of truth
    // - Recordings inherit Room Layout
    // If a legacy room lacks roomLayout, seed it from account defaults before starting.
    const roomRef = firestore.collection("rooms").doc(roomId);
    const roomSnap = await roomRef.get();
    let roomDoc = roomSnap.exists ? ((roomSnap.data() as any) || {}) : {};
    const ownerUid = String(roomDoc.ownerId || uid).trim() || uid;

    const featureAccess = await canAccessFeature(ownerUid, "recording");
    if (!featureAccess.allowed) {
      console.warn(`[recordings/start] feature access denied ownerUid=${ownerUid} actorUid=${uid}`, featureAccess);
      return res.status(403).json({
        success: false,
        error: featureAccess.code || LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
        reason: featureAccess.reason || "Recording requires upgrade",
        _diag: featureAccess._diag,
      });
    }

    if (!roomDoc.roomLayout) {
      try {
        const userSnap = await firestore.collection("users").doc(ownerUid).get();
        const userData = userSnap.exists ? ((userSnap.data() as any) || {}) : {};
        const mediaPrefs = (userData as any).mediaPrefs || {};
        const candidate = mediaPrefs.defaultRoomLayout;
        if (candidate && typeof candidate === "object" && typeof candidate.mode === "string") {
          await roomRef.set({ roomLayout: candidate }, { merge: true });
          roomDoc = { ...roomDoc, roomLayout: candidate };
        }
      } catch (e: any) {
        console.warn("[recordings/start] failed to seed missing roomLayout from mediaPrefs", e?.message || e);
      }
    }

    const resolvedLayout = resolveCompositeLayoutFromRoom({ roomDoc, requestLayout: undefined, defaultMode: "speaker" });
    const layout = `${resolvedLayout.mode}-dark`;
    const mode = rawMode === "dual" ? "dual" : "cloud";

    // Optional: emergency recordings have special retention rules.
    const recordingClass = rawRecordingClass === "emergency" ? "emergency" : null;

    // Plan + features (canonical limits via EffectiveEntitlements:
    // admin override / platform admin / base plan; null = unlimited).
    const entitlements = await getEffectiveEntitlements(ownerUid);
    const planId = entitlements.planId;
    const plan = entitlements.plan.raw || {};

    // Recordings are NOT gated by monthly streaming minutes (recording
    // minutes are tracked separately). They are gated by the owner's storage:
    // refuse to start when the owner is already at/over the plan storage cap.
    // Fails open on lookup errors (logged) so a Firestore hiccup never blocks.
    try {
      const storageLimitBytes = entitlements.limits.storageBytes; // null = unlimited, 0 = none
      if (storageLimitBytes !== null) {
        const storageUsedBytes = await getCurrentStorageUsage(ownerUid);
        if (storageUsedBytes >= storageLimitBytes) {
          console.warn(`[recordings/start] storage full ownerUid=${ownerUid} actorUid=${uid} roomId=${roomId}`, {
            storageUsedBytes,
            storageLimitBytes,
          });
          return res.status(403).json({
            success: false,
            error: "storage_limit_exceeded",
            reason: "Storage is full. Delete recordings or upgrade to record more.",
            storageUsedBytes,
            storageLimitBytes,
          });
        }
      }
    } catch (e: any) {
      console.error("[recordings/start] storage gate failed; failing open", {
        ownerUid,
        actorUid: uid,
        roomId,
        error: e?.message || e,
      });
    }

    const dualAllowed = !!entitlements.features.dualRecording;
    const allowHigherRecordingThanStream = !!(
      plan?.features?.allowHigherRecordingThanStream || plan?.features?.allow_higher_recording_than_stream
    );
    // null = no per-clip cap. 0 cannot reach here in practice (recording off),
    // but is treated as "no recording time" rather than unlimited.
    const clipLimit = entitlements.limits.recordingMinutesPerClip;
    if (clipLimit === 0) {
      return res.status(403).json({
        success: false,
        error: LIMIT_ERRORS.LIMIT_EXCEEDED,
        reason: "Your plan does not include recording time",
      });
    }
    const maxRecordingMinutesPerClip: number | null = clipLimit;

    // Plan gate for dual recording (feature: dualRecording)
    if (mode === "dual" && !dualAllowed) {
      return res.status(403).json({ error: "dual_recording_not_allowed" });
    }

    // If a stream is live, lower recording quality to stream preset when required
    const streamDocIdNew = `${ownerUid}_${roomId}`;
    const streamDocIdLegacy = `${ownerUid}_${roomAccess.roomName || roomId}`;
    let streamDocId = streamDocIdNew;
    let activeStreamPresetId: string | null = null;
    let hasActiveStream = false;
    try {
      let streamSnap = await firestore.collection("activeStreams").doc(streamDocIdNew).get();
      if (!streamSnap.exists && streamDocIdLegacy !== streamDocIdNew) {
        streamSnap = await firestore.collection("activeStreams").doc(streamDocIdLegacy).get();
        if (streamSnap.exists) streamDocId = streamDocIdLegacy;
      }
      if (streamSnap.exists) {
        hasActiveStream = true;
        const data = streamSnap.data() || {};
        activeStreamPresetId = data.effectivePresetId || data.presetEffectiveId || null;
      }
    } catch (e) {
      console.warn("[recordings/start] failed to read active stream preset", (e as any)?.message);
    }

    const requestedUsageType =
      rawUsageType === "live" || rawUsageType === "recording_only" || rawUsageType === "live+recording"
        ? rawUsageType
        : null;
    const usageType = requestedUsageType || (hasActiveStream ? "live+recording" : "recording_only");

    // Preset: explicit setup-modal choice, else the ROOM OWNER's saved default;
    // then clamp to the owner's effective plan (incl. admin override, plan-doc
    // caps) and (optionally) the active stream preset.
    const presetCtx = await getPresetPlanContext(ownerUid);
    const { requestedId: resolvedRequestedId } = resolveRequestedPresetId({
      bodyPresetId: presetId,
      presetExplicit: (req.body as any)?.presetExplicit,
      actorIsOwner: ownerUid === uid,
      ownerDefaultPresetId: presetCtx.defaultPresetId,
    });
    const clamp = clampRecordingPreset(
      planId,
      resolvedRequestedId,
      activeStreamPresetId,
      allowHigherRecordingThanStream,
      presetCtx.maxPresetId
    );
    const { preset, effectiveId, requestedId, clamped, clampedToStream } = clamp;
    const encodingOptions = toEncodingOptions(preset, "record");

    // Check configs
    const livekitCfg = getLiveKitConfig();
    if (!livekitCfg.isConfigured) {
      console.error("[recordings/start] LiveKit env missing");
      return res.status(500).json({ error: "LiveKit not configured" });
    }

    let r2Cfg;
    try {
      r2Cfg = getR2Config();
    } catch (e: any) {
      console.error("[recordings/start] R2 env missing:", e?.message);
      return res.status(500).json({ error: "R2 storage not configured" });
    }

    // Generate recording ID, then decide storage root prefix.
    const now = new Date();
    const recordingId = firestore.collection("recordings").doc().id;

    // Best-effort: attach orgId for reporting.
    let orgId: string | null = null;
    try {
      const uSnap = await firestore.collection("users").doc(ownerUid).get();
      if (uSnap.exists) {
        const u = (uSnap.data() as any) || {};
        const rawOrgId = u?.orgId ?? u?.org?.id ?? u?.org?.orgId;
        orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : null;
      }
    } catch {
      // non-fatal
    }

    const { objectKey, prefix: r2Prefix } = generateRecordingPath(ownerUid, roomId, recordingId, "");
    const recordingRef = firestore.collection("recordings").doc(recordingId);

    const isEmergency = recordingClass === "emergency";
    const emergencyCurrentRef = firestore
      .collection("users")
      .doc(ownerUid)
      .collection("emergencyRecording")
      .doc("current");

    if (ownerUid !== uid) {
      await logDelegatedRoomAction({
        actedByUid: uid,
        ownerUid,
        roomId,
        action: "recording_start",
        metadata: {
          mode,
          recordingClass,
        },
      }).catch(() => {});
    }

    const emergencyExpiresAt = new Date(now.getTime() + EMERGENCY_RETENTION_MS);
    const emergencyExpiresAtMs = emergencyExpiresAt.getTime();

    const autoStopAt =
      maxRecordingMinutesPerClip !== null && maxRecordingMinutesPerClip > 0
        ? new Date(now.getTime() + maxRecordingMinutesPerClip * 60_000)
        : null;

    // activeRecordings lock for (uid, room)
    const activeKey = `${uid}_${roomId}`;
    const activeRef = firestore.collection("activeRecordings").doc(activeKey);

    // =========================================================================
    // STEP 1: Create Firestore doc IMMEDIATELY with status=starting
    // =========================================================================
    const initialDoc: Record<string, any> = {
      id: recordingId,
      // userId = actor (ownership/UI compatibility); usage + storage are billed
      // to the room owner.
      userId: uid,
      ownerUid,
      billingUid: ownerUid,
      ...(orgId ? { orgId } : {}),
      roomId,
      roomName: roomAccess.roomName || roomId,
      livekitRoomName,
      layout: layout || "grid",
      mode,
      ...(isEmergency
        ? {
            recordingClass: "emergency",
            emergencyAvailableUntilMs: emergencyExpiresAtMs,
            deleteAfterMs: emergencyExpiresAtMs,
          }
        : {}),
      status: "starting",
      downloadReady: false,
      objectKey,
      downloadPath: null,
      r2Keys: [objectKey],
      r2Prefix,
      r2Prefixes: [r2Prefix],
      fileSize: null,
      egressId: null,
      errorMessage: null,
      livekitStatus: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      stoppedAt: null,
      readyAt: null,
      endedAt: null,
      duration: 0,
      viewerCount: 0,
      peakViewers: 0,
      paywallState: "none",
      lastDownloadRequestedAt: null,
      downloadConfirmedAt: null,
      downloadIssueReportedAt: null,
      downloadIssueNote: null,
      oneTimeToken: null,
      presetId: requestedId,
      effectivePresetId: effectiveId,
      presetClamped: clamped || clampedToStream,
      presetClampedToStream: clampedToStream,
      streamPresetId: activeStreamPresetId,
      usageType,
      maxRecordingMinutesPerClip,
      autoStopAt,
      stopReason: null,
      usageCounted: false,
      usageCountedAt: null,
      storageCounted: false,
    };

    let previousEmergency: EmergencyCurrentDoc | null = null;

    if (isEmergency) {
      // Transactionally enforce: only one active emergency recording per user.
      previousEmergency = await firestore.runTransaction(async (tx) => {
        const currentSnap = await tx.get(emergencyCurrentRef);
        const currentData = currentSnap.exists ? ((currentSnap.data() || {}) as EmergencyCurrentDoc) : null;

        // If there's an existing emergency recording that isn't deleted, mark its recording doc as deleting.
        if (currentData) {
          const currentStatus = String(currentData.status || "").toLowerCase();
          const oldRecordingId = currentData.recordingId ? String(currentData.recordingId) : "";
          if (currentStatus !== "deleted" && oldRecordingId) {
            tx.set(
              firestore.collection("recordings").doc(oldRecordingId),
              {
                status: "deleting",
                deleteReason: "replaced_emergency",
                deletingAt: now,
                updatedAt: now,
              },
              { merge: true }
            );
          }
        }

        // Always write the new recording doc as part of the same transaction.
        tx.set(recordingRef, initialDoc);

        // Overwrite current pointer
        tx.set(
          emergencyCurrentRef,
          {
            recordingId,
            createdAt: now,
            expiresAt: emergencyExpiresAt,
            emergencyAvailableUntilMs: emergencyExpiresAtMs,
            deleteAfterMs: emergencyExpiresAtMs,
            status: "active",
            r2Keys: [objectKey],
            r2Prefix,
          },
          { merge: false }
        );

        return currentData;
      });
    } else {
      await recordingRef.set(initialDoc);
    }

    console.log(`[recordings/start] Created doc ${recordingId} status=starting`);

    // Best-effort: publish latest recording pointer on the room doc.
    try {
      await roomRef.set(
        {
          latestRecordingId: recordingId,
          latestRecordingStatus: "starting",
          latestRecordingUpdatedAt: now,
        },
        { merge: true }
      );
    } catch (e: any) {
      console.warn("[recordings/start] failed to set room latestRecording pointer", e?.message || e);
    }

    // Best-effort: if this replaced an older emergency recording, delete its assets asynchronously.
    if (isEmergency && previousEmergency?.recordingId && previousEmergency.recordingId !== recordingId) {
      const old = previousEmergency;
      setTimeout(async () => {
        try {
          const oldRecordingId = String(old.recordingId || "").trim();
          if (!oldRecordingId) return;

          const oldKeys = Array.isArray(old.r2Keys)
            ? old.r2Keys.map(String).map((s) => s.trim()).filter(Boolean)
            : [];
          const oldPrefix = old.r2Prefix ? String(old.r2Prefix).trim() : "";

          if (oldKeys.length > 0) {
            await deleteFiles(oldKeys);
          } else if (oldPrefix) {
            await deletePrefix(oldPrefix);
          }

          // Release the replaced recording's counted storage (billing uid, once).
          await releaseRecordingStorageOnce(firestore.collection("recordings").doc(oldRecordingId), {
            caller: "recordings.start.replaceEmergency",
          }).catch((e: any) =>
            console.error("[recordings/start] storage release failed for replaced emergency recording", {
              recordingId: oldRecordingId,
              error: e?.message || e,
            })
          );

          await firestore
            .collection("recordings")
            .doc(oldRecordingId)
            .set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }, { merge: true });
        } catch (e: any) {
          console.warn("[recordings/start] failed to delete replaced emergency recording assets", e?.message || e);
        }
      }, 0);
    }

    // Initialize lock doc (best-effort)
    try {
      await activeRef.set(
        {
          uid,
          roomId,
          roomName: roomAccess.roomName || roomId,
          recordingId,
          status: "starting",
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("[recordings/start] failed to create activeRecordings lock", (e as any)?.message);
    }

    if (hasActiveStream) {
      try {
        await firestore
          .collection("activeStreams")
          .doc(streamDocId)
          .set({ usageType: "live+recording", lastRecordingId: recordingId }, { merge: true });
      } catch (e) {
        console.warn("[recordings/start] failed to tag active stream usageType", (e as any)?.message);
      }
    }

    // =========================================================================
    // STEP 2: Start LiveKit egress to R2
    // =========================================================================
    let egressId: string | null = null;

    try {
      const { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } = await getLiveKitSdk();

      const egressClient = new EgressClient(livekitCfg.url!, livekitCfg.apiKey!, livekitCfg.apiSecret!);

      const s3UploadConfig = {
        bucket: r2Cfg.bucket,
        endpoint: r2Cfg.endpoint,
        region: "auto",
        accessKey: r2Cfg.accessKeyId,
        secret: r2Cfg.secretAccessKey,
        forcePathStyle: true,
      };

      const configErrors: string[] = [];
      if (!s3UploadConfig.bucket) configErrors.push("bucket is empty");
      if (!s3UploadConfig.endpoint) configErrors.push("endpoint is empty");
      if (!s3UploadConfig.accessKey) configErrors.push("accessKey is empty");
      if (!s3UploadConfig.secret) configErrors.push("secret is empty");
      if (!s3UploadConfig.endpoint?.includes(".r2.cloudflarestorage.com")) {
        configErrors.push(`endpoint format wrong: ${s3UploadConfig.endpoint}`);
      }
      if (objectKey.startsWith("/")) {
        configErrors.push(`objectKey has leading slash: ${objectKey}`);
      }

      if (configErrors.length > 0) {
        console.error("[recordings/start] S3 config errors:", configErrors);
        await recordingRef.update({
          status: "failed",
          errorMessage: `S3 config errors: ${configErrors.join(", ")}`,
          updatedAt: new Date(),
        });
        return res.status(500).json({
          success: false,
          error: "S3 configuration invalid",
          details: configErrors,
        });
      }

      console.log("[recordings/start] S3Upload config:", {
        bucket: s3UploadConfig.bucket,
        endpoint: s3UploadConfig.endpoint,
        region: s3UploadConfig.region,
        forcePathStyle: s3UploadConfig.forcePathStyle,
        accessKey: "set",
        secret: "set",
        objectKey: objectKey,
      });

      const s3Upload = new S3Upload(s3UploadConfig);

      const fileOutput = new EncodedFileOutput({
        filepath: objectKey,
        fileType: EncodedFileType.MP4,
        output: { case: "s3", value: s3Upload },
      });

      console.log("[recordings/start] File output config:", {
        filepath: objectKey,
        fileType: "MP4",
        outputCase: (fileOutput as any)?.output?.case,
        fileOutputKeys: Object.keys(fileOutput || {}),
      });

      // Prefer custom program-compositor template so recordings reflect
      // the host's layout choices (programState via room metadata).
      const customBaseUrl = compositorUrl("landscape") || undefined;
      if (!customBaseUrl) warnBuiltInLayoutFallback("recording", layout);

      const compositeOpts = {
        ...(customBaseUrl ? { customBaseUrl } : { layout: layout }),
        audioOnly: false,
        videoOnly: false,
      };

      if (process.env.AUTH_DEBUG === "1") {
        console.log("[livekit-debug] startRoomCompositeEgress (recording)", {
          livekitRoomName,
          objectKey,
          layout: customBaseUrl ? "(custom compositor)" : layout,
          customBaseUrl: customBaseUrl || undefined,
        });
      }

      const egressResp = await egressClient.startRoomCompositeEgress(livekitRoomName, fileOutput, {
        ...compositeOpts,
        encodingOptions,
      });

      egressId = (egressResp as any)?.egressId || null;

      if (!egressId) {
        throw new Error("No egressId returned from LiveKit");
      }

      console.log(`[recordings/start] Egress started: ${egressId}`);
    } catch (egressError: any) {
      console.error("[recordings/start] Egress start failed:", {
        message: egressError?.message,
        code: egressError?.code,
        details: egressError?.details,
        twirpMsg: egressError?.msg,
        twirpMeta: egressError?.meta,
        responseData: egressError?.response?.data,
        stack: egressError?.stack?.slice(0, 500),
      });

      await recordingRef.update({
        status: "failed",
        errorMessage: egressError?.message || "egress_start_failed",
        updatedAt: new Date(),
      });

      return res.status(500).json({
        success: false,
        error: "Failed to start recording",
        recordingId,
        details: egressError?.message,
      });
    }

    // =========================================================================
    // STEP 3: Update doc to status=recording with egressId
    // =========================================================================
    await recordingRef.update({
      egressId,
      status: "recording",
      livekitStatus: "EGRESS_STARTING",
      updatedAt: new Date(),
    });

    // Mark lock as fully active
    try {
      await activeRef.set(
        {
          status: "recording",
          updatedAt: new Date(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("[recordings/start] failed to update activeRecordings lock", (e as any)?.message);
    }

    console.log(`[recordings/start] Complete in ${Date.now() - startTime}ms, maxRecordingMinutesPerClip=${maxRecordingMinutesPerClip}, autoStopAt=${autoStopAt?.toISOString() ?? "none"}`);

    const finalSnap = await recordingRef.get();
    const finalData = finalSnap.data();

    return res.json({
      success: true,
      recordingId,
      egressId,
      recording: finalData,
      effectivePresetId: effectiveId,
      requestedPresetId: requestedId,
      presetClamped: clamped || clampedToStream,
      presetClampedToStream: clampedToStream,
      streamPresetId: activeStreamPresetId,
      maxRecordingMinutesPerClip,
      autoStopAt: autoStopAt?.toISOString() ?? null,
    });

  } catch (err: any) {
    console.error("[recordings/start] Unexpected error:", err);
    return res.status(500).json({
      error: "Failed to start recording",
      details: err?.message,
    });
  }
  }
);

// =============================================================================
// POST /sweep - Stop overdue recordings based on autoStopAt
// Intended for a scheduled job / admin trigger
// =============================================================================

// Cron callers send x-maintenance-key (same key as /api/maintenance); anyone
// else must be an admin.
function requireMaintenanceOrAdmin(req: any, res: any, next: any) {
  const key = String(process.env.MAINTENANCE_KEY || "").trim();
  const headerKey = String(req.headers["x-maintenance-key"] || "").trim();
  if (key && headerKey) {
    const a = Buffer.from(headerKey);
    const b = Buffer.from(key);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  return requireAdmin(req, res, next);
}

router.post("/sweep", requireMaintenanceOrAdmin, async (_req, res) => {
  // Same code path as the scheduled "recording-enforcement" job (lib/jobs),
  // which also computes autoStopAt from entitlements when it is missing.
  const { runJob } = await import("../lib/jobs/index.js");
  const out = await runJob("recording-enforcement", { trigger: "maintenance", force: true });
  if (out.status === "skipped") return res.status(409).json({ ok: false, skipped: true, reason: out.reason });
  if (!out.ran) return res.status(500).json({ error: "sweep_failed", details: out.error || out.status });
  const details = (out.details || {}) as Record<string, any>;
  if (out.status === "error" && Object.keys(details).length === 0) {
    return res.status(500).json({ error: "sweep_failed", details: out.error });
  }
  return res.json({ ok: true, processed: Number(details.stopped || 0), ...details });
});

// =============================================================================
// POST /stop - Stop Recording
// =============================================================================

// No requireMyContentRecordingsEnabled here: a running egress must always be
// stoppable, even if recordings were kill-switched mid-session.
router.post(
  "/stop",
  requireAuth,
  requireRoomAccessToken as any,
  async (req, res) => {
  console.log("[recordings/stop] Request received");

  try {
    const uid = getAuthUserId(req);
    if (!uid) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    const { recordingId } = req.body as { recordingId?: string };
    if (!recordingId) {
      return res.status(400).json({ error: "recordingId is required" });
    }

    const recordingRef = firestore.collection("recordings").doc(recordingId);
    const snap = await recordingRef.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = snap.data() || {};

    const { roomId: canonicalRoomId } = getRoomAccess(req as any);

    // If the recording has a stored roomId, ensure it matches the caller's room
    const recordingRoomId: string | null = typeof (data as any).roomId === "string" ? (data as any).roomId.trim() : null;
    if (recordingRoomId && recordingRoomId !== canonicalRoomId) {
      return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    const roomId = canonicalRoomId;

    try {
      await assertRoomPerm(req as any, roomId, "canRecord");
    } catch (err: any) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code });
      }
      throw err;
    }

    // Calculate duration
    const now = new Date();
    const startedAt: Date | null = data.startedAt?.toDate?.()
      ? data.startedAt.toDate()
      : data.startedAt || null;
    const durationMs = startedAt ? Math.max(0, now.getTime() - startedAt.getTime()) : 0;
    const durationSeconds = Math.floor(durationMs / 1000);

    // =========================================================================
    // Stop LiveKit egress using stored egressId
    // =========================================================================
    const egressId = data.egressId;
    if (egressId) {
      try {
        const livekitCfg = getLiveKitConfig();
        if (livekitCfg.isConfigured) {
          const { EgressClient } = await getLiveKitSdk();
          const egressClient = new EgressClient(
            livekitCfg.url!,
            livekitCfg.apiKey!,
            livekitCfg.apiSecret!
          );
          await egressClient.stopEgress(egressId);
          console.log(`[recordings/stop] Stopped egress: ${egressId}`);
        }
      } catch (stopErr: any) {
        // Log but don't fail - egress might already be stopped
        console.warn("[recordings/stop] stopEgress warning:", stopErr?.message);
      }
    } else {
      console.warn("[recordings/stop] No egressId to stop for:", recordingId);
    }

    // =========================================================================
    // Update the recording doc and count recording minutes [startedAt, stop]
    // to the room owner in one transaction (idempotent via usageCounted).
    // =========================================================================
    // activeRecordings lock + My Content stay keyed by the actor who started
    // it (userId); usage + storage are billed to the room owner.
    const accountUid: string = typeof (data as any).userId === "string" && (data as any).userId.trim()
      ? (data as any).userId.trim()
      : uid;
    const billingUid = recordingBillingUid(data, accountUid) || accountUid;

    await countRecordingMinutes(recordingRef, {
      endedAt: now,
      now,
      patch: (recData) => ({
        status: "processing",
        stoppedAt: recData.stoppedAt || now,
        endedAt: recData.endedAt || now,
        duration: recData.usageCounted === true ? recData.duration ?? durationSeconds : durationSeconds,
        durationSeconds: recData.usageCounted === true ? recData.durationSeconds ?? durationSeconds : durationSeconds,
        durationMs: recData.usageCounted === true ? recData.durationMs ?? durationMs : durationMs,
        updatedAt: now,
        downloadReady: false,
        downloadPath: recData.objectKey || recData.downloadPath || null,
      }),
    });

    console.log(`[recordings/stop] Recording ${recordingId} now processing`);

    // Viewer numbers come from the server's live session, never the client.
    await copyViewerStatsToRecording(recordingRef, roomId);

    // Release active recording lock for this (user, room)
    try {
      const roomId = typeof (data as any).roomId === "string" ? (data as any).roomId : null;
      const roomName = typeof data.roomName === "string" ? data.roomName : null;
      const roomKey = roomId || roomName;
      if (roomKey) {
        const activeKey = `${accountUid}_${roomKey}`;
        const activeRef = firestore.collection("activeRecordings").doc(activeKey);
        await activeRef.set(
          {
            status: "stopped",
            stoppedAt: now,
            endedAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    } catch (lockErr: any) {
      console.warn("[recordings/stop] failed to update activeRecordings lock", lockErr?.message);
    }

    // Best-effort post-stop verification in case webhooks are delayed or dropped
    const objectKey = data.objectKey as string | undefined;
    if (objectKey) {
      setTimeout(async () => {
        try {
          const size = await r2HeadObjectSize(objectKey);
          if (size > 0) {
            // Flip storageCounted inside a transaction: the egress_ended
            // webhook may race us, and only the call that performs the flip
            // may count the bytes.
            const flip = await firestore.runTransaction(async (tx) => {
              const freshSnap = await tx.get(recordingRef);
              if (!freshSnap.exists) return { skip: true, claimed: false };
              const freshData = (freshSnap.data() || {}) as any;
              const freshStatus = String(freshData.status || "").toLowerCase();
              if (freshStatus === "deleted" || freshStatus === "deleting") return { skip: true, claimed: false };
              const claimed = shouldClaimStorageCount(freshData, size);
              tx.update(recordingRef, {
                status: "ready",
                downloadReady: true,
                readyAt: freshData.readyAt || new Date(),
                fileSize: size,
                updatedAt: new Date(),
                ...(claimed ? { storageCounted: true } : {}),
              });
              return { skip: false, claimed };
            });
            if (flip.skip) {
              console.warn(`[recordings/stop] head-check skipped: recording ${recordingId} missing or deleted`);
              return;
            }
            const alreadyCounted = !flip.claimed;
            console.log(`[recordings/stop] ✅ File confirmed via head-check: ${objectKey} (${size} bytes)`);

            // Count storage for this recording (only if this call flipped storageCounted)
            if (!alreadyCounted && billingUid) {
              try {
                await reserveStorageUsage(billingUid, size, {
                  caller: "recordings.stop.headcheck",
                  recordingId,
                  objectKey,
                });
              } catch (e: any) {
                console.error("[recordings/stop] storage accounting failed:", {
                  userId: billingUid, recordingId, size, error: e?.message || e,
                });
              }
            }

            // Auto-create saved_video so recording appears in My Content
            try {
              const roomName = typeof data.roomName === "string" ? data.roomName : "";
              const videoUrl = typeof data.videoUrl === "string" ? data.videoUrl : "";
              const thumbUrl = typeof data.thumbnailUrl === "string" ? data.thumbnailUrl : null;
              const durationSec = typeof data.durationSeconds === "number" ? data.durationSeconds : null;
              await createSavedVideoFromRecording({
                userId: accountUid,
                recordingId,
                title: roomName || data.title || "Untitled Recording",
                playbackUrl: videoUrl,
                thumbnailUrl: thumbUrl,
                durationMs: durationSec ? Math.round(durationSec * 1000) : 0,
                fileSize: size,
              });
            } catch (savedErr: any) {
              console.warn("[recordings/stop] failed to auto-create saved_video:", savedErr?.message);
            }
          } else {
            console.warn(`[recordings/stop] head-check found no file yet for ${objectKey}`);
          }
        } catch (checkErr: any) {
          console.warn(`[recordings/stop] head-check error for ${objectKey}:`, checkErr?.message);
        }
      }, 4000);
    }

    return res.json({ ok: true, success: true, recordingId });

  } catch (err: any) {
    console.error("[recordings/stop] Error:", err);
    return res.status(500).json({ error: "Failed to stop recording" });
  }
  }
);

// =============================================================================
// GET /library - List ready platform recordings for My Content import
// =============================================================================

router.get("/library", requireAuth, requireMyContentRecordingsEnabled as any, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    if (!uid) {
      return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });
    }

    const snap = await firestore
      .collection("recordings")
      .where("userId", "==", uid)
      .get();

    const recordings = snap.docs
      .map((doc) => {
        const data = doc.data();
        const status = String(data.status || "unknown").toLowerCase();
        return {
          id: doc.id,
          title: data.title || data.roomName || "Untitled",
          roomName: data.roomName || null,
          status,
          thumbnailUrl: data.thumbnailUrl || null,
          videoUrl: data.videoUrl || null,
          duration: data.duration || 0,
          fileSize: data.fileSize || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      })
      // Show ready recordings enabled, processing ones disabled (handled client-side), hide failed
      .filter((r) => r.status === "ready" || r.status === "processing")
      .sort((a, b) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
      });

    return res.json(recordings);
  } catch (err: any) {
    console.error("[recordings/library] Error:", err);
    return res.status(500).json({ error: "Failed to fetch recordings library" });
  }
});

// =============================================================================
// GET /:id/storage-check - Debug: verify object exists in R2
// =============================================================================

router.get("/:id/storage-check", requireAuth, requireMyContentRecordingsEnabled as any, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = String(req.params.id ?? "");

    const snap = await firestore.collection("recordings").doc(recordingId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = snap.data() || {};
    if (data.userId && data.userId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const objectKey = normalizeStorageKey(data.objectKey || data.downloadPath);
    if (!objectKey) {
      return res.json({ success: false, message: "No object key on recording" });
    }

    const size = await r2HeadObjectSize(objectKey);
    return res.json({ success: size > 0, size, objectKey });

  } catch (err: any) {
    console.error("[recordings/storage-check] Error:", err);
    return res.status(500).json({ error: "Failed to check storage" });
  }
});

// =============================================================================
// GET /:id - Get recording status
// =============================================================================

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = String(req.params.id ?? "");

    const snap = await firestore.collection("recordings").doc(recordingId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = snap.data() || {};
    if (data.userId && data.userId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    return res.json({ success: true, data: mapRecordingDoc(recordingId, data) });

  } catch (err: any) {
    console.error("[recordings/:id] Error:", err);
    return res.status(500).json({ error: "Failed to fetch recording" });
  }
});

// =============================================================================
// DELETE /:id - Delete a recording (bucket + Firestore)
// Default behavior is SOFT delete (status="deleted"); pass ?hard=1 to delete the doc.
// =============================================================================

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = String(req.params.id ?? "");

    const snap = await firestore.collection("recordings").doc(recordingId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = snap.data() || {};
    if (data.userId && data.userId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    const storage = await deleteRecordingStorage(data);

    // Release counted storage from the billing uid exactly once (transactional,
    // gated on storageCounted / storageReleased).
    try {
      await releaseRecordingStorageOnce(firestore.collection("recordings").doc(recordingId), {
        caller: "recordings.DELETE",
      });
    } catch (e: any) {
      console.error("[recordings] storage release failed:", {
        userId: uid, recordingId, error: e?.message || e,
      });
    }

    // Best-effort: if the room pointer points to this recording, clear it.
    try {
      const roomId = typeof data.roomId === "string" ? String(data.roomId).trim() : "";
      if (roomId) {
        const roomRef = firestore.collection("rooms").doc(roomId);
        const roomSnap = await roomRef.get();
        const roomData = roomSnap.exists ? ((roomSnap.data() as any) || {}) : {};
        const latestId = String(roomData.latestRecordingId || "").trim();
        if (latestId === recordingId) {
          await roomRef.set(
            {
              latestRecordingId: null,
              latestRecordingStatus: null,
              latestRecordingUpdatedAt: new Date(),
            },
            { merge: true }
          );
        }
      }
    } catch {}

    // Best-effort: keep emergency pointer from referencing a deleted recording.
    try {
      const recordingClass = String(data.recordingClass || "").toLowerCase();
      if (recordingClass === "emergency") {
        const currentRef = firestore.collection("users").doc(uid).collection("emergencyRecording").doc("current");
        const curSnap = await currentRef.get();
        const cur = curSnap.exists ? ((curSnap.data() as any) || {}) : {};
        if (String(cur.recordingId || "") === recordingId) {
          await currentRef.set(
            {
              status: "deleted",
              deletedAt: new Date(),
              updatedAt: new Date(),
            },
            { merge: true }
          );
        }
      }
    } catch {}

    const hard = req.query.hard === "1" || req.query.hard === "true";
    if (hard) {
      await firestore.collection("recordings").doc(recordingId).delete();
    } else {
      await firestore.collection("recordings").doc(recordingId).set(
        {
          status: "deleted",
          deleteReason: "user_deleted",
          deletedAt: new Date(),
          updatedAt: new Date(),
          downloadReady: false,
          storageReleased: true,
        },
        { merge: true }
      );
    }

    return res.json({ success: true, recordingId, hard, storage });
  } catch (err: any) {
    console.error("[recordings/:id delete] Error:", err);
    return res.status(500).json({ error: "Failed to delete recording" });
  }
});

// =============================================================================
// GET /:id/download-link - Get signed download URL (only if status=ready)
// Per spec: 15-minute TTL, strict status === "ready" check
// =============================================================================

export type RecordingDownloadLinkOutcome = {
  kind: "ok" | "feature_disabled" | "forbidden" | "not_ready" | "expired" | "paywall" | "missing_key" | "sign_failed";
  httpStatus: number;
  body: Record<string, any>;
  url?: string;
  expiresIn?: number;
};

/**
 * Single implementation of the recording download-link rules, shared by
 * GET /api/recordings/:id/download-link and GET /api/rooms/:roomId/latest-recording:
 * platform feature flag, ownership, strict status === "ready" + downloadReady,
 * retention expiry, paywall, and a 15-minute signed URL.
 */
export async function buildRecordingDownloadLink(params: {
  uid: string | null;
  recordingId: string;
  data: any;
  confirm?: boolean;
}): Promise<RecordingDownloadLinkOutcome> {
  const { uid, recordingId } = params;
  const data = params.data || {};

  const flags = await getMyContentPlatformFlags();
  if (!flags.myContentRecordingsEnabled) {
    return {
      kind: "feature_disabled",
      httpStatus: 403,
      body: {
        error: LIMIT_ERRORS.FEATURE_DISABLED,
        feature: "myContentRecordingsEnabled",
        reason: "Recordings are disabled by featureFlags/myContentRecordingsEnabled",
        platformFlags: flags,
      },
    };
  }

  // Verify ownership
  if (data.userId && data.userId !== uid) {
    return { kind: "forbidden", httpStatus: 403, body: { error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS } };
  }

  // STRICT CHECK: only status === "ready" (webhook verified the file in R2),
  // then retention expiry, then paywall.
  const rules = evaluateDownloadRules(data, Date.now(), DEFAULT_RETENTION_MINUTES);
  if (rules.kind === "not_ready") {
    return {
      kind: "not_ready",
      httpStatus: 200,
      body: { success: false, downloadReady: false, status: rules.status, message: rules.message },
    };
  }
  if (rules.kind === "expired") {
    return { kind: "expired", httpStatus: 410, body: { success: false, expired: true, message: "Recording link expired" } };
  }
  if (rules.kind === "paywall") {
    return { kind: "paywall", httpStatus: 402, body: { success: false, paywall: true, message: "Upgrade required to download" } };
  }
  if (rules.kind === "missing_key" || !rules.objectKey) {
    return { kind: "missing_key", httpStatus: 500, body: { success: false, error: "Missing recording file reference" } };
  }

  // Signed URL with 15-minute TTL per spec
  let signedUrl: string;
  try {
    signedUrl = await getSignedDownloadUrl(rules.objectKey, DOWNLOAD_LINK_TTL_SECONDS);
  } catch (e: any) {
    console.error("[recordings/download-link] Signed URL error:", e);
    return {
      kind: "sign_failed",
      httpStatus: 500,
      body: { success: false, error: "Download link unavailable. Try Emergency Download." },
    };
  }

  // Track download request
  const updates: any = { lastDownloadRequestedAt: Timestamp.now() };
  if (params.confirm) updates.downloadConfirmedAt = Timestamp.now();
  await firestore.collection("recordings").doc(recordingId).set(updates, { merge: true });

  return {
    kind: "ok",
    httpStatus: 200,
    url: signedUrl,
    expiresIn: DOWNLOAD_LINK_TTL_SECONDS,
    body: {
      success: true,
      data: { url: signedUrl, downloadReady: true, expiresIn: DOWNLOAD_LINK_TTL_SECONDS },
    },
  };
}

router.get("/:id/download-link", requireAuth, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = String(req.params.id ?? "");

    const snap = await firestore.collection("recordings").doc(recordingId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const confirm = req.query.confirm === "true" || req.query.confirm === "1";
    const outcome = await buildRecordingDownloadLink({ uid, recordingId, data: snap.data() || {}, confirm });
    return res.status(outcome.httpStatus).json(outcome.body);
  } catch (err: any) {
    console.error("[recordings/download-link] Error:", err);
    return res.status(500).json({ error: "Failed to generate download link" });
  }
});

// =============================================================================
// POST /:id/report-download-issue - Report download problems
// =============================================================================

router.post("/:id/report-download-issue", requireAuth, requireMyContentRecordingsEnabled as any, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = String(req.params.id ?? "");

    const snap = await firestore.collection("recordings").doc(recordingId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = snap.data() || {};
    if (data.userId && data.userId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    await firestore.collection("recordings").doc(recordingId).set(
      {
        downloadIssueReportedAt: Timestamp.now(),
        downloadIssueNote: req.body?.reason || null,
        lastDownloadRequestedAt: Timestamp.now(),
      },
      { merge: true }
    );

    return res.json({ success: true });

  } catch (err: any) {
    console.error("[recordings/report-download-issue] Error:", err);
    return res.status(500).json({ error: "Failed to report issue" });
  }
});

// =============================================================================
// GET /:id/download - Legacy direct download (placeholder)
// =============================================================================

router.get("/:id/download", requireAuth, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = String(req.params.id ?? "");

    const snap = await firestore.collection("recordings").doc(recordingId).get();
    if (!snap.exists) {
      return res.status(404).send("Recording not found");
    }

    const data = snap.data() || {};
    if (data.userId && data.userId !== uid) {
      return res.status(403).send(PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS);
    }

    // Redirect to download-link endpoint for proper signed URL
    res.redirect(`/api/recordings/${recordingId}/download-link`);

  } catch (err: any) {
    console.error("[recordings/download] Error:", err);
    return res.status(500).send("Failed to serve download");
  }
});

export default router;
