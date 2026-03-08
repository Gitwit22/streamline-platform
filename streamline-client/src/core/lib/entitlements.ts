// Shared helpers for formatting numeric entitlements/limits
// Canonical rules:
// -1 => "Unlimited"
//  0 => "Not included"
// >0 => numeric value (optionally with units)

export function formatLimitLabel(limit: number | null | undefined, unit?: string): string {
  if (limit === -1) {
    if (!unit) return "Unlimited";
    const plural = unit.endsWith("s") ? unit : `${unit}s`;
    return `Unlimited ${plural}`;
  }

  if (limit === 0) {
    return "Not included";
  }

  if (limit == null || Number.isNaN(Number(limit))) {
    return "Not included";
  }

  if (typeof limit === "number" && limit > 0) {
    if (!unit) return `${limit}`;
    const plural = limit === 1 ? unit : (unit.endsWith("s") ? unit : `${unit}s`);
    return `${limit} ${plural}`;
  }

  return "Not included";
}
