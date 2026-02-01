import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { requireRoomAccessToken, type RoomAccessClaims, getRoomAccess } from "../middleware/roomAccessToken";
import { canAccessFeature } from "./featureAccess";
import type { ApiErrorCode } from "../types/streaming";
import { decryptStreamKey, normalizeRtmpBase } from "../lib/crypto";
import { clampPresetForPlan, getUserPlanId, toEncodingOptions } from "../lib/mediaPresets";
import { assertRoomPerm, RoomPermissionError } from "../lib/rolePermissions";
import { PERMISSION_ERRORS } from "../lib/permissionErrors";
import { assertPlatformTranscodeEnabled } from "../lib/platformFlags";
import { LIMIT_ERRORS } from "../lib/limitErrors";
import { getCurrentMonthKey } from "../lib/usageTracker";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import { evaluateUsageGate } from "../lib/usageOverages";
import { upsertUsageMonthlyOverageTotals } from "../lib/usageOveragesWriter";

// livekit-server-sdk is ESM; use dynamic import so CommonJS builds work on Render
let _lkMod: any | null = null;
async function getLiveKitSdk() {
  if (_lkMod) return _lkMod;
  _lkMod = await import("livekit-server-sdk");
  return _lkMod;
}

function toNumber(value: any): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function coerceDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    try {
      const d = value.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function computeBilledMinutes(start: Date | null, end: Date): number {
  if (!start) return 0;
  const durationMs = Math.max(0, end.getTime() - start.getTime());
  if (!durationMs) return 0;
  return Math.max(1, Math.ceil(durationMs / 60_000));
}

async function getPlanLimit(uid: string, field: string): Promise<number | undefined> {
  const userSnap = await firestore.collection("users").doc(uid).get();
  const planId = String((userSnap.data() || {}).planId || "free");
  const planSnap = await firestore.collection("plans").doc(planId).get();
  if (!planSnap.exists) return undefined;
  const limits = (planSnap.data() || {}).limits || {};
  const raw = limits[field];
  if (raw === undefined || raw === null) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

const router = Router();

router.post("/:roomId/start-multistream", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const requestStartedAt = Date.now();
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    // Platform-wide kill switch: multistream relies on the transcode/egress pipeline.
    if (!assertPlatformTranscodeEnabled(res)) {
      return;
    }

    const { roomId: canonicalRoomId, livekitRoomName } = getRoomAccess(req as any);
    if (!canonicalRoomId) return res.status(400).json({ error: "Missing roomId" });

    const requestedRoomId = String((req.params as any).roomId || "").trim();
    if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
      return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    const roomId = canonicalRoomId;
    const roomName = livekitRoomName;

    try {
      await assertRoomPerm(req as any, roomId, "canDestinations");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code as ApiErrorCode });
      }
      throw err;
    }

    const streamDocId = `${uid}_${roomId}`; // canonical
    const ref = firestore.collection("activeStreams").doc(streamDocId);

    // if your client sends individual keys or destination IDs:
    const rawBody = req.body || {};
    const trimKey = (k: any) => (typeof k === "string" ? k.trim() : "");
    const youtubeStreamKey = trimKey(rawBody.youtubeStreamKey) || undefined;
    const facebookStreamKey = trimKey(rawBody.facebookStreamKey) || undefined;
    const twitchStreamKey = trimKey(rawBody.twitchStreamKey) || undefined;
    const { guestCount, destinationIds, enabledTargetIds, sessionKeys, presetId, extraDestinations } = rawBody;
    console.log("[multistream:start] uid:", uid, "room:", roomId, {
      youtubeStreamKey: !!youtubeStreamKey,
      facebookStreamKey: !!facebookStreamKey,
      twitchStreamKey: !!twitchStreamKey,
      guestCount,
      destinationIdsCount: Array.isArray(destinationIds) ? destinationIds.length : 0,
      enabledTargetIdsCount: Array.isArray(enabledTargetIds) ? enabledTargetIds.length : 0,
    });

    const destIds: string[] = Array.isArray(enabledTargetIds)
      ? enabledTargetIds.map((id: any) => String(id)).filter(Boolean)
      : Array.isArray(destinationIds)
      ? destinationIds.map((id: any) => String(id)).filter(Boolean)
      : [];
    const sessionKeyMap: Record<string, { rtmpUrlBase?: string; streamKey?: string }> =
      sessionKeys && typeof sessionKeys === "object" ? (sessionKeys as any) : {};

    const extraArray: Array<{ type?: string; protocol?: string; rtmpUrl?: string; streamKey?: string; label?: string }> =
      Array.isArray(extraDestinations) ? extraDestinations : [];

    const hasExtraInstagram = extraArray.some((d) => {
      if (!d) return false;
      const type = String(d.type || "").toLowerCase();
      const protocol = String(d.protocol || "rtmp").toLowerCase();
      const base = normalizeRtmpBase(String(d.rtmpUrl || ""));
      const key = trimKey(d.streamKey);
      return type === "instagram" && protocol === "rtmp" && !!base && !!key;
    });

    if (!youtubeStreamKey && !facebookStreamKey && !twitchStreamKey && destIds.length === 0 && !hasExtraInstagram) {
      return res.status(400).json({ error: "At least one stream key is required" });
    }

    

    // Load user (optional, but fine)
    const userSnap = await firestore.collection("users").doc(uid).get();
    if (!userSnap.exists) return res.status(401).json({ error: "User not found" });
    const planId = await getUserPlanId(uid);

    const featureAccess = await canAccessFeature((req as any).account || uid, "multistream");
    if (!featureAccess.allowed) {
      return res.status(403).json({
        error: (featureAccess.code as any) || LIMIT_ERRORS.FEATURE_NOT_ENTITLED,
        reason: featureAccess.reason || undefined,
      });
    }

    // Monthly usage gate: block non-overage plans; allow Pro and log totals.
    try {
      const entitlements = await getEffectiveEntitlements(uid);
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
        return res.status(403).json({ error: decision.reason || LIMIT_ERRORS.USAGE_EXHAUSTED });
      }

      if (decision.shouldLogOverages && decision.overageTotals) {
        await upsertUsageMonthlyOverageTotals({
          uid,
          monthKey,
          totals: decision.overageTotals,
        });
      }
    } catch (e) {
      // Do not block multistream start on bookkeeping failures.
      console.error("[multistream:start] usage gate failed", e);
    }

    // Clamp preset by plan
    const { preset, effectiveId, requestedId, clamped } = clampPresetForPlan(planId, presetId);
    const encodingOptions = toEncodingOptions(preset, "stream");

    // Destination cap enforcement (plan-based)
    const maxDestinations = await getPlanLimit(uid, "maxDestinations");
    if (maxDestinations !== undefined && maxDestinations > 0 && destIds.length > maxDestinations) {
      // Canonicalize: use a local constant for now, or add to LIMIT_ERRORS if desired
      const DESTINATION_LIMIT_EXCEEDED = "destination_limit_exceeded";
      return res.status(403).json({ error: DESTINATION_LIMIT_EXCEEDED, limit: maxDestinations });
    }

    // Save intent / status (optional but useful)
    await ref.set(
      {
        uid,
        roomId,
        roomName,
        youtubeStreamKey: youtubeStreamKey || null,
        facebookStreamKey: facebookStreamKey || null,
        twitchStreamKey: twitchStreamKey || null,
        destinationIds: destIds,
        guestCount: Number(guestCount || 0),
        status: "starting",
        updatedAt: Date.now(),
        presetRequestedId: requestedId,
        presetEffectiveId: effectiveId,
        usageType: "live",
      },
      { merge: true }
    );

    // Build RTMP URLs for each platform and any stored destinations
    const urls: string[] = [];
    const logEntries: Array<{ platform: string; url: string; keyLen: number; last4: string; source: string }> = [];
    const maskUrl = (url: string) => {
      const idx = url.lastIndexOf("/");
      if (idx === -1) return "***";
      return `${url.slice(0, idx + 1)}***`;
    };
    const pushLog = (platform: string, url: string, key: string, source: string) => {
      urls.push(url);
      logEntries.push({ platform, url: maskUrl(url), keyLen: key.length, last4: key.slice(-4), source });
    };

    if (youtubeStreamKey) {
      const url = `rtmp://a.rtmp.youtube.com/live2/${youtubeStreamKey}`;
      pushLog("youtube", url, youtubeStreamKey, "direct");
    }
    if (facebookStreamKey) {
      const url = `rtmps://live-api-s.facebook.com:443/rtmp/${facebookStreamKey}`;
      pushLog("facebook", url, facebookStreamKey, "direct");
    }
    if (twitchStreamKey) {
      const url = `rtmp://live.twitch.tv/app/${twitchStreamKey}`;
      pushLog("twitch", url, twitchStreamKey, "direct");
    }

    const usedSessionKeys = new Set<string>();

    if (destIds.length > 0) {
      try {
        const col = firestore.collection("users").doc(uid).collection("destinations");
        const snaps = await Promise.all(destIds.map((id) => col.doc(id).get()));
        for (const snap of snaps) {
          if (!snap.exists) continue;
          const data = snap.data() as any;
          if (!data) continue;

          if (data.mode === "connected") {
            return res.status(400).json({ error: "connected_target_not_supported_yet" });
          }

          const targetId = data.targetId || snap.id;
          const sessionKey = sessionKeyMap[targetId];
          const baseRaw = String(sessionKey?.rtmpUrlBase || data.rtmpUrlBase || "");
          const base = normalizeRtmpBase(baseRaw);
          if (!base) continue;

          let dec: string | null = null;
          if (sessionKey?.streamKey) {
            dec = trimKey(sessionKey.streamKey);
          } else if (data.persistent !== false) {
            const maybeDec = data.streamKeyEnc ? decryptStreamKey(data.streamKeyEnc) : null;
            dec = maybeDec ? trimKey(maybeDec) : null;
          }

          if (!dec) continue;
          const url = `${base}/${dec}`;
          const source = sessionKey?.streamKey ? "session" : "main";
          pushLog(String(data.platform || "destination"), url, dec, source);
          if (sessionKey?.streamKey) usedSessionKeys.add(targetId);
        }
      } catch (e) {
        console.error("[multistream:start] failed to resolve destinationIds", e);
      }
    }

    // Handle standalone session keys (e.g., custom RTMP) that aren't tied to saved destinations
    for (const [keyId, entry] of Object.entries(sessionKeyMap || {})) {
      if (usedSessionKeys.has(keyId)) continue;
      let base = normalizeRtmpBase(String(entry?.rtmpUrlBase || ""));
      let dec = entry?.streamKey ? trimKey(entry.streamKey) : "";

      // If base missing but streamKey looks like a full RTMP URL, split it
      if (!base && dec.startsWith("rtmp")) {
        const idx = dec.lastIndexOf("/");
        if (idx > 8) {
          const maybeBase = normalizeRtmpBase(dec.slice(0, idx));
          const maybeKey = trimKey(dec.slice(idx + 1));
          if (maybeBase && maybeKey) {
            base = maybeBase;
            dec = maybeKey;
          }
        }
      }

      if (!base || !dec) continue;
      const url = `${base}/${dec}`;
      pushLog("custom", url, dec, "session");
    }

    // Handle extra session-only destinations such as Instagram Live Producer
    for (const dest of extraArray) {
      if (!dest) continue;
      const type = String(dest.type || "").toLowerCase();
      if (type !== "instagram") continue;
      const protocol = String(dest.protocol || "rtmp").toLowerCase();
      if (protocol !== "rtmp") continue;
      const baseRaw = String(dest.rtmpUrl || "");
      const base = normalizeRtmpBase(baseRaw);
      const key = trimKey(dest.streamKey);
      if (!base || !key) continue;
      const url = `${base}/${key}`;
      pushLog("instagram", url, key, "session");
    }

    if (urls.length === 0) {
      return res.status(400).json({ error: "At least one stream key is required" });
    }
    console.log("[multistream:start] RTMP URLs (masked):", logEntries);

    try {
      // Import LiveKit egress client and types using dynamic helper
      const { EgressClient, StreamOutput, StreamProtocol } = await getLiveKitSdk();
      const livekitUrl = process.env.LIVEKIT_URL;
      const livekitApiKey = process.env.LIVEKIT_API_KEY;
      const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
      const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);

      // Create RTMP stream output
      const streamOutput = new StreamOutput({ protocol: StreamProtocol.RTMP, urls });

      // Start Room Composite egress with preset encoding
      if (process.env.AUTH_DEBUG === "1") {
        console.log("[livekit-debug] startRoomCompositeEgress (multistream)", {
          livekitRoomName: roomName,
          urls,
        });
      }

      const response = await egressClient.startRoomCompositeEgress(
        roomName,
        { stream: streamOutput },
        { layout: "grid", encodingOptions }
      );
      console.log("[multistream:start] Egress response:", {
        egressId: (response as any)?.egressId,
        room: roomName,
        raw: response,
      });

      if (response.egressId) {
        const startedAt = Date.now();
        const warmupMs = startedAt - requestStartedAt;
        const platforms = logEntries.map((e) => e.platform);

        // Save to Firestore only after success
        await ref.set({
          uid,
          roomId,
          roomName,
          youtubeStreamKey: youtubeStreamKey || null,
          facebookStreamKey: facebookStreamKey || null,
          twitchStreamKey: twitchStreamKey || null,
          guestCount: Number(guestCount || 0),
          status: "started",
          egressId: response.egressId,
          updatedAt: startedAt,
          presetRequestedId: requestedId,
          presetEffectiveId: effectiveId,
          usageType: "live",
          warmupMs,
          warmupPlatforms: platforms,
        }, { merge: true });

        // Persist a durable egress session record so we can attribute usage on
        // egress_ended webhooks even if the activeStreams doc is deleted.
        try {
          await firestore
            .collection("egressSessions")
            .doc(String(response.egressId))
            .set(
              {
                egressId: String(response.egressId),
                uid,
                roomId,
                roomName,
                kind: "multistream",
                destinationCount: urls.length,
                startedAt: new Date(startedAt),
                createdAt: new Date(),
                updatedAt: new Date(),
              },
              { merge: true }
            );
        } catch (e) {
          console.warn("[multistream:start] failed to write egressSessions", (e as any)?.message || e);
        }

        console.log("[multistream:warmup] egress started", {
          uid,
          roomName,
          warmupMs,
          warmupSeconds: Math.round(warmupMs / 1000),
          platforms,
        });

        // Ensure non-empty JSON body
        return res.status(200).json({
          success: true,
          egressId: response.egressId,
          status: "started",
          effectivePresetId: effectiveId,
          requestedPresetId: requestedId,
          presetClamped: clamped,
        });
      } else {
        console.error("[multistream:start] No egressId returned from LiveKit");
        return res.status(500).json({ error: "Failed to start egress - no ID returned" });
      }
    } catch (err) {
      console.error("[multistream:start] error:", err);
      return res.status(500).json({ error: "Failed to start multistream", details: (err as any)?.message || String(err) });
    }
  } catch (err) {
    console.error("[multistream:start] outer error:", err);
    return res.status(500).json({ error: "Failed to start multistream" });
  }
});


