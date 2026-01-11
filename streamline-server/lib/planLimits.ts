// Destination cap resolver.
// Semantics:
// - > 0  => hard cap on enabled RTMP destinations for this plan
// - 0 or missing => "no cap from limits"; actual availability is controlled
//   separately via feature flags (e.g. features.rtmp / features.rtmpMultistream).
export function resolveMaxDestinations(limits: any): number {
  if (!limits) return 0;
  return (
    limits.maxDestinations ??
    limits.rtmpDestinationsMax ??
    limits.rtmpDestinations ??
    0
  );
}
