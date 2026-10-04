// Production-room access modes (server: streamline-server/lib/roomAccessPolicy.ts).
// New rooms are invite-only by default. The viewer-facing HLS channel is not
// affected by this setting.

export type RoomAccessMode = "invite_only" | "link" | "public";

export const DEFAULT_ROOM_ACCESS: RoomAccessMode = "invite_only";

export const ROOM_ACCESS_OPTIONS: ReadonlyArray<{ value: RoomAccessMode; label: string; description: string }> = [
  {
    value: "invite_only",
    label: "Invite Only",
    description: "Only people you invite (and co-hosts) can join the studio.",
  },
  {
    value: "link",
    label: "Anyone With Link",
    description: "Anyone with the room link can watch from the audience. Going on stage still needs an invite.",
  },
  {
    value: "public",
    label: "Public",
    description: "Like Anyone With Link, and the room may be listed publicly. Going on stage still needs an invite.",
  },
];

export const ROOM_ACCESS_HLS_NOTE = "Viewers watching your HLS channel are unaffected.";

/** Accepts server values and a few spellings; unknown/missing -> invite_only. */
export function normalizeRoomAccess(raw: unknown): RoomAccessMode {
  const v = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "link" || v === "anyone_with_link") return "link";
  if (v === "public") return "public";
  return "invite_only";
}

export function roomAccessLabel(mode: unknown): string {
  const m = normalizeRoomAccess(mode);
  return ROOM_ACCESS_OPTIONS.find((o) => o.value === m)?.label ?? "Invite Only";
}

/**
 * True when a LiveKit identity belongs to a signed-in account (a Firebase
 * uid). Anonymous invite/link guests ("invite:...", "guest_...") and
 * producers can't be made co-hosts (server: cohost_requires_account).
 */
export function isAccountIdentity(identity: string | null | undefined): boolean {
  const id = String(identity ?? "").trim();
  if (!id) return false;
  if (/^(invite|share|direct|legacy|jwt|producer):/.test(id)) return false;
  if (/^(guest|invisible)_/.test(id)) return false;
  return !id.includes(":") && !id.includes("/");
}

/** One-line summary for the invite modal. */
export function roomAccessInviteSummary(mode: unknown): string {
  const m = normalizeRoomAccess(mode);
  if (m === "invite_only") return "Invite only: people need one of these links to join.";
  if (m === "link") return "Anyone with the room link can watch; these links put people on stage.";
  return "Public: anyone can watch; these links put people on stage.";
}
