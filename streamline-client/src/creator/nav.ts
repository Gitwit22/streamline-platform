/**
 * Creator lane navigation items.
 *
 * These are the sidebar / tab-bar entries for the creator lane.
 * Currently the creator lane doesn't have a persistent shell (sidebar),
 * but this registry exists for parity with EDU/Corporate and future use.
 */
export interface CreatorNavItem {
  label: string;
  path: string;
  icon?: string;
  /** Optional access key — when set, only show this item if the matching feature is allowed. */
  accessKey?: string;
}

export const creatorNavItems: CreatorNavItem[] = [
  { label: "Join / Create Room", path: "/join" },
  { label: "Content Library",    path: "/content" },
  { label: "Projects",           path: "/projects" },
  { label: "Destinations",       path: "/settings/destinations" },
  { label: "Monetization",       path: "/settings/monetization", accessKey: "monetization" },
  { label: "Billing",            path: "/settings/billing" },
];

/**
 * Return only the nav items the current user is allowed to see.
 * Items without an `accessKey` are always included.
 * Items *with* an `accessKey` are included only if `allowedFeatures`
 * contains that key set to `true`.
 */
export function getVisibleNavItems(
  allowedFeatures: Record<string, boolean>,
): CreatorNavItem[] {
  return creatorNavItems.filter(
    (item) => !item.accessKey || allowedFeatures[item.accessKey] === true,
  );
}
