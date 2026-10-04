// Shared helpers for formatting numeric entitlements/limits
// Canonical rules (server entitlement convention):
// null => "Unlimited"
//  0   => "Not included"
// >0   => numeric value (optionally with units)
// -1 is still accepted as "Unlimited" for older payloads.

export function formatLimitLabel(limit: number | null | undefined, unit?: string): string {
  if (limit === -1 || limit === null) {
    if (!unit) return "Unlimited";
    const plural = unit.endsWith("s") ? unit : `${unit}s`;
    return `Unlimited ${plural}`;
  }

  if (limit === 0) {
    return "Not included";
  }

  if (limit === undefined || Number.isNaN(Number(limit))) {
    return "Not included";
  }

  if (typeof limit === "number" && limit > 0) {
    if (!unit) return `${limit}`;
    const plural = limit === 1 ? unit : (unit.endsWith("s") ? unit : `${unit}s`);
    return `${limit} ${plural}`;
  }

  return "Not included";
}
