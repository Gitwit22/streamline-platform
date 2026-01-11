import { Router } from "express";
import { firestore } from "../firebaseAdmin";
import { requireAuth } from "../middleware/requireAuth";
import { clampPresetForPlan, getPresetById, getUserPlanId, MEDIA_PRESETS, MediaPresetId } from "../lib/mediaPresets";
import { getCurrentMonthKey } from "../lib/usageTracker";
import { resolveMaxDestinations } from "../lib/planLimits";
import { getEffectiveEntitlements } from "../lib/effectiveEntitlements";
import crypto from "crypto";

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
  canStream: false,
  canRecord: false,
  canDestinations: false,
  canModerate: false,
  canLayout: false,
  canScreenShare: false,
  canInvite: false,
  canAnalytics: false,
  expiresHours: 24,
  maxUses: 1,
};

type PermissionSet = {
  canStream: boolean;
  canRecord: boolean;
  canDestinations: boolean;
  canModerate: boolean;
  canLayout: boolean;
  canScreenShare: boolean;
  canInvite: boolean;
  canAnalytics: boolean;
};

type RoleProfile = {
  id: string;
  label: string;
  system: boolean;
  lockedName: boolean;
  permissions: PermissionSet;
  slug?: string;
};

const DEFAULT_ROLE_TEMPLATES: RoleProfile[] = [
  {
    id: "viewer",
    slug: "viewer",
    label: "Viewer",
    system: true,
    lockedName: true,
    permissions: {
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: false,
      canLayout: false,
      canScreenShare: false,
      canInvite: false,
      canAnalytics: false,
    },
  },
  {
    id: "participant",
    slug: "participant",
    label: "Participant",
    system: true,
    lockedName: true,
    permissions: {
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: false,
      canLayout: false,
      canScreenShare: false,
      canInvite: false,
      canAnalytics: false,
    },
  },
  {
    id: "cohost",
    slug: "cohost",
    label: "Co-host",
    system: true,
    lockedName: true,
    permissions: {
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: false,
      canLayout: true,
      canScreenShare: true,
      canInvite: false,
      canAnalytics: false,
    },
  },
  {
    id: "moderator",
    slug: "moderator",
    label: "Moderator",
    system: true,
    lockedName: true,
    permissions: {
      canStream: false,
      canRecord: false,
      canDestinations: false,
      canModerate: true,
      canLayout: true,
      canScreenShare: false,
      canInvite: false,
      canAnalytics: false,
    },
  },
];

