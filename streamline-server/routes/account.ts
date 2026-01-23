import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import admin from "firebase-admin";
import { requireAuth } from "../middleware/requireAuth";
import { clampPresetForPlan, getPresetById, getUserPlanId, MEDIA_PRESETS, MediaPresetId } from "../lib/mediaPresets";
import { getCurrentMonthKey } from "../lib/usageTracker";
import { resolveMaxDestinations } from "../lib/planLimits";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import crypto from "crypto";
import { CURRENT_TOS_VERSION } from "../lib/tos";
import {
  DEFAULT_ROLE_PROFILES,
  DEFAULT_ROLE_PROFILES_BY_ID,
  type RolePermissionMap,
} from "../lib/permissions/defaultRoleProfiles";
import { getPlatformTranscodeEnabled } from "../lib/platformFlags";

const router = Router();

const DEFAULT_MEDIA_PREFS = {
  defaultLayout: "speaker" as "speaker" | "grid",
  defaultRecordingMode: "cloud" as "cloud" | "dual",
  defaultPresetId: "standard_720p30" as MediaPresetId,
  warnOnHighQuality: true,
  destinationsDefaultMode: "last_used" as "last_used" | "pick_each_time",
  autoClamp: true,
  permissionsMode: "simple" as "simple" | "advanced",
};

const DEFAULT_COHOST_PROFILE = {
  label: "Co-Host",
  canStream: true,
  canRecord: true,
  canDestinations: true,
  canModerate: false,
  canLayout: true,
  canScreenShare: true,
  canInvite: true,
  canAnalytics: false,
  expiresHours: 24,
  maxUses: 1,
};

type RolePresetId = "participant" | "cohost" | "moderator";
type RolePresetDoc = {
  role: RolePresetId;
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canScreenShare: boolean;
  tileVisible: boolean;
  canMuteGuests: boolean;
  canInviteLinks: boolean;
  canManageDestinations: boolean;
  canStartStopStream: boolean;
  canStartStopRecording: boolean;
  // Optional future scopes. Moderator must never have these enabled.
  canViewAnalytics?: boolean;
  canChangeLayoutScene?: boolean;
  updatedAt?: number;
};

const DEFAULT_ROLE_PRESETS: Record<RolePresetId, RolePresetDoc> = {
  participant: {
    role: "participant",
    canPublishAudio: true,
    canPublishVideo: true,
    canScreenShare: false,
    tileVisible: true,
    // Host-only moderation: participants never gain mute/remove powers from templates.
    canMuteGuests: false,
    canInviteLinks: false,
    canManageDestinations: false,
    canStartStopStream: false,
    canStartStopRecording: false,
  },
  moderator: {
    role: "moderator",
    canPublishAudio: true,
    canPublishVideo: true,
    canScreenShare: false,
    tileVisible: true,
    // Legacy moderator profile kept for backwards-compat reads only.
    // Moderation powers are enforced host-only elsewhere.
    canMuteGuests: false,
    canInviteLinks: true,
    canManageDestinations: false,
    canStartStopStream: false,
    canStartStopRecording: false,
    canViewAnalytics: false,
    canChangeLayoutScene: false,
  },
  cohost: {
    role: "cohost",
    canPublishAudio: true,
    canPublishVideo: true,
    canScreenShare: true,
    tileVisible: true,
    // Host-only moderation: co-hosts never gain mute/remove powers from templates.
    canMuteGuests: false,
    canInviteLinks: true,
    canManageDestinations: true,
    canStartStopStream: true,
    canStartStopRecording: true,
  },
};

function parseRolePresetId(raw: any): RolePresetId | null {
  const v = String(raw || "").toLowerCase();
  if (v === "participant" || v === "cohost" || v === "moderator") return v;
  return null;
}

function pickBoolean(v: any): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

