export function isPlatformEnabled(platformEnabled: unknown): boolean {
  // Default: enabled when missing/unknown
  return platformEnabled !== false;
}

export function isFeatureAvailable(planAllows: unknown, platformEnabled: unknown): boolean {
  return Boolean(planAllows) && isPlatformEnabled(platformEnabled);
}