router.post("/:roomId/stop-multistream", requireAuth, requireRoomAccessToken as any, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: PERMISSION_ERRORS.UNAUTHORIZED });

    const { roomId: canonicalRoomId, livekitRoomName } = getRoomAccess(req as any);
    if (!canonicalRoomId) return res.status(400).json({ error: "Missing roomId" });

    const requestedRoomId = String((req.params as any).roomId || "").trim();
    if (requestedRoomId && requestedRoomId !== canonicalRoomId) {
      return res.status(400).json({ error: PERMISSION_ERRORS.ROOM_MISMATCH });
    }

    const roomId = canonicalRoomId;
    const roomName = livekitRoomName;

    try {
      await assertRoomPerm(req as any, roomId, "canDestinations");
    } catch (err) {
      if (err instanceof RoomPermissionError) {
        return res.status(err.status).json({ error: err.code as ApiErrorCode });
      }
      throw err;
    }

    const streamDocId = `${uid}_${roomId}`;
    const ref = firestore.collection("activeStreams").doc(streamDocId);
    let doc = await ref.get();
    let egressId = null;
    let foundRef = ref;
    if (doc.exists) {
      const data = doc.data();
      egressId = data?.egressId;
    } else {
      // Legacy fallback: older docs were keyed by uid_roomName
      const legacyStreamDocId = `${uid}_${roomName}`;
      const legacyRef = firestore.collection("activeStreams").doc(legacyStreamDocId);
      const legacyDoc = await legacyRef.get();
      if (legacyDoc.exists) {
        const data = legacyDoc.data();
        egressId = data?.egressId;
        doc = legacyDoc;
        foundRef = legacyRef;
      }

      // Fallback: search for activeStreams doc with matching egressId from request body
      egressId = egressId || req.body.egressId;
      if (!egressId) {
        return res.status(404).json({ error: "No active multistream found for this room and no egressId provided" });
      }
      const querySnap = await firestore
        .collection("activeStreams")
        .where("egressId", "==", egressId)
        .limit(1)
        .get();
      if (querySnap.empty) {
        return res.status(404).json({ error: "No active multistream found for this egressId" });
      }

      const candidate = querySnap.docs[0];
      const data = (candidate.data() || {}) as any;

      const ownerUid = data.uid;
      const ownerRoomId = typeof data.roomId === "string" ? data.roomId.trim() : undefined;
      const ownerRoomName = typeof data.roomName === "string" ? data.roomName.trim() : undefined;

      const roomMatches = ownerRoomId
        ? ownerRoomId === roomId
        : ownerRoomName
          ? ownerRoomName === roomName
          : candidate.id === streamDocId;

      if (ownerUid !== uid || !roomMatches) {
        console.info("[multistream:stop] egressId owner/room mismatch; denying stop", {
          uid,
          roomId,
          activeUid: ownerUid,
          activeRoomName: ownerRoomName || null,
        });
        return res.status(404).json({ error: "No active multistream found for this egressId" });
      }

      doc = candidate;
      foundRef = candidate.ref;
    }
    if (!egressId) {
      return res.status(400).json({ error: "No egressId found for active stream" });
    }

    // Import LiveKit egress client using dynamic helper
    const { EgressClient } = await getLiveKitSdk();
    const livekitUrl = process.env.LIVEKIT_URL;
    const livekitApiKey = process.env.LIVEKIT_API_KEY;
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
    const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);

    const now = new Date();

    // Best-effort: attribute broadcast (transcode/egress) minutes even if
    // LiveKit webhooks are not configured or are delayed.
    const countUsage = async () => {
      try {
        const sessionRef = firestore.collection("egressSessions").doc(String(egressId));
        await firestore.runTransaction(async (tx) => {
          const s = await tx.get(sessionRef);
          if (!s.exists) return;
          const session = s.data() as any;
          if (session?.countedAt) return;

          const startedAt = coerceDate(session?.startedAt);
          const billedMinutes = computeBilledMinutes(startedAt, now);
          if (billedMinutes <= 0) return;

          const monthKey = getCurrentMonthKey();
          const usageRef = firestore.collection("usageMonthly").doc(`${uid}_${monthKey}`);
          const usageSnap = await tx.get(usageRef);
          const existing = usageSnap.exists ? (usageSnap.data() as any) : {};
          const usage = existing.usage || {};
          const ytd = existing.ytd || {};
          const minutes = usage.minutes || {};
          const ytdMinutes = ytd.minutes || {};

          const prevCurrent = toNumber(minutes.transcode?.currentPeriod ?? usage.transcodeMinutes);
          const prevLifetime = toNumber(
            minutes.transcode?.lifetime ?? ytdMinutes.transcode?.lifetime ?? ytd.transcodeMinutes
          );

          const nextCurrent = prevCurrent + billedMinutes;
          const nextLifetime = prevLifetime + billedMinutes;

          tx.set(
            usageRef,
            {
              uid,
              monthKey,
              usage: {
                ...usage,
                transcodeMinutes: toNumber(usage.transcodeMinutes) + billedMinutes,
                minutes: {
                  ...minutes,
                  transcode: {
                    currentPeriod: nextCurrent,
                    lifetime: nextLifetime,
                  },
                },
              },
              ytd: {
                ...ytd,
                transcodeMinutes: toNumber(ytd.transcodeMinutes) + billedMinutes,
                minutes: {
                  ...ytdMinutes,
                  transcode: {
                    lifetime: nextLifetime,
                  },
                },
              },
              createdAt: existing.createdAt || now,
              updatedAt: now,
            },
            { merge: true }
          );

          tx.set(
            sessionRef,
            {
              endedAt: now,
              billedMinutes,
              countedAt: now,
              updatedAt: now,
            },
            { merge: true }
          );
        });
      } catch (e: any) {
        console.warn("[multistream:stop] failed to count usage", e?.message || e);
      }
    };

    try {
      await egressClient.stopEgress(egressId);
      await countUsage();
      await foundRef.delete();
      return res.json({ success: true, status: "stopped" });
    } catch (err: any) {
      const message = err?.message || String(err);
      const code = (err as any)?.code || (err as any)?.status;
      const isNotRunning = code === 412 || /412/.test(message) || /not running/i.test(message);
      if (isNotRunning) {
        console.warn("stopEgress returned precondition/unknown state; treating as already stopped", { egressId, message });
        await countUsage();
        await foundRef.delete();
        return res.json({ success: true, status: "stopped", reason: "not_running" });
      }
      console.error("Error stopping multistream:", err);
      return res.status(500).json({ error: "Failed to stop multistream", details: message });
    }
  } catch (err) {
    console.error("stop-multistream error:", err);
    return res.status(500).json({ error: "Failed to stop multistream" });
  }
});

export default router;