async function readRolePreset(uid: string, presetId: RolePresetId): Promise<RolePresetDoc> {
  const base = DEFAULT_ROLE_PRESETS[presetId];
  try {
    const snap = await firestore.collection("users").doc(uid).collection("rolePresets").doc(presetId).get();
    const data = snap.exists ? (snap.data() as any) : {};
    const merged: RolePresetDoc = {
      ...base,
      role: presetId,
      canPublishAudio: pickBoolean(data.canPublishAudio) ?? base.canPublishAudio,
      canPublishVideo: pickBoolean(data.canPublishVideo) ?? base.canPublishVideo,
      canScreenShare: pickBoolean(data.canScreenShare) ?? base.canScreenShare,
      tileVisible: pickBoolean(data.tileVisible) ?? base.tileVisible,
      canMuteGuests: pickBoolean(data.canMuteGuests) ?? base.canMuteGuests,
      canInviteLinks: pickBoolean(data.canInviteLinks) ?? base.canInviteLinks,
      canManageDestinations: pickBoolean(data.canManageDestinations) ?? base.canManageDestinations,
      canStartStopStream: pickBoolean(data.canStartStopStream) ?? base.canStartStopStream,
      canStartStopRecording: pickBoolean(data.canStartStopRecording) ?? base.canStartStopRecording,
      canViewAnalytics: pickBoolean(data.canViewAnalytics) ?? base.canViewAnalytics,
      canChangeLayoutScene: pickBoolean(data.canChangeLayoutScene) ?? base.canChangeLayoutScene,
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
    };

    // Hard guarantees: moderator must never have these enabled.
    if (presetId === "moderator") {
      merged.canViewAnalytics = false;
      merged.canChangeLayoutScene = false;
    }

    return merged;
  } catch {
    return base;
  }
}

type PermissionSet = RolePermissionMap;

type RoleProfile = {
  id: string;
  label: string;
  system: boolean;
  lockedName: boolean;
  permissions: PermissionSet;
  slug?: string;
};

const DEFAULT_ROLE_TEMPLATES: RoleProfile[] = DEFAULT_ROLE_PROFILES.map((profile) => ({
  id: profile.id,
  slug: profile.id,
  label: profile.name,
  system: profile.isSystemDefault,
  lockedName: !!profile.lockedName,
  permissions: profile.permissions,
}));

const DEFAULT_QUICK_ROLE_IDS: string[] = ["participant", "cohost"];

export const SIMPLE_ROLE_DEFAULTS: Record<"participant" | "moderator" | "cohost" | "host", PermissionSet> = {
  participant: {
    ...DEFAULT_ROLE_PROFILES_BY_ID.participant.permissions,
  },
  moderator: {
    ...DEFAULT_ROLE_PROFILES_BY_ID.moderator.permissions,
  },
  cohost: {
    ...DEFAULT_ROLE_PROFILES_BY_ID.cohost.permissions,
  },
  host: {
    ...DEFAULT_ROLE_PROFILES_BY_ID.host.permissions,
  },
};

function normalizeMediaPrefs(raw: any, planId: string) {
  const prefs = { ...DEFAULT_MEDIA_PREFS, ...(raw || {}) };
  const { preset } = clampPresetForPlan(planId, prefs.defaultPresetId);
  return {
    ...prefs,
    defaultPresetId: preset.id,
    autoClamp: true,
    permissionsMode: prefs.permissionsMode === "advanced" ? "advanced" : "simple",
  };
}

async function getNormalizedMediaPrefs(uid: string) {
  const planId = await getUserPlanId(uid);
  const snap = await firestore.collection("users").doc(uid).get();
  const data = snap.exists ? snap.data() || {} : {};
  return { mediaPrefs: normalizeMediaPrefs((data as any).mediaPrefs, planId), planId };
}

// Advanced permissions have been fully removed in favor of a single,
// simple permissions mode. Keep a minimal helper that always reports
// advanced permissions as disabled so existing callers continue to
// receive a stable payload shape.

async function getHlsUiFlag() {
  // Global HLS UI/tab flag, driven from the featureFlags collection.
  // When missing, we default to enabled so HLS UI is visible by default.
  const snap = await firestore.collection("featureFlags").doc("hlsSettingsTab").get();
  const data = snap.exists ? (snap.data() as any) || {} : {};
  const enabled = data.enabled === undefined ? true : !!data.enabled;
  return {
    enabled,
    reason: typeof data.reason === "string" ? data.reason : undefined,
  };
}