export const SIMPLE_ROLE_DEFAULTS: Record<"participant" | "moderator" | "cohost", PermissionSet> = {
  participant: {
    canStream: false,
    canRecord: false,
    canDestinations: false,
    canModerate: false,
    canLayout: false,
    canScreenShare: false,
    canInvite: false,
    canAnalytics: false,
  },
  moderator: {
    canStream: false,
    canRecord: false,
    canDestinations: false,
    canModerate: true,
    canLayout: true,
    canScreenShare: false,
    canInvite: false,
    canAnalytics: false,
  },
  cohost: {
    canStream: false,
    canRecord: false,
    canDestinations: false,
    canModerate: false,
    canLayout: true,
    canScreenShare: true,
    canInvite: false,
    canAnalytics: false,
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

async function getPlanFeatures(planId: string) {
  const snap = await firestore.collection("plans").doc(planId).get();
  const data = snap.exists ? (snap.data() as any) || {} : {};
  const features = data.features || {};
  return {
    advancedPermissions: !!features.advancedPermissions,
  };
}

async function getForceSimpleMode() {
  const snap = await firestore.collection("featureFlags").doc("forceSimpleMode").get();
  const data = snap.exists ? (snap.data() as any) || {} : {};
  return {
    enabled: !!data.enabled,
    reason: typeof data.reason === "string" ? data.reason : undefined,
  };
}

async function getAdvancedPermissionsEnabled(uid: string) {
  const userSnap = await firestore.collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const planId = await getUserPlanId(uid);
  const planFeatures = await getPlanFeatures(planId);
  const force = await getForceSimpleMode();
  const override = userData.advancedPermissionsOverride === true;
  const enabled = !force.enabled && (planFeatures.advancedPermissions || override);
  const lockReason = force.enabled ? "global_lock" : enabled ? undefined : "plan";
  return {
    enabled,
    planFlag: planFeatures.advancedPermissions,
    override,
    globalLock: force.enabled,
    lockReason,
    globalReason: force.reason,
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
  return {
    canStream: !!raw?.canStream,
    canRecord: !!raw?.canRecord,
    canDestinations: !!raw?.canDestinations,
    canModerate: !!raw?.canModerate,
    canLayout: !!raw?.canLayout,
    canScreenShare: !!raw?.canScreenShare,
    canInvite: !!raw?.canInvite,
    canAnalytics: !!raw?.canAnalytics,
  };
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
  const quickRoleIds = quickRoleIdsRaw.filter((id) => roleProfiles.find((r) => r.id === id));
  const ensuredQuick = quickRoleIds.length ? quickRoleIds : DEFAULT_ROLE_TEMPLATES.map((r) => r.id);
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
      {
        ...DEFAULT_ROLE_TEMPLATES.find((r) => r.id === "moderator")!,
        permissions: { ...SIMPLE_ROLE_DEFAULTS.moderator },
      },
    ];
    const quickRoleIds = DEFAULT_ROLE_TEMPLATES.map((r) => r.id);
    return { roleProfiles: simpleRoles, quickRoleIds, simpleMode };
  }
  const { roleProfiles, quickRoleIds } = await loadRolesForUser(uid);
  return { roleProfiles, quickRoleIds, simpleMode };
}

router.use(requireAuth);

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

    const liveCurrent = toNumber(usageMinutes.live?.currentPeriod ?? usage.participantMinutes);
    const liveLifetime = toNumber(
      usageMinutes.live?.lifetime ?? ytdMinutes.live?.lifetime ?? ytd.participantMinutes
    );
    const recordingCurrent = toNumber(usageMinutes.recording?.currentPeriod);
    const recordingLifetime = toNumber(
      usageMinutes.recording?.lifetime ?? ytdMinutes.recording?.lifetime
    );

    const effectivePermissionsMode = adv.enabled && mediaPrefs.permissionsMode === "advanced" ? "advanced" : "simple";
    const permissionsModeLockReason = adv.globalLock ? "global_lock" : (adv.enabled ? undefined : "plan");

    // Canonical effective entitlements payload (features + limits) for client gating
    let effectiveEntitlements: any = null;
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

      effectiveEntitlements = {
        planId: entitlements.planId,
        planName: plan.name || entitlements.planId,
        features: {
          recording: !!features.recording,
          rtmpMultistream: rtmpMultistreamEnabled,
          dualRecording: !!(rawFeatures.dualRecording ?? rawFeatures.dual_recording),
          watermark: !!(rawFeatures.watermarkRecordings ?? rawFeatures.watermark),
        },
        limits: {
          maxDestinations: resolveMaxDestinations(limits),
          maxGuests: Number(limits.maxGuests || 0),
          participantMinutes: Number(limits.monthlyMinutes || limits.monthlyMinutesIncluded || 0),
          transcodeMinutes: Number(limits.transcodeMinutes || 0),
          maxRecordingMinutesPerClip: Number(limits.maxRecordingMinutesPerClip || 0),
        },
      };
    } catch (e) {
      console.error("[account/me] failed to compute effectiveEntitlements", e);
    }

    return res.json({
      id: uid,
      email: data.email || null,
      displayName: data.displayName || null,
      permissionsMode: mediaPrefs.permissionsMode,
      advancedPermissions: {
        enabled: adv.enabled,
        plan: adv.planFlag,
        override: adv.override,
        global: adv.globalLock,
        lockReason: adv.lockReason,
        globalReason: adv.globalReason,
      },
      advancedPermissionsLockedReason: adv.lockReason || null,
      effectivePermissionsMode,
      permissionsModeLockReason: permissionsModeLockReason || null,
      mediaPrefs,
      connectedPlatforms: {
        youtube: !!data.youtubeConnected,
        facebook: !!data.facebookConnected,
        twitch: !!data.twitchConnected,
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

router.get("/roles", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const adv = await getAdvancedPermissionsEnabled(uid);
    const { roleProfiles, quickRoleIds, simpleMode } = await loadEffectiveRoles(uid, adv.enabled);
    if (!simpleMode) {
      await firestore.collection("users").doc(uid).set({ roleProfiles, quickRoleIds }, { merge: true });
    }

    return res.json({ roles: roleProfiles, quickRoleIds, locked: simpleMode, lockReason: adv.globalLock ? "global_lock" : undefined });
  } catch (err: any) {
    console.error("[account/roles] error", err);
    return res.status(500).json({ error: "failed_to_load_roles" });
  }
});

router.post("/roles", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const adv = await getAdvancedPermissionsEnabled(uid);
    const { simpleMode, roleProfiles, quickRoleIds } = await loadEffectiveRoles(uid, adv.enabled);
    if (simpleMode) {
      const payload: any = { roles: roleProfiles, quickRoleIds };
      return res.status(400).json(adv.globalLock ? { error: "advanced_disabled", reason: "global_lock", ...payload } : { error: "simple_mode_locked", ...payload });
    }

    const labelRaw = String((req.body?.label ?? "")).trim();
    if (!labelRaw) return res.status(400).json({ error: "label_required" });
    const permissions = normalizePermissions(req.body?.permissions || {});
    const id = crypto.randomBytes(6).toString("hex");

    roleProfiles.push({ id, label: labelRaw.slice(0, 64), system: false, lockedName: false, permissions });
    await firestore.collection("users").doc(uid).set({ roleProfiles, quickRoleIds }, { merge: true });

    return res.json({ roles: roleProfiles, quickRoleIds });
  } catch (err: any) {
    console.error("[account/roles create] error", err);
    return res.status(500).json({ error: "failed_to_create_role" });
  }
});

