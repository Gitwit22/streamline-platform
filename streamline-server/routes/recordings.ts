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
import { firestore } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "../middleware/roomAccessToken";
import { canAccessFeature } from "./featureAccess";
import { clampRecordingPreset, getUserPlanId, toEncodingOptions } from "../lib/mediaPresets";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { Timestamp } from "firebase-admin/firestore";
import { getCurrentMonthKey } from "../lib/usageTracker";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { evaluateUsageGate } from "../lib/usageOverages";
import { upsertUsageMonthlyOverageTotals } from "../lib/usageOveragesWriter";
import { deleteFiles, deletePrefix } from "../lib/storageClient";
import { resolveCompositeLayoutFromRoom } from "../lib/roomLayout";
import { deleteRecordingStorage } from "../lib/recordingDeletion";
import { createSavedVideoFromRecording } from "./myContent";
import { releaseStorageUsage, reserveStorageUsage } from "../usageHelper";

const router = Router();

type MyContentPlatformFlags = {
  myContentEnabled: boolean;
  myContentRecordingsEnabled: boolean;
};

let cachedMyContentFlags: MyContentPlatformFlags | null = null;
let cachedMyContentFlagsAt = 0;
const MY_CONTENT_FLAGS_TTL_MS = 30 * 1000;

async function getMyContentPlatformFlags(): Promise<MyContentPlatformFlags> {
  const now = Date.now();
  if (cachedMyContentFlags && now - cachedMyContentFlagsAt < MY_CONTENT_FLAGS_TTL_MS) {
    return cachedMyContentFlags;
  }

  try {
    const [myContentSnap, myContentRecordingsSnap] = await Promise.all([
      firestore.collection("featureFlags").doc("myContentEnabled").get(),
      firestore.collection("featureFlags").doc("myContentRecordingsEnabled").get(),
    ]);

    const myContentData = myContentSnap.exists ? ((myContentSnap.data() as any) || {}) : {};
    const myContentRecordingsData = myContentRecordingsSnap.exists
      ? ((myContentRecordingsSnap.data() as any) || {})
      : {};

    const myContentEnabled = myContentData.enabled === true;
    // Recording pipeline is controlled by featureFlags/recording.
    // This flag is an additional opt-out. Missing => enabled.
    const rawMyContentRecordingsEnabled = (myContentRecordingsData as any).enabled;
    const myContentRecordingsEnabled =
      rawMyContentRecordingsEnabled === undefined ? true : rawMyContentRecordingsEnabled === true;

    cachedMyContentFlags = {
      myContentEnabled,
      myContentRecordingsEnabled,
    };
    cachedMyContentFlagsAt = now;
    return cachedMyContentFlags;
  } catch (err) {
    console.error("[recordings] failed to load My Content platform flags", err);
    cachedMyContentFlags = {
      myContentEnabled: false,
      // Fail-open to avoid breaking recording when Firestore is transient.
      myContentRecordingsEnabled: true,
    };
    cachedMyContentFlagsAt = now;
    return cachedMyContentFlags;
  }
}

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