// Global recording UI/feature flag.
// When missing, we default to enabled so recording behaves according to the plan.
async function getRecordingUiFlag() {
  const snap = await firestore.collection("featureFlags").doc("recording").get();
  const data = snap.exists ? (snap.data() as any) || {} : {};
  const enabled = data.enabled === undefined ? true : !!data.enabled;
  return {
    enabled,
    reason: typeof data.reason === "string" ? data.reason : undefined,
  };
}

async function getAdvancedPermissionsEnabled(uid: string) {
  const userSnap = await firestore.collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const planId = await getUserPlanId(uid);
  return {
    enabled: false,
    planFlag: false,
    override: false,
    globalLock: false,
    lockReason: "plan" as const,
    globalReason: undefined,
    planId,
    userData,
  };
}

function clampNumber(value: any, min: number, max: number, fallback: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeCohostProfile(raw: any) {
  const merged = { ...DEFAULT_COHOST_PROFILE, ...(raw || {}) };
  return {
    label: typeof merged.label === "string" && merged.label.trim()
      ? merged.label.trim().slice(0, 64)
      : DEFAULT_COHOST_PROFILE.label,
    canStream: !!merged.canStream,
    canRecord: !!merged.canRecord,
    canDestinations: !!merged.canDestinations,
    canModerate: !!merged.canModerate,
    canLayout: !!merged.canLayout,
    canScreenShare: !!merged.canScreenShare,
    canInvite: !!merged.canInvite,
    canAnalytics: !!merged.canAnalytics,
    expiresHours: clampNumber(merged.expiresHours, 1, 168, DEFAULT_COHOST_PROFILE.expiresHours),
    maxUses: clampNumber(merged.maxUses, 1, 20, DEFAULT_COHOST_PROFILE.maxUses),
  };
}

function normalizePermissions(raw: any): PermissionSet {
  const perms: PermissionSet = {
    canStream: !!raw?.canStream,
    canRecord: !!raw?.canRecord,
    canDestinations: !!raw?.canDestinations,
    canModerate: !!raw?.canModerate,
    canLayout: !!raw?.canLayout,
    canScreenShare: !!raw?.canScreenShare,
    canInvite: !!raw?.canInvite,
    canAnalytics: !!raw?.canAnalytics,
    canMuteGuests: !!raw?.canMuteGuests,
    canRemoveGuests: !!raw?.canRemoveGuests,
  };

  return clampNeverPermissions(perms);
}

/**
 * Central hook for hard "never" rules on role permissions.
 *
 * Today this is a no-op beyond boolean normalization, but any
 * permission keys that must never be enabled (regardless of
 * stored data) should be enforced here so that all roleProfiles
 * writes and reads are consistently clamped.
 */
function clampNeverPermissions(perms: PermissionSet): PermissionSet {
  return perms;
}

function normalizeRoleProfiles(rawRoles: any): RoleProfile[] {
  const roles = Array.isArray(rawRoles) ? rawRoles : [];
  const map = new Map<string, RoleProfile>();

  roles.forEach((r: any) => {
    if (!r || !r.id) return;
    const id = String(r.id);
    const system = !!r.system;
    const lockedName = !!r.lockedName;
    const label = lockedName && typeof r.label === "string" && r.label.trim()
      ? r.label.trim()
      : typeof r.label === "string" && r.label.trim()
        ? r.label.trim().slice(0, 64)
        : id;
    map.set(id, {
      id,
      label,
      system,
      lockedName,
      permissions: normalizePermissions(r.permissions || r),
      slug: r.slug,
    });
  });

  DEFAULT_ROLE_TEMPLATES.forEach((tpl) => {
    const existing = map.get(tpl.id);
    if (existing) {
      map.set(tpl.id, {
        ...existing,
        id: tpl.id,
        system: true,
        lockedName: true,
        label: tpl.label,
        slug: tpl.slug,
      });
    } else {
      map.set(tpl.id, tpl);
    }
  });

  return Array.from(map.values());
}

async function loadRolesForUser(uid: string) {
  const snap = await firestore.collection("users").doc(uid).get();
  const data = snap.exists ? snap.data() || {} : {};
  const roleProfiles = normalizeRoleProfiles(data.roleProfiles);
  const quickRoleIdsRaw: string[] = Array.isArray((data as any).quickRoleIds) ? (data as any).quickRoleIds : [];
  const quickRoleIds = quickRoleIdsRaw
    .map((id) => String(id))
    .filter((id) => id !== "moderator" && roleProfiles.find((r) => r.id === id));
  const ensuredQuick = quickRoleIds.length ? quickRoleIds : DEFAULT_QUICK_ROLE_IDS;
  return { roleProfiles, quickRoleIds: ensuredQuick };
}

async function loadEffectiveRoles(uid: string, advancedEnabled: boolean) {
  const { mediaPrefs } = await getNormalizedMediaPrefs(uid);
  const simpleMode = mediaPrefs.permissionsMode === "simple" || !advancedEnabled;
  if (simpleMode) {
    const simpleRoles: RoleProfile[] = [
      {
        ...DEFAULT_ROLE_TEMPLATES.find((r) => r.id === "viewer")!,
      },
      {
        ...DEFAULT_ROLE_TEMPLATES.find((r) => r.id === "participant")!,
        permissions: { ...SIMPLE_ROLE_DEFAULTS.participant },
      },
      {
        ...DEFAULT_ROLE_TEMPLATES.find((r) => r.id === "cohost")!,
        permissions: { ...SIMPLE_ROLE_DEFAULTS.cohost },
      },
    ];
    const quickRoleIds: string[] = ["participant", "cohost"];
    return { roleProfiles: simpleRoles, quickRoleIds, simpleMode };
  }
  const { roleProfiles, quickRoleIds } = await loadRolesForUser(uid);
  const filteredQuick = quickRoleIds.filter((id) => id !== "moderator");
  return { roleProfiles, quickRoleIds: filteredQuick, simpleMode };
}

router.use(requireAuth);

// ---------------------------------------------------------------------------
// Minimal account init endpoint for new-style accounts collection.
// This is intentionally simple: it only creates accounts/{uid} once with
// conservative streaming defaults and ToS metadata. Older flows that rely on
// users/{uid} remain unchanged.
// ---------------------------------------------------------------------------

// NOTE: Client baseline lives in streamline-client/src/lib/streamDefaults.ts
// under DEFAULT_STREAM_DEFAULTS. If you change one, update the other to match.
const BASE_STREAM_DEFAULTS = Object.freeze({
  video: { resolution: "720p", fps: 30, bitrateKbps: 2500 },
  audio: { sampleRate: 48000, channels: 2 },
  platform: { youtubePrivacy: "public" as const },
  features: {
    recordingDefault: false,
    hlsDefault: false,
    transcodeDefault: false,
  },
} as const);

router.post("/init", async (req, res) => {
  try {
    const user = (req as any).user || {};
    const uid: string | undefined = user.uid;

    if (!uid) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const accountsRef = firestore.collection("accounts").doc(uid);
    const existing = await accountsRef.get();

    if (existing.exists) {
      return res.json({ ok: true, alreadyInitialized: true });
    }

    const accountDoc: any = {
      uid,
      plan: "free",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
      streamDefaults: BASE_STREAM_DEFAULTS,
    };

    // Optionally mirror basic identity + ToS fields from the primary
    // users/{uid} document when available. If the user doc is missing,
    // we still create the minimal accounts/{uid} shell.
    try {
      const userSnap = await firestore.collection("users").doc(uid).get();
      const userData = userSnap.exists ? (userSnap.data() as any) || {} : {};

      if (typeof userData.email === "string" && userData.email) {
        accountDoc.email = userData.email;
      }
      if (typeof userData.displayName === "string" && userData.displayName) {
        accountDoc.displayName = userData.displayName;
      }

      if (typeof userData.tosVersion === "string") {
        accountDoc.tosVersion = userData.tosVersion;
      }
      if (typeof userData.tosAcceptedAt === "number") {
        accountDoc.tosAcceptedAt = userData.tosAcceptedAt;
      }
    } catch (mirrorErr) {
      console.warn("[account/init] failed to mirror user fields", mirrorErr);
    }

    await accountsRef.set(accountDoc, { merge: false });

    return res.json({ ok: true, initialized: true });
  } catch (err: any) {
    console.error("POST /api/account/init failed", err?.message || err);
    return res.status(500).json({ error: "account_init_failed" });
  }
});

router.get("/me", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const snap = await firestore.collection("users").doc(uid).get();
    if (!snap.exists) return res.status(404).json({ error: "user_not_found" });

    const data = snap.data() || {};
    const { mediaPrefs } = await getNormalizedMediaPrefs(uid);
    const adv = await getAdvancedPermissionsEnabled(uid);
    const entitlements = await getEffectiveEntitlements(uid);
    const hlsUi = await getHlsUiFlag();

    const monthKey = getCurrentMonthKey();
    const usageDocId = `${uid}_${monthKey}`;
    const usageSnap = await firestore.collection("usageMonthly").doc(usageDocId).get();
    const usageRaw = usageSnap.exists ? (usageSnap.data() as any) : {};
    const usage = usageRaw.usage || {};
    const ytd = usageRaw.ytd || {};
    const usageMinutes = usage.minutes || {};
    const ytdMinutes = ytd.minutes || {};

    const toNumber = (value: any) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    };

    const hlsCurrent = toNumber(usage.hlsMinutes);
    const hlsLifetime = toNumber(ytd.hlsMinutes);

    const liveCurrentBase = toNumber(usageMinutes.live?.currentPeriod ?? usage.participantMinutes);
    const liveLifetimeBase = toNumber(
      usageMinutes.live?.lifetime ?? ytdMinutes.live?.lifetime ?? ytd.participantMinutes
    );

    const liveCurrent = liveCurrentBase + hlsCurrent;
    const liveLifetime = liveLifetimeBase + hlsLifetime;
    const recordingCurrent = toNumber(usageMinutes.recording?.currentPeriod);
    const recordingLifetime = toNumber(
      usageMinutes.recording?.lifetime ?? ytdMinutes.recording?.lifetime
    );

    const effectivePermissionsMode = "simple" as const;
    const permissionsModeLockReason = "plan" as const;

    // Canonical effective entitlements payload (features + limits) for client gating
    let effectiveEntitlements: any = null;
    // Global feature/UI flags that can further constrain plan-based entitlements.
    const recordingUi = await getRecordingUiFlag();

    try {
      const plan = entitlements.plan;
      const limits = entitlements.limits;
      const features = entitlements.features;

      const rawFeatures = (plan.raw?.features || {}) as any;

      // Honor all known multistream flags so internal/admin plans that only set
      // rtmpMultistream or multistreamEnabled still unlock social streaming.
      const rtmpMultistreamEnabled = Boolean(
        rawFeatures.rtmpMultistream ??
          rawFeatures.multistream ??
          (plan.raw as any)?.multistreamEnabled ??
          features.multistream
      );

      const canHls = Boolean(
        (features as any).hls ??
          (features as any).hlsEnabled ??
          (features as any).canHls ??
          rawFeatures.canHls ??
          rawFeatures.hls ??
          rawFeatures.hlsBroadcast
      );

      const hlsCustomizationEnabled = (() => {
        const explicit = (features as any).hlsCustomizationEnabled;
        if (typeof explicit === "boolean") return explicit;
        const legacy = rawFeatures.canCustomizeHlsPage;
        if (typeof legacy === "boolean") return legacy;
        return canHls;
      })();

      // Canonical RTMP destinations cap: derive once from the
      // normalized plan limits and expose both the canonical
      // rtmpDestinationsMax and a maxDestinations alias so
      // older callers can continue to function.
      const rtmpDestinationsMax = resolveMaxDestinations(limits);

      effectiveEntitlements = {
        planId: entitlements.planId,
        planName: plan.name || entitlements.planId,
        features: {
          // Recording is available only when the plan includes it AND the
          // global recording feature flag is enabled.
          recording: !!features.recording && recordingUi.enabled,
          rtmpMultistream: rtmpMultistreamEnabled,
          dualRecording: !!(rawFeatures.dualRecording ?? rawFeatures.dual_recording),
          watermark: !!(rawFeatures.watermarkRecordings ?? rawFeatures.watermark),
          canHls,
          // Canonical + compatibility fields for HLS
          hls: canHls,
          hlsEnabled: canHls,
          hlsCustomizationEnabled,
          canCustomizeHlsPage: hlsCustomizationEnabled,
        },
        limits: {
          // Canonical numeric usage/feature caps
          rtmpDestinationsMax,
          // Backwards-compatible alias for older clients
          maxDestinations: rtmpDestinationsMax,
          maxGuests: Number(limits.maxGuests || 0),
          participantMinutes: Number(limits.monthlyMinutes || limits.monthlyMinutesIncluded || 0),
          transcodeMinutes: Number(limits.transcodeMinutes || 0),
          maxRecordingMinutesPerClip: Number(limits.maxRecordingMinutesPerClip || 0),
        },
        caps: entitlements.caps || {},
      };
    } catch (e) {
      console.error("[account/me] failed to compute effectiveEntitlements", e);
    }

    const platformTranscodeEnabled = getPlatformTranscodeEnabled();

    return res.json({
      id: uid,
      email: data.email || null,
      displayName: data.displayName || null,
      permissionsMode: mediaPrefs.permissionsMode,
      advancedPermissions: {
        enabled: false,
        plan: false,
        override: false,
        global: false,
        lockReason: "plan" as const,
        globalReason: undefined,
      },
      advancedPermissionsLockedReason: "plan",
      effectivePermissionsMode,
      permissionsModeLockReason: permissionsModeLockReason || null,
      mediaPrefs,
      connectedPlatforms: {
        youtube: !!data.youtubeConnected,
        facebook: !!data.facebookConnected,
        twitch: !!data.twitchConnected,
      },
      tosVersion: typeof (data as any).tosVersion === "string" ? (data as any).tosVersion : null,
      tosAcceptedAt: typeof (data as any).tosAcceptedAt === "number" ? (data as any).tosAcceptedAt : null,
      currentTosVersion: CURRENT_TOS_VERSION,
      platformFlags: {
        hlsEnabled: hlsUi.enabled,
        hlsSettingsTab: hlsUi.enabled,
        transcodeEnabled: platformTranscodeEnabled,
        recordingEnabled: recordingUi.enabled,
      },
      planId: effectiveEntitlements?.planId ?? entitlements.planId,
      effectiveEntitlements,
      usage: {
        minutes: {
          live: {
            currentPeriod: liveCurrent,
            lifetime: liveLifetime,
          },
          recording: {
            currentPeriod: recordingCurrent,
            lifetime: recordingLifetime,
          },
          hls: {
            currentPeriod: hlsCurrent,
            lifetime: hlsLifetime,
          },
        },
      },
    });
  } catch (err: any) {
    console.error("[account/me] error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/presets", (_req, res) => {
  return res.json({ presets: MEDIA_PRESETS });
});

router.patch("/media-prefs", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const planId = await getUserPlanId(uid);
    const body = req.body || {};
    const updates: any = {};

    if (body.defaultLayout === "speaker" || body.defaultLayout === "grid") {
      updates.defaultLayout = body.defaultLayout;
    }
    if (body.defaultRecordingMode === "cloud" || body.defaultRecordingMode === "dual") {
      updates.defaultRecordingMode = body.defaultRecordingMode;
    }
    if (typeof body.warnOnHighQuality === "boolean") {
      updates.warnOnHighQuality = body.warnOnHighQuality;
    }
    if (body.destinationsDefaultMode === "last_used" || body.destinationsDefaultMode === "pick_each_time") {
      updates.destinationsDefaultMode = body.destinationsDefaultMode;
    }
    if (body.defaultPresetId) {
      const preset = getPresetById(String(body.defaultPresetId));
      const { preset: effective, clamped } = clampPresetForPlan(planId, preset.id);
      updates.defaultPresetId = clamped ? effective.id : preset.id;
    }
    if (body.permissionsMode === "simple" || body.permissionsMode === "advanced") {
      updates.permissionsMode = body.permissionsMode;
    }

    const snap = await firestore.collection("users").doc(uid).get();
    const existingPrefs = snap.exists ? (snap.data() as any)?.mediaPrefs : undefined;
    const normalizedExisting = normalizeMediaPrefs(existingPrefs, planId);
    const mergedCandidate = normalizeMediaPrefs({ ...normalizedExisting, ...updates }, planId);
    const adv = await getAdvancedPermissionsEnabled(uid);
    const merged = adv.enabled ? mergedCandidate : { ...mergedCandidate, permissionsMode: "simple" as const };
    if (!adv.enabled && mergedCandidate.permissionsMode === "advanced") {
      console.log("[media-prefs] coerced permissionsMode to simple due to feature flag", { uid, lockReason: adv.lockReason });
    }
    await firestore.collection("users").doc(uid).set({ mediaPrefs: merged }, { merge: true });

    return res.json({ mediaPrefs: merged, lockReason: adv.lockReason || null });
  } catch (err: any) {
    console.error("[account/media-prefs] error", err);
    return res.status(500).json({ error: "failed_to_update_media_prefs" });
  }
});

