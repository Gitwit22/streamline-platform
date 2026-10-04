/**
 * Back-compat `effectiveEntitlements` wire payload (pre-engine shape) derived
 * from the engine's EffectiveEntitlements. Sent next to the canonical
 * `entitlements` object on /api/account/me and the room token response so
 * older clients keep working during rollout.
 *
 * LEGACY ENCODING (do not use in new code):
 *   - minutes / guests / clip / projects: 0 = no cap (the historic meaning)
 *   - destinations: the client treats 0 as "none", so unlimited is sent as
 *     LEGACY_UNLIMITED_COUNT
 * New clients read `entitlements.limits` (null = unlimited, 0 = none).
 */
import type { EffectiveEntitlements, Limit, NormalizedPlan } from "./types";

export const LEGACY_UNLIMITED_COUNT = 9999;

function zeroIsUnlimited(limit: Limit): number {
  return limit === null ? 0 : limit;
}

export function toLegacyEntitlementsPayload(ent: EffectiveEntitlements & { plan?: NormalizedPlan }) {
  const pf = ent.planFeatures;
  const destinations = ent.limits.destinations === null ? LEGACY_UNLIMITED_COUNT : ent.limits.destinations;
  const raw = ent.plan?.raw || {};
  const transcodeRaw = raw?.limits?.transcodeMinutes ?? raw?.transcodeMinutes;
  const transcodeMinutes = typeof transcodeRaw === "number" && Number.isFinite(transcodeRaw) ? transcodeRaw : undefined;
  const editingMaxTracks = Number(raw?.editing?.maxTracks ?? 0);

  return {
    planId: ent.planId,
    planName: ent.planName,
    features: {
      // Recording historically shipped already ANDed with the platform switch.
      recording: ent.features.recording,
      rtmpMultistream: pf.multistream,
      multistream: pf.multistream,
      dualRecording: pf.dualRecording,
      watermark: pf.watermark,
      canHls: pf.hls,
      hls: pf.hls,
      hlsEnabled: pf.hls,
      hlsCustomizationEnabled: pf.hlsCustomization,
      canCustomizeHlsPage: pf.hlsCustomization,
      overagesAllowed: pf.overages,
      allowsOverages: pf.overages,
      monetization: pf.monetization,
      payPerView: pf.payPerView,
      invisibleHost: pf.invisibleHost,
      editing: pf.editing,
      contentLibrary: pf.contentLibrary,
      projects: pf.projects,
      editor: pf.editing,
    },
    limits: {
      rtmpDestinationsMax: destinations,
      maxDestinations: destinations,
      maxGuests: zeroIsUnlimited(ent.limits.guests),
      participantMinutes: zeroIsUnlimited(ent.limits.monthlyStreamingMinutes),
      transcodeMinutes,
      maxRecordingMinutesPerClip: zeroIsUnlimited(ent.limits.recordingMinutesPerClip),
      editingMaxProjects: zeroIsUnlimited(ent.limits.projects),
      editingMaxTracks: Number.isFinite(editingMaxTracks) ? editingMaxTracks : 0,
    },
    caps: {
      hlsMaxMinutesPerSession: ent.limits.hlsMaxMinutesPerSession,
    },
  };
}