function toNumber(value: any): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function incrementRecordingUsage(uid: string, minutes: number) {
  if (!minutes || minutes < 0) return;

  const monthKey = getCurrentMonthKey();
  const usageDocId = `${uid}_${monthKey}`;
  const usageRef = firestore.collection("usageMonthly").doc(usageDocId);

  let alertContext: {
    liveCurrent: number;
    liveLifetime: number;
    recordingCurrent: number;
    recordingLifetime: number;
    added: number;
  } | null = null;

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const existing = snap.exists ? (snap.data() as any) : {};
    const usage = existing.usage || {};
    const ytd = existing.ytd || {};

    const prevMinutes = usage.minutes || {};
    const prevYtdMinutes = ytd.minutes || {};

    const liveCurrent = toNumber(prevMinutes.live?.currentPeriod);
    const liveLifetime = toNumber(prevMinutes.live?.lifetime ?? prevYtdMinutes.live?.lifetime);
    const recCurrent = toNumber(prevMinutes.recording?.currentPeriod);
    const recLifetime = toNumber(prevMinutes.recording?.lifetime ?? prevYtdMinutes.recording?.lifetime);

    const nextUsage = {
      ...usage,
      participantMinutes: toNumber(usage.participantMinutes) + minutes,
      transcodeMinutes: toNumber(usage.transcodeMinutes),
      minutes: {
        live: {
          currentPeriod: liveCurrent,
          lifetime: liveLifetime,
        },
        recording: {
          currentPeriod: recCurrent + minutes,
          lifetime: recLifetime + minutes,
        },
      },
    };

    const nextYtd = {
      ...ytd,
      participantMinutes: toNumber(ytd.participantMinutes) + minutes,
      transcodeMinutes: toNumber(ytd.transcodeMinutes),
      minutes: {
        live: {
          lifetime: toNumber(prevYtdMinutes.live?.lifetime ?? liveLifetime),
        },
        recording: {
          lifetime: recLifetime + minutes,
        },
      },
    };

    tx.set(
      usageRef,
      {
        uid,
        monthKey,
        usage: nextUsage,
        ytd: nextYtd,
        createdAt: existing.createdAt || new Date(),
        updatedAt: new Date(),
      },
      { merge: true }
    );

    alertContext = {
      liveCurrent: nextUsage.minutes.live.currentPeriod,
      liveLifetime: nextYtd.minutes.live.lifetime,
      recordingCurrent: nextUsage.minutes.recording.currentPeriod,
      recordingLifetime: nextYtd.minutes.recording.lifetime,
      added: minutes,
    };
  });

  if (alertContext) {
    const ratio = 3;
    if (alertContext.recordingCurrent > alertContext.liveCurrent * ratio) {
      console.warn("[usage][recording] recording minutes high vs live", { uid, ...alertContext, ratio });
    }
    if (minutes >= 240) {
      console.warn("[usage][recording] long single recording detected", { uid, minutes });
    }
  }
}

function computeExpiry(
  readyAt?: Timestamp | Date | null,
  retentionMinutes: number = DEFAULT_RETENTION_MINUTES
): Date | null {
  if (!readyAt) return null;
  const readyDate = readyAt instanceof Timestamp ? readyAt.toDate() : readyAt;
  return new Date(readyDate.getTime() + retentionMinutes * 60 * 1000);
}

function isExpired(readyAt?: Timestamp | Date | null, retentionMinutes?: number): boolean {
  const expires = computeExpiry(readyAt, retentionMinutes);
  return expires ? Date.now() >= expires.getTime() : false;
}

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