// Explicit Terms of Service acceptance endpoint for Billing settings.
// Allows users to acknowledge the CURRENT_TOS_VERSION without changing plans.
router.post("/accept-tos", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const userRef = firestore.collection("users").doc(uid);
    const existing = await userRef.get();

    // Do not create "ghost" user documents that only contain TOS fields.
    // If a user doc does not already exist, require a real signup/onboarding
    // flow to create it instead of implicitly creating it here.
    if (!existing.exists) {
      return res.status(404).json({ error: "user_not_found" });
    }

    const now = Date.now();

    await userRef.set(
      {
        tosVersion: CURRENT_TOS_VERSION,
        tosAcceptedAt: now,
        tosAcceptedIp: req.ip || undefined,
        tosUserAgent: req.get("user-agent") || undefined,
      },
      { merge: true }
    );

    return res.json({ success: true, tosVersion: CURRENT_TOS_VERSION, tosAcceptedAt: now });
  } catch (err: any) {
    console.error("[account/accept-tos] error", err);
    return res.status(500).json({ error: "internal_error" });
  }
});

router.get("/cohost-profile", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const { mediaPrefs } = await getNormalizedMediaPrefs(uid);
    const adv = await getAdvancedPermissionsEnabled(uid);
    const simpleMode = mediaPrefs.permissionsMode === "simple" || !adv.enabled;
    const profile = simpleMode
      ? normalizeCohostProfile({ ...SIMPLE_ROLE_DEFAULTS.cohost, label: "Co-Host", isSystem: true })
      : normalizeCohostProfile((await firestore.collection("users").doc(uid).get()).data()?.cohostProfile);

    return res.json({
      profile,
      locked: simpleMode,
      note: simpleMode
        ? adv.globalLock
          ? "Co-host is locked to simple defaults (temporarily disabled globally)."
          : "Co-host is locked to the simple defaults."
        : undefined,
      lockReason: adv.globalLock ? "global_lock" : undefined,
    });
  } catch (err: any) {
    console.error("[account/cohost-profile] error", err);
    return res.status(500).json({ error: "failed_to_load_cohost_profile" });
  }
});

