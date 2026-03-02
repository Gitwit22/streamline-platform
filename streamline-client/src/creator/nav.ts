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
}

export const creatorNavItems: CreatorNavItem[] = [
  { label: "Join / Create Room", path: "/join" },
  { label: "Content Library",    path: "/content" },
  { label: "Projects",           path: "/projects" },
  { label: "Destinations",       path: "/settings/destinations" },
  { label: "Billing",            path: "/settings/billing" },
];