router.patch("/roles/:id", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const roleId = String(req.params.id);

    const adv = await getAdvancedPermissionsEnabled(uid);
    const { roleProfiles, quickRoleIds, simpleMode } = await loadEffectiveRoles(uid, adv.enabled);
    if (simpleMode) {
      const payload: any = { roles: roleProfiles, quickRoleIds };
      return res.status(400).json(adv.globalLock ? { error: "advanced_disabled", reason: "global_lock", ...payload } : { error: "simple_mode_locked", ...payload });
    }
    const idx = roleProfiles.findIndex((r) => r.id === roleId);
    if (idx === -1) return res.status(404).json({ error: "role_not_found" });

    const current = roleProfiles[idx];
    const nextPermissions = normalizePermissions(req.body?.permissions || {});
    const nextLabel = String(req.body?.label ?? current.label).trim().slice(0, 64) || current.label;

    const updated: RoleProfile = {
      ...current,
      permissions: nextPermissions,
      label: current.lockedName ? current.label : nextLabel,
    };

    roleProfiles[idx] = updated;
    await firestore.collection("users").doc(uid).set({ roleProfiles, quickRoleIds }, { merge: true });

    return res.json({ roles: roleProfiles, quickRoleIds });
  } catch (err: any) {
    console.error("[account/roles update] error", err);
    return res.status(500).json({ error: "failed_to_update_role" });
  }
});

router.delete("/roles/:id", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const roleId = String(req.params.id);

    const adv = await getAdvancedPermissionsEnabled(uid);
    const { roleProfiles, quickRoleIds, simpleMode } = await loadEffectiveRoles(uid, adv.enabled);
    if (simpleMode) {
      const payload: any = { roles: roleProfiles, quickRoleIds };
      return res.status(400).json(adv.globalLock ? { error: "advanced_disabled", reason: "global_lock", ...payload } : { error: "simple_mode_locked", ...payload });
    }
    const role = roleProfiles.find((r) => r.id === roleId);
    if (!role) return res.status(404).json({ error: "role_not_found" });
    if (role.system) return res.status(400).json({ error: "cannot_delete_system_role" });

    const nextRoles = roleProfiles.filter((r) => r.id !== roleId);
    const nextQuick = quickRoleIds.filter((id) => id !== roleId);
    await firestore.collection("users").doc(uid).set({ roleProfiles: nextRoles, quickRoleIds: nextQuick }, { merge: true });

    return res.json({ roles: nextRoles, quickRoleIds: nextQuick });
  } catch (err: any) {
    console.error("[account/roles delete] error", err);
    return res.status(500).json({ error: "failed_to_delete_role" });
  }
});

router.put("/roles/quick", async (req, res) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const adv = await getAdvancedPermissionsEnabled(uid);
    const { roleProfiles, simpleMode, quickRoleIds: effectiveQuick } = await loadEffectiveRoles(uid, adv.enabled);
    if (simpleMode) {
      const payload: any = { roles: roleProfiles, quickRoleIds: effectiveQuick };
      return res.status(400).json(adv.globalLock ? { error: "advanced_disabled", reason: "global_lock", ...payload } : { error: "simple_mode_locked", ...payload });
    }
    const requested: string[] = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map((r: any) => String(r)) : [];
    const filtered = requested.filter((id) => roleProfiles.find((r) => r.id === id));
    const quickRoleIds = filtered.length ? filtered : DEFAULT_ROLE_TEMPLATES.map((r) => r.id);

    await firestore.collection("users").doc(uid).set({ roleProfiles, quickRoleIds }, { merge: true });
    return res.json({ roles: roleProfiles, quickRoleIds });
  } catch (err: any) {
    console.error("[account/roles quick] error", err);
    return res.status(500).json({ error: "failed_to_update_quick_roles" });
  }
});

export default router;