// Role presets used for in-room controls (applied to rooms/{roomId}/controls/{identity}).
router.get("/role-presets", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    // Role defaults are now locked to two templates: participant and cohost.
    // Any legacy moderator data is ignored for new writes and UI, but can
    // still be read/migrated server-side if needed.
    const [participant, cohost] = await Promise.all([
      readRolePreset(uid, "participant"),
      readRolePreset(uid, "cohost"),
    ]);

    return res.json({
      presets: {
        participant,
        cohost,
      },
      defaults: {
        participant: DEFAULT_ROLE_PRESETS.participant,
        cohost: DEFAULT_ROLE_PRESETS.cohost,
      },
    });
  } catch (err: any) {
    console.error("[account/role-presets] error", err);
    return res.status(500).json({ error: "failed_to_load_role_presets" });
  }
});

router.patch("/role-presets/:presetId", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const presetId = parseRolePresetId(req.params.presetId);
    if (!presetId) return res.status(400).json({ error: "invalid_presetId" });

    // Moderator templates are legacy-only and no longer user-editable.
    if (presetId === "moderator") {
      return res.status(400).json({ error: "preset_disabled" });
    }

    const body = (req.body || {}) as any;
    const patch: Partial<RolePresetDoc> = {
      canPublishAudio: pickBoolean(body.canPublishAudio),
      canPublishVideo: pickBoolean(body.canPublishVideo),
      canScreenShare: pickBoolean(body.canScreenShare),
      tileVisible: pickBoolean(body.tileVisible),
      canMuteGuests: pickBoolean(body.canMuteGuests),
      canInviteLinks: pickBoolean(body.canInviteLinks),
      canManageDestinations: pickBoolean(body.canManageDestinations),
      canStartStopStream: pickBoolean(body.canStartStopStream),
      canStartStopRecording: pickBoolean(body.canStartStopRecording),
      canViewAnalytics: pickBoolean(body.canViewAnalytics),
      canChangeLayoutScene: pickBoolean(body.canChangeLayoutScene),
    };

    const cleaned: any = {};
    (Object.keys(patch) as Array<keyof RolePresetDoc>).forEach((k) => {
      const val = (patch as any)[k];
      if (typeof val === "boolean") cleaned[k] = val;
    });

    if (Object.keys(cleaned).length === 0) {
      return res.status(400).json({ error: "no_valid_fields" });
    }

    // Host-only moderation: templates never grant guest mute/remove powers.
    if ("canMuteGuests" in cleaned) delete cleaned.canMuteGuests;

    await firestore
      .collection("users")
      .doc(uid)
      .collection("rolePresets")
      .doc(presetId)
      .set({ ...cleaned, role: presetId, updatedAt: Date.now() }, { merge: true });

    const preset = await readRolePreset(uid, presetId);
    return res.json({ ok: true, preset });
  } catch (err: any) {
    console.error("[account/role-presets patch] error", err);
    return res.status(500).json({ error: "failed_to_update_role_preset" });
  }
});

