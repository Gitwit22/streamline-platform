/**
 * Movie Maker lane navigation items.
 *
 * These are the sidebar / tab-bar entries for the Movie Maker lane.
 */
export interface MovieMakerNavItem {
  label: string;
  path: string;
  icon?: string;
}

export const movieMakerNavItems: MovieMakerNavItem[] = [
  { label: "Join / Create Room", path: "/join" },
  { label: "Content Library",    path: "/content" },
  { label: "Projects",           path: "/projects" },
  { label: "Destinations",       path: "/settings/destinations" },
  { label: "Billing",            path: "/settings/billing" },
];
