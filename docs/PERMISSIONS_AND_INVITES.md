# Permissions, Roles, and Invites (Canonical)

This doc is the single reference for **room security**, **roles/permissions**, and **invite flows**.

## Permission dictionary (room-level)

Canonical permission keys used by the server (`RolePermissions` / `RoomPermissionKey`) and mirrored client-side:

- `canStream` — publish A/V (be an active speaker/host)
- `canRecord` — start/stop server-side recordings
- `canDestinations` — configure/start/stop multistream / RTMP destinations
- `canModerate` — mute/remove participants; moderation actions
- `canLayout` — change layout/scene settings
- `canScreenShare` — screen sharing
- `canInvite` — create invites / manage guest access
- `canAnalytics` — view analytics/insights

Code entry points:

- Server: `streamline-server/lib/rolePermissions.ts`
- Server normalization + role profiles: `streamline-server/routes/account.ts`
- Client gating helpers: `streamline-client/src/pages/Room.tsx`

## Simple vs Advanced permissions mode

Advanced mode is enabled when either:

- Plan has `features.advancedPermissions === true`, OR
- User has `advancedPermissionsOverride === true`

Global lock:

- `featureFlags/forceSimpleMode` can force everyone into Simple mode.

Server behavior summary:

- `/api/account/me` reports the effective state (`advancedPermissions`, `permissionsMode`, and lock reason when applicable).
- Account/role profile endpoints coerce to simple defaults when Advanced is disabled.

## RTC token minting (LiveKit)

Single stable token mint path:

- `POST /api/rooms/:roomId/token` (server: `streamline-server/routes/roomGuestAccess.ts`)

Key properties:

- Secure-by-default policy checks (auth required by default; private rooms owner-only; optional guest RTC join only when explicitly enabled).
- The endpoint does **not** trust client-provided roles for grants.
- A deployment header (`x-sl-token-grants: ...`) is used to verify which grant strategy is live.

## Invites

There are two related concepts:

1) **Share links** (UI convenience)
- A simple “copy join URL” pattern (example: `/join?room=<roomName>`). This improves UX but does not grant elevated permissions by itself.

2) **Invite tokens / elevated access** (security surface)
- Room-scoped invite creation is guarded by `canInvite`.
- Invite acceptance/redeem flows should be treated as a security boundary (rate limit, expiry, max uses, and server-side validation).

## Server-side enforcement (high signal list)

These are the main backend enforcement points to keep consistent:

- Recording start/stop: `streamline-server/routes/recordings.ts` (plan gating + `assertRoomPerm(..., "canRecord")`)
- Multistream start/stop: `streamline-server/routes/multistream.ts` (plan gating + `assertRoomPerm(..., "canDestinations")`)
- HLS start/stop: `streamline-server/routes/hls.ts` (owner-only + plan/entitlement gating)
- Room moderation: routed under `/api/roomModeration/*` (guarded by `assertRoomPerm(..., "canModerate")`)
- Destinations CRUD: `/api/destinations/*` is user-scoped; still enforce plan destination limits

## Testing checklist

- Non-owner cannot start recording or multistream for a room.
- Viewer/guest cannot mint elevated RTC tokens.
- `canInvite` is required to create elevated invites.
- Downgrade scenarios don’t break “stop” endpoints (stopping should remain allowed, even if the plan changes mid-session).
