// DEPRECATED raw-map reader (diagnostics only). Never use it for enforcement:
// the entitlement engine (lib/entitlements) exposes `ent.limits.destinations`
// with null = unlimited and 0 = none. This helper returns the first legacy
// alias found on a RAW plan `limits` map (0 when absent).
export function resolveMaxDestinations(limits: any): number {
  if (!limits) return 0;
  return (
    limits.maxDestinations ??
    limits.rtmpDestinationsMax ??
    limits.rtmpDestinations ??
    0
  );
}