router.patch("/cohost-profile", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const { mediaPrefs } = await getNormalizedMediaPrefs(uid);
    const adv = await getAdvancedPermissionsEnabled(uid);
    const simpleMode = mediaPrefs.permissionsMode === "simple" || !adv.enabled;
    if (simpleMode) {
      const lockedProfile = normalizeCohostProfile({ ...SIMPLE_ROLE_DEFAULTS.cohost, label: "Co-Host", isSystem: true });
      return res.json({
        profile: lockedProfile,
        locked: true,
        note: adv.globalLock
          ? "Advanced Permissions are temporarily disabled globally; co-host settings are locked to simple defaults."
          : "Co-host settings are locked in simple mode.",
        lockReason: adv.globalLock ? "global_lock" : "simple_mode_locked",
      });
    }

    const profile = normalizeCohostProfile(req.body || {});
    await firestore.collection("users").doc(uid).set({ cohostProfile: profile }, { merge: true });

    return res.json({ profile, locked: false });
  } catch (err: any) {
    console.error("[account/cohost-profile] update error", err);
    return res.status(500).json({ error: "failed_to_update_cohost_profile" });
  }
});

// Advanced custom roles have been fully replaced by two fixed role
// templates (participant and cohost). Expose a clear, non-successful
// response for any legacy callers so they cannot silently reintroduce
// complexity.

router.get("/roles", async (_req, res) => {
  return res.status(410).json({
    error: "roles_disabled",
    message: "Custom roles have been removed; use role-presets instead.",
  });
});

router.post("/roles", async (_req, res) => {
  return res.status(410).json({ error: "roles_disabled" });
});

router.patch("/roles/:id", async (_req, res) => {
  return res.status(410).json({ error: "roles_disabled" });
});

router.delete("/roles/:id", async (_req, res) => {
  return res.status(410).json({ error: "roles_disabled" });
});

router.put("/roles/quick", async (_req, res) => {
  return res.status(410).json({ error: "roles_disabled" });
});

export default router;