async function stopRecordingInternal(options: {
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
  const billedMinutes = durationMs > 0 ? Math.max(1, Math.ceil(durationMs / 60000)) : 0;

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

  // Update recording doc and usage in a single transaction (idempotent)
  let usageCountedAlready = false;

  const toNumber = (value: any) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const usageType = typeof data.usageType === "string" ? data.usageType : "recording_only";

  await firestore.runTransaction(async (tx) => {
    const recSnap = await tx.get(recordingRef);
    if (!recSnap.exists) throw new Error("recording_missing");
    const recData = recSnap.data() || {};

    const monthKey = getCurrentMonthKey();
    const usageRef = firestore.collection("usageMonthly").doc(`${uid}_${monthKey}`);
    const usageSnap = await tx.get(usageRef);
    const existingUsage = usageSnap.exists ? (usageSnap.data() as any) : {};
    const usage = existingUsage.usage || {};
    const ytd = existingUsage.ytd || {};
    const minutes = usage.minutes || {};
    const ytdMinutes = ytd.minutes || {};

    const liveCurrent = toNumber(minutes.live?.currentPeriod);
    const liveLifetime = toNumber(minutes.live?.lifetime ?? ytdMinutes.live?.lifetime);
    const recCurrentPrev = toNumber(minutes.recording?.currentPeriod);
    const recLifetimePrev = toNumber(minutes.recording?.lifetime ?? ytdMinutes.recording?.lifetime);
    const totalCurrentPrev = toNumber(minutes.total?.currentPeriod);
    const totalLifetimePrev = toNumber(minutes.total?.lifetime ?? ytdMinutes.total?.lifetime);

    const byUsageTypePrev = minutes.byUsageType || {};
    const byUsageTypeYtd = ytdMinutes.byUsageType || {};
    const typePrev = byUsageTypePrev[usageType] || {};
    const typeLifetimePrev = toNumber(typePrev.lifetime ?? byUsageTypeYtd[usageType]?.lifetime);

    if (recData.usageCounted === true) {
      usageCountedAlready = true;
      tx.update(recordingRef, {
        status: "processing",
        stoppedAt: recData.stoppedAt || now,
        endedAt: recData.endedAt || now,
        duration: recData.duration ?? durationSeconds,
        durationSeconds: recData.durationSeconds ?? durationSeconds,
        durationMs: recData.durationMs ?? durationMs,
        billedMinutes: recData.billedMinutes ?? billedMinutes,
        stopReason: recData.stopReason || reason,
        updatedAt: now,
        downloadReady: false,
        downloadPath: recData.objectKey || recData.downloadPath || null,
      });
      return;
    }

    const billed = billedMinutes;

    const nextMinutes = {
      ...minutes,
      live: {
        currentPeriod: liveCurrent,
        lifetime: liveLifetime,
      },
      recording: {
        currentPeriod: recCurrentPrev + billed,
        lifetime: recLifetimePrev + billed,
      },
      total: {
        currentPeriod: totalCurrentPrev + billed,
        lifetime: totalLifetimePrev + billed,
      },
      byUsageType: {
        ...byUsageTypePrev,
        [usageType]: {
          currentPeriod: toNumber(typePrev.currentPeriod) + billed,
          lifetime: typeLifetimePrev + billed,
        },
      },
    };

    const nextYtdMinutes = {
      ...ytdMinutes,
      live: { lifetime: liveLifetime },
      recording: { lifetime: recLifetimePrev + billed },
      total: { lifetime: totalLifetimePrev + billed },
      byUsageType: {
        ...byUsageTypeYtd,
        [usageType]: { lifetime: typeLifetimePrev + billed },
      },
    };

    tx.update(recordingRef, {
      status: "processing",
      stoppedAt: now,
      endedAt: now,
      duration: durationSeconds,
      durationSeconds,
      durationMs,
      billedMinutes: billed,
      usageCounted: true,
      usageCountedAt: now,
      stopReason: recData.stopReason || reason,
      updatedAt: now,
      downloadReady: false,
      downloadPath: data.objectKey || null,
    });

    tx.set(
      usageRef,
      {
        uid,
        monthKey,
        usage: {
          ...usage,
          minutes: nextMinutes,
        },
        ytd: {
          ...ytd,
          minutes: nextYtdMinutes,
        },
        createdAt: existingUsage.createdAt || now,
        updatedAt: now,
      },
      { merge: true }
    );
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

    // Feature access gate
    const featureAccess = await canAccessFeature((req as any).account || uid, "recording");
    if (!featureAccess.allowed) {
      console.warn(`[recordings/start] feature access denied uid=${uid}`, featureAccess);
      return res.status(403).json({
        success: false,
        error: featureAccess.code || LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
        reason: featureAccess.reason || "Recording requires upgrade",
        _diag: featureAccess._diag,
      });
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

    if (!roomDoc.roomLayout) {
      try {
        const userSnap = await firestore.collection("users").doc(uid).get();
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

    // Plan + features (canonical limits via EffectiveEntitlements)
    const entitlements = await getEffectiveEntitlements(uid);
    const planId = entitlements.planId;
    const plan = entitlements.plan.raw || {};

    // Monthly usage gate: block non-overage plans; allow Pro and log totals.
    try {
      const monthKey = getCurrentMonthKey();
      const usageDocId = `${uid}_${monthKey}`;
      const usageSnap = await firestore.collection("usageMonthly").doc(usageDocId).get();
      const existing = usageSnap.exists ? (usageSnap.data() as any) : {};
      const usage = existing.usage || {};

      const decision = evaluateUsageGate({
        allowsOverages: !!(entitlements.features as any).allowsOverages,
        limits: {
          participantMinutes: Number(entitlements.limits.monthlyMinutes || 0),
          transcodeMinutes: Number(entitlements.limits.transcodeMinutes || 0),
        },
        usage: {
          participantMinutes: Number(usage.participantMinutes || 0),
          transcodeMinutes: Number(usage.transcodeMinutes || 0),
        },
        checkParticipant: true,
        checkTranscode: true,
      });

      if (!decision.allowed) {
        console.warn(`[recordings/start] usage gate blocked uid=${uid} planId=${planId}`, {
          participantUsed: Number(usage.participantMinutes || 0),
          participantLimit: Number(entitlements.limits.monthlyMinutes || 0),
          transcodeUsed: Number(usage.transcodeMinutes || 0),
          transcodeLimit: Number(entitlements.limits.transcodeMinutes || 0),
          allowsOverages: !!(entitlements.features as any).allowsOverages,
          decision,
        });
        return res.status(403).json({
          success: false,
          error: decision.reason || LIMIT_ERRORS.USAGE_EXHAUSTED,
          reason: "Monthly usage limit reached",
          _diag: {
            planId,
            monthKey,
            participantUsed: Number(usage.participantMinutes || 0),
            participantLimit: Number(entitlements.limits.monthlyMinutes || 0),
            transcodeUsed: Number(usage.transcodeMinutes || 0),
            transcodeLimit: Number(entitlements.limits.transcodeMinutes || 0),
            allowsOverages: !!(entitlements.features as any).allowsOverages,
            isOverParticipant: decision.isOverParticipant,
            isOverTranscode: decision.isOverTranscode,
          },
        });
      }

      if (decision.shouldLogOverages && decision.overageTotals) {
        await upsertUsageMonthlyOverageTotals({
          uid,
          monthKey,
          totals: decision.overageTotals,
        });
      }
    } catch (e) {
      // Do not block recording start on bookkeeping failures.
      console.error("[recordings/start] usage gate failed", e);
    }

    const dualAllowed = !!(plan?.features?.dualRecording || plan?.features?.dual_recording);
    const allowHigherRecordingThanStream = !!(
      plan?.features?.allowHigherRecordingThanStream || plan?.features?.allow_higher_recording_than_stream
    );
    const maxRecordingMinutesPerClip = Number(entitlements.limits.maxRecordingMinutesPerClip || 0);

    // Plan gate for dual recording (feature: dualRecording)
    if (mode === "dual" && !dualAllowed) {
      return res.status(403).json({ error: "dual_recording_not_allowed" });
    }

    // If a stream is live, lower recording quality to stream preset when required
    const streamDocIdNew = `${uid}_${roomId}`;
    const streamDocIdLegacy = `${uid}_${roomAccess.roomName || roomId}`;
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

    // Clamp preset to plan and (optionally) active stream preset
    const clamp = clampRecordingPreset(planId, presetId, activeStreamPresetId, allowHigherRecordingThanStream);
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
      const uSnap = await firestore.collection("users").doc(uid).get();
      if (uSnap.exists) {
        const u = (uSnap.data() as any) || {};
        const rawOrgId = u?.orgId ?? u?.org?.id ?? u?.org?.orgId;
        orgId = typeof rawOrgId === "string" && rawOrgId.trim() ? rawOrgId.trim() : null;
      }
    } catch {
      // non-fatal
    }

    const { objectKey, prefix: r2Prefix } = generateRecordingPath(uid, roomId, recordingId, "");
    const recordingRef = firestore.collection("recordings").doc(recordingId);

    const isEmergency = recordingClass === "emergency";
    const emergencyCurrentRef = firestore
      .collection("users")
      .doc(uid)
      .collection("emergencyRecording")
      .doc("current");

    const emergencyExpiresAt = new Date(now.getTime() + EMERGENCY_RETENTION_MS);
    const emergencyExpiresAtMs = emergencyExpiresAt.getTime();

    const autoStopAt =
      maxRecordingMinutesPerClip > 0
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
      userId: uid,
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
      const egressTemplateBase = process.env.EGRESS_TEMPLATE_BASE_URL;
      const customBaseUrl = egressTemplateBase
        ? `${egressTemplateBase.replace(/\/+$/, "")}/egress-templates/program-compositor.html`
        : undefined;

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

router.post("/sweep", async (_req, res) => {
  const now = new Date();
  console.log("[recordings/sweep] Starting sweep at", now.toISOString());

  try {
    const snap = await firestore
      .collection("recordings")
      .where("status", "==", "recording")
      .where("autoStopAt", "<=", now)
      .limit(50)
      .get();

    if (snap.empty) {
      console.log("[recordings/sweep] No overdue recordings found");
      return res.json({ ok: true, processed: 0 });
    }

    const docs = snap.docs;
    console.log(`[recordings/sweep] Found ${docs.length} overdue recordings`);

    for (const doc of docs) {
      const recordingId = doc.id;
      try {
        await stopRecordingInternal({ recordingId, reason: "auto_cap" });
      } catch (err: any) {
        console.error("[recordings/sweep] Failed to stop recording", {
          recordingId,
          error: err?.message || String(err),
        });
      }
    }

    return res.json({ ok: true, processed: docs.length });
  } catch (err: any) {
    console.error("[recordings/sweep] Error during sweep", err);
    return res.status(500).json({ error: "sweep_failed", details: err?.message || String(err) });
  }
});

// =============================================================================
// POST /stop - Stop Recording
// =============================================================================

router.post(
  "/stop",
  requireAuth,
  requireMyContentRecordingsEnabled as any,
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
    const billedMinutes = durationMs > 0 ? Math.max(1, Math.ceil(durationMs / 60000)) : 0;

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
    // Update recording doc and usage in a single transaction (idempotent)
    // =========================================================================
    let usageCountedAlready = false;

    const usageType = typeof data.usageType === "string" ? data.usageType : "recording_only";

    await firestore.runTransaction(async (tx) => {
      const recSnap = await tx.get(recordingRef);
      if (!recSnap.exists) throw new Error("recording_missing");
      const recData = recSnap.data() || {};

      const monthKey = getCurrentMonthKey();
      const usageRef = firestore.collection("usageMonthly").doc(`${uid}_${monthKey}`);
      const usageSnap = await tx.get(usageRef);
      const existingUsage = usageSnap.exists ? (usageSnap.data() as any) : {};
      const usage = existingUsage.usage || {};
      const ytd = existingUsage.ytd || {};
      const minutes = usage.minutes || {};
      const ytdMinutes = ytd.minutes || {};

      const liveCurrent = toNumber(minutes.live?.currentPeriod);
      const liveLifetime = toNumber(minutes.live?.lifetime ?? ytdMinutes.live?.lifetime);
      const recCurrentPrev = toNumber(minutes.recording?.currentPeriod);
      const recLifetimePrev = toNumber(minutes.recording?.lifetime ?? ytdMinutes.recording?.lifetime);
      const totalCurrentPrev = toNumber(minutes.total?.currentPeriod);
      const totalLifetimePrev = toNumber(minutes.total?.lifetime ?? ytdMinutes.total?.lifetime);

      const byUsageTypePrev = minutes.byUsageType || {};
      const byUsageTypeYtd = ytdMinutes.byUsageType || {};
      const typePrev = byUsageTypePrev[usageType] || {};
      const typeLifetimePrev = toNumber(typePrev.lifetime ?? byUsageTypeYtd[usageType]?.lifetime);

      if (recData.usageCounted === true) {
        usageCountedAlready = true;
        tx.update(recordingRef, {
          status: "processing",
          stoppedAt: recData.stoppedAt || now,
          endedAt: recData.endedAt || now,
          duration: recData.duration ?? durationSeconds,
          durationSeconds: recData.durationSeconds ?? durationSeconds,
          durationMs: recData.durationMs ?? durationMs,
          billedMinutes: recData.billedMinutes ?? billedMinutes,
          updatedAt: now,
          downloadReady: false,
          downloadPath: recData.objectKey || recData.downloadPath || null,
        });
        return;
      }

      const billed = billedMinutes;

      const nextMinutes = {
        ...minutes,
        live: {
          currentPeriod: liveCurrent,
          lifetime: liveLifetime,
        },
        recording: {
          currentPeriod: recCurrentPrev + billed,
          lifetime: recLifetimePrev + billed,
        },
        total: {
          currentPeriod: totalCurrentPrev + billed,
          lifetime: totalLifetimePrev + billed,
        },
        byUsageType: {
          ...byUsageTypePrev,
          [usageType]: {
            currentPeriod: toNumber(typePrev.currentPeriod) + billed,
            lifetime: typeLifetimePrev + billed,
          },
        },
      };

      const nextYtdMinutes = {
        ...ytdMinutes,
        live: { lifetime: liveLifetime },
        recording: { lifetime: recLifetimePrev + billed },
        total: { lifetime: totalLifetimePrev + billed },
        byUsageType: {
          ...byUsageTypeYtd,
          [usageType]: { lifetime: typeLifetimePrev + billed },
        },
      };

      tx.update(recordingRef, {
        status: "processing",
        stoppedAt: now,
        endedAt: now,
        duration: durationSeconds,
        durationSeconds,
        durationMs,
        billedMinutes: billed,
        usageCounted: true,
        usageCountedAt: now,
        updatedAt: now,
        downloadReady: false,
        downloadPath: data.objectKey || null,
      });

      tx.set(
        usageRef,
        {
          uid,
          monthKey,
          usage: {
            ...usage,
            minutes: nextMinutes,
          },
          ytd: {
            ...ytd,
            minutes: nextYtdMinutes,
          },
          createdAt: existingUsage.createdAt || now,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    console.log(`[recordings/stop] Recording ${recordingId} now processing`);

    // Release active recording lock for this (user, room)
    try {
      const roomId = typeof (data as any).roomId === "string" ? (data as any).roomId : null;
      const roomName = typeof data.roomName === "string" ? data.roomName : null;
      const roomKey = roomId || roomName;
      if (roomKey) {
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
      console.warn("[recordings/stop] failed to update activeRecordings lock", lockErr?.message);
    }

    // Best-effort post-stop verification in case webhooks are delayed or dropped
    const objectKey = data.objectKey as string | undefined;
    if (objectKey) {
      setTimeout(async () => {
        try {
          const size = await r2HeadObjectSize(objectKey);
          if (size > 0) {
            // Re-read the doc to check storageCounted flag (webhook may have arrived first)
            const freshSnap = await recordingRef.get();
            const freshData = freshSnap.exists ? (freshSnap.data() || {}) : {} as any;
            const alreadyCounted = freshData.storageCounted === true;

            await recordingRef.update({
              status: "ready",
              downloadReady: true,
              readyAt: new Date(),
              fileSize: size,
              updatedAt: new Date(),
              // Mark storage as counted to prevent double-counting by webhook
              ...(!alreadyCounted ? { storageCounted: true } : {}),
            });
            console.log(`[recordings/stop] ✅ File confirmed via head-check: ${objectKey} (${size} bytes)`);

            // Count storage for this recording (only if not already counted by webhook)
            if (!alreadyCounted && uid) {
              try {
                await reserveStorageUsage(uid, size, {
                  caller: "recordings.stop.headcheck",
                  recordingId,
                  objectKey,
                });
              } catch (e: any) {
                console.error("[recordings/stop] storage accounting failed:", {
                  userId: uid, recordingId, size, error: e?.message || e,
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
                userId: uid,
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
    const recordingId = req.params.id;

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

router.get("/:id", requireAuth, requireMyContentRecordingsEnabled as any, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = req.params.id;

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

router.delete("/:id", requireAuth, requireMyContentRecordingsEnabled as any, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = req.params.id;

    const snap = await firestore.collection("recordings").doc(recordingId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = snap.data() || {};
    if (data.userId && data.userId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // Capture file size before deletion for storage accounting
    const fileSize = typeof data.fileSize === "number" ? data.fileSize : 0;
    const storageReleased = data.storageReleased === true;

    const storage = await deleteRecordingStorage(data);

    // Release storage quota after R2 bytes are removed (guard against double-release)
    if (fileSize > 0 && !storageReleased) {
      try {
        await releaseStorageUsage(uid, fileSize, {
          caller: "recordings.DELETE",
          recordingId,
        });
      } catch (e: any) {
        console.error("[recordings] storage release failed:", {
          userId: uid, recordingId, fileSize, error: e?.message || e,
        });
      }
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

router.get("/:id/download-link", requireAuth, requireMyContentRecordingsEnabled as any, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = req.params.id;

    const snap = await firestore.collection("recordings").doc(recordingId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const data = snap.data() || {};
    
    // Verify ownership
    if (data.userId && data.userId !== uid) {
      return res.status(403).json({ error: PERMISSION_ERRORS.INSUFFICIENT_PERMISSIONS });
    }

    // STRICT CHECK: Only allow download if status is exactly "ready"
    // This ensures webhook has verified file exists in R2
    const status = String(data.status || "").toLowerCase();
    const downloadReady = data.downloadReady === true && status === "ready";

    if (!downloadReady) {
      return res.json({
        success: false,
        downloadReady: false,
        status: status,
        message: status === "failed" 
          ? `Recording failed: ${data.errorMessage || "Unknown error"}`
          : "Recording is still processing",
      });
    }

    // Check expiry
    const readyAt = data.readyAt || data.stoppedAt || null;
    if (isExpired(readyAt)) {
      return res.status(410).json({
        success: false,
        expired: true,
        message: "Recording link expired",
      });
    }

    // Paywall hook (MVP: always "none")
    if (data.paywallState === "requires_payment") {
      return res.status(402).json({
        success: false,
        paywall: true,
        message: "Upgrade required to download",
      });
    }

    const objectKey = normalizeStorageKey(data.objectKey || data.downloadPath);
    if (!objectKey) {
      return res.status(500).json({
        success: false,
        error: "Missing recording file reference",
      });
    }

    // Generate signed URL with 15-minute TTL per spec
    const DOWNLOAD_TTL_SECONDS = 15 * 60; // 15 minutes
    let signedUrl: string;
    try {
      signedUrl = await getSignedDownloadUrl(objectKey, DOWNLOAD_TTL_SECONDS);
    } catch (e: any) {
      console.error("[recordings/download-link] Signed URL error:", e);
      return res.status(500).json({
        success: false,
        error: "Download link unavailable. Try Emergency Download.",
      });
    }

    // Track download request
    const confirm = req.query.confirm === "true" || req.query.confirm === "1";
    const updates: any = { lastDownloadRequestedAt: Timestamp.now() };
    if (confirm) updates.downloadConfirmedAt = Timestamp.now();

    await firestore.collection("recordings").doc(recordingId).set(updates, { merge: true });

    return res.json({
      success: true,
      data: { 
        url: signedUrl, 
        downloadReady: true,
        expiresIn: DOWNLOAD_TTL_SECONDS,
      },
    });

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
    const recordingId = req.params.id;

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

router.get("/:id/download", requireAuth, requireMyContentRecordingsEnabled as any, async (req, res) => {
  try {
    const uid = getAuthUserId(req);
    const recordingId = req.params.id;

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
