export type FeatureKey = "recording" | "hls" | "multistream" | "transcode";

export function getFeatureErrorMessage(code: unknown, feature: FeatureKey): string {
  const c = String(code || "").trim();

  // Platform kill-switches
  if (c === "feature_disabled") {
    if (feature === "recording") return "Recording is temporarily disabled platform-wide.";
    if (feature === "hls") return "HLS is temporarily disabled platform-wide.";
    return "This feature is temporarily disabled platform-wide.";
  }
  if (c === "TRANSCODE_DISABLED") {
    return "Transcoding is temporarily disabled during beta.";
  }

  // Plan/entitlement denial
  if (c === "feature_not_entitled" || c === "hls_not_in_plan") {
    if (feature === "recording") return "Recording is not included in your plan.";
    if (feature === "hls") return "HLS Broadcast Page is not included in your plan.";
    if (feature === "multistream") return "Multistreaming is not included in your plan.";
    return "This feature is not included in your plan.";
  }

  // Room permission / token mismatch is handled elsewhere; keep generic fallback.
  return "Feature unavailable.";
}
