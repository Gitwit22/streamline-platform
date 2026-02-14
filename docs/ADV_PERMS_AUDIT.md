# Advanced Permissions Audit

> NOTE: This document is descriptive only. It does not change behavior.
>
> Current reality (as of `x-sl-token-grants: v3-no-sources`): RTC token minting is centralized at `POST /api/rooms/:roomId/token` in `streamline-server/routes/roomGuestAccess.ts` and is intentionally minimal/stable. The legacy `streamline-server/routes/roomToken.ts` implementation is no longer mounted.

---

## A. Permission Dictionary

Canonical permission keys (server: `RolePermissions` / `PermissionSet`, client: `RoomPermissions`):

- `canStream` – Can publish A/V to the room (start camera/mic; act as an active speaker/host).
- `canRecord` – Can start/stop server-side recordings for a room.
- `canDestinations` – Can configure and start/stop multistream / RTMP destinations for a room.
- `canModerate` – Can mute/remove participants and otherwise moderate the room.
- `canLayout` – Can change layout/scene settings for recordings/streams.
- `canScreenShare` – Can share their screen.
- `canInvite` – Can create invites / manage cohost/guest access for the room.
- `canAnalytics` – Can view analytics/insights for the room/account.

These are defined in:

- Server: `RolePermissions` / `RoomPermissionKey` in `streamline-server/lib/rolePermissions.ts`.
- Server: `PermissionSet` and `normalizePermissions()` in `streamline-server/routes/account.ts`.
- Client: `RoomPermissions` and `can()` in `streamline-client/src/pages/Room.tsx`.

No extra keys appear in the UI beyond this set; and every key in the server `RolePermissions` type is represented in the client `RoomPermissions` type.

---

## B. How Roles Become Permissions

### 1) Canonical types and templates

- Server role-permission type:
  - `RolePermissions` in `lib/rolePermissions.ts` mirrors the permission dictionary above.
- Simple-mode role templates (server-side defaults used when Advanced Permissions is off):
  - `ROLE_PERMISSIONS` (`RoomRole -> RolePermissions`) in `lib/rolePermissions.ts` defines:
    - `participant` – all flags `false`.
    - `moderator` – `canModerate`, `canLayout` true; others false.
    - `cohost` – `canStream`, `canRecord`, `canDestinations`, `canLayout`, `canScreenShare`, `canInvite` true; `canModerate`, `canAnalytics` false.
- Account-level role profiles and templates (used by `/api/account/roles*` and the Advanced UI):
  - `PermissionSet`, `RoleProfile`, `DEFAULT_ROLE_TEMPLATES`, and `SIMPLE_ROLE_DEFAULTS` in `routes/account.ts`.
  - `normalizePermissions(raw)` ensures all eight permission flags are boolean.
  - `normalizeRoleProfiles(rawRoles)` merges arbitrary stored roles with `DEFAULT_ROLE_TEMPLATES` and runs through `normalizePermissions`.

### 2) Simple vs Advanced mode resolution

- Advanced flag behavior is documented in `docs/ADVANCED_PERMISSIONS_FLAG.md` and enforced in `routes/account.ts`.
  - NOTE: Advanced permissions currently apply primarily to server-side endpoint guards (e.g. `assertRoomPerm`) and UI gating. They are not fully reflected in the RTC token mint endpoint.
    - Plan feature `features.advancedPermissions`.
    - Per-user `advancedPermissionsOverride`.
    - Global lock via `featureFlags/forceSimpleMode`.
- `permissionsMode` (`mediaPrefs.permissionsMode`) is still used by account/roles UI and related logic.
  - NOTE: The RTC token mint endpoint does not currently branch on permissionsMode.

- Effective role profiles used at runtime are produced by `loadEffectiveRoles(uid, advancedEnabled)` in `routes/account.ts`:
  - When *simple mode* is active:
    - Returns four role profiles: `viewer`, `participant`, `cohost`, `moderator`.
    - Permissions come from `SIMPLE_ROLE_DEFAULTS` (server-maintained defaults), **not** user overrides.
    - `quickRoleIds` is set from `DEFAULT_ROLE_TEMPLATES`.
  - When *advanced mode* is active:
    - Loads user `roleProfiles` from the `users/{uid}` doc, runs them through `normalizeRoleProfiles`.
    - Filters `quickRoleIds` to only those present in the current role profiles; falls back to all default templates when empty.

### 3) Role resolution at RTC token-mint time (`POST /api/rooms/:roomId/token`)

- Implementation: `streamline-server/routes/roomGuestAccess.ts`.

- Current behavior:
  - **Owner (authed)**: `host` (LiveKit `roomAdmin: true`, publish/subscribe).
  - **Authed non-owner**: `participant` (publish/subscribe).
  - **Guest session**: `viewer` (subscribe-only), only allowed when `ALLOW_GUEST_RTC_JOIN=1` and a valid `sl_guest` cookie exists.
  - The endpoint is **auth-only by default** (rooms default `requiresAuth: true`).
  - Client-requested role values are not trusted for RTC grants.

### 4) Moderator permissions

- Moderator defaults:
  - Simple-mode: `SIMPLE_ROLE_DEFAULTS.moderator` (full moderation abilities, no streaming). Mirrored by `ROLE_PERMISSIONS.moderator` for invite-based roles.
  - Advanced-mode: base permissions via `resolveRoleForInvite` (in `routes/roomToken.ts`) give moderator `canModerate` and `canAnalytics` plus the standard stream/layout/share flags, then clamped by entitlements.

---

## C. Server-Side Permission Enforcement (by Endpoint)

Below, “perm key required” refers to `RoomPermissionKey` / `RolePermissions` evaluated via `assertRoomPerm` or `assertRoomOwner`.

### 1) Room token minting

- Endpoint: `POST /api/rooms/:roomId/token` in `streamline-server/routes/roomGuestAccess.ts`.
- Intended permissions:
  - Determines what LiveKit can do (publish/subscribe, admin) and what the roomAccess token announces as `permissions`.
- Actual checks:
  - Auth required by default (`requiresAuth` defaults to true for older room docs).
  - Room policy enforcement:
    - `visibility` defaults to `unlisted`; `private` rooms are owner-only.
    - `requiresPayment` triggers `402 payment_required` for non-owners.
    - Guests can only join once the room is live (`409 room_not_live`).
  - Adds response header `x-sl-token-grants: v3-no-sources` so deployments can be verified quickly.

### 2) Invites

- Endpoint: `POST /api/invites/create` in `routes/invites.ts`.
  - Intended perm: `canInvite`.
  - Current guard:
    - `requireAuth` at route entry.
    - Body must include `roomId`; name-only invites not allowed.
    - `assertRoomPerm(req, roomId, "canInvite")` ensures room owner or a room token with `canInvite` can create invites.
  - Status: **Aligned** with permissions model.

### 3) Recordings

- `POST /api/recordings/start` in `routes/recordings.ts`.
  - Intended perms:
    - Plan feature: recording-enabled plan (`canAccessFeature("recording")`).
    - Room-level: host/cohost with `canRecord`.
  - Current guard:
    - `requireAuth` → `uid`.
    - `canAccessFeature(accountOrUid, "recording")`.
    - `resolveRoomIdentity` → `roomId`, `roomName`.
    - `assertRoomPerm(req, roomId, "canRecord")`.
  - Status: **Aligned** (plan + room permission).

- `POST /api/recordings/stop` in `routes/recordings.ts`.
  - Intended perms:
    - Same as start: only room actors with `canRecord` should be able to stop.
  - Current guard:
    - `requireAuth` → `uid`.
    - Loads recording doc; resolves `roomId` (from `data.roomId` or via `resolveRoomIdentity({ roomName })`).
    - `assertRoomPerm(req, roomId, "canRecord")`.
  - Status: **Aligned**.

### 4) Multistream (RTMP destinations)

- `POST /api/multistream/:roomId/start-multistream` in `routes/multistream.ts`.
  - Intended perms:
    - Plan feature: multistream/RTMP enabled (`canAccessFeature(accountOrUid, "multistream")`).
    - Room-level: host/cohost with `canDestinations`.
  - Current guard:
    - `requireAuth`.
    - `resolveRoomIdentity` from `roomId`/name.
    - `assertRoomPerm(req as any, roomId, "canDestinations")`.
    - Plan/limits: `canAccessFeature(..., "multistream")`, `getPlanLimit(uid, "maxDestinations")`.
  - Status: **Aligned**.

- `POST /api/multistream/:roomId/stop-multistream` in `routes/multistream.ts`.
  - Intended perms: mirror start.
  - Current guard:
    - `requireAuth`.
    - `resolveRoomIdentity`.
    - `assertRoomPerm(req as any, roomId, "canDestinations")`.
    - Then ownership/room matching via `activeStreams` doc.
  - Status: **Aligned**.

### 5) HLS Start/Stop

- `POST /api/hls/start/:roomId` in `routes/hls.ts`.
  - Intended perms:
    - Room-level: room owner only.
    - Plan feature: `canHls` (derived from multistream/HLS flags via `getEffectiveEntitlements`).
  - Current guard:
    - `requireAuth` + `requireRoomAccessToken`.
    - `getRoom(roomId)`; `assertRoomOwner(req, roomId)` (room owner check via `RoomPermissionError`).
    - `assertCanStartHls(req, uid)` uses `getEffectiveEntitlements` and `features.canHls` + raw HLS flags.
  - Status: **Aligned** (owner-only + plan gate). HLS does **not** use `canDestinations` at the room level; it is owner-only.

- `POST /api/hls/stop/:roomId` in `routes/hls.ts`.
  - Intended perms:
    - Room-level: owner-only, but **always allowed**, even if the plan is downgraded mid-session.
  - Current guard:
    - `requireAuth` + `requireRoomAccessToken` with matching `roomId`.
    - `getRoom(roomId)`; rejects when `room.ownerId !== uid` with `403 { error: "not_room_owner" }`.
    - Best-effort `stopEgress`, compute `durationMinutes`, call `incrementHlsUsageMinutes`.
  - Status: **Aligned**.

### 6) Room Moderation

- Endpoints in `index.ts` under `/api/roomModeration/*`.
  - Intended perms: `canModerate`.
  - Current guard (based on earlier audit and recent patches):
    - `requireAuth`.
    - `resolveRoomIdentity({ room: livekitRoomName })`.
    - `assertRoomPerm(req, roomId, "canModerate")` for `/mute`, `/mute-all`, `/mute-lock`, `/remove`.
  - Status: **Aligned**.

---

## D. Permissions in Tokens (LiveKit Grants)

- Primary file: `streamline-server/routes/roomGuestAccess.ts`.
- Legacy (not mounted): `streamline-server/routes/roomToken.ts`.

### 1) viewer tokens

- In simple mode:
  - Viewer room tokens are **disabled**. Attempts to request viewer tokens produce `simple_mode_locked` and instruct clients to use watch links instead.
- In advanced mode:
  - `resolveRoleForInvite` can return a `grantRole` of `viewer`.
  - `roleToGrant("viewer")` yields LiveKit grants with:
    - `roomJoin: true`, `canSubscribe: true`.
    - `canPublish: false`, `canPublishData: false`, `canUpdateMetadata: false`, `roomAdmin: false`.
  - Permissions object in the roomAccess token is still clamped by entitlements, but for viewer the key distinction is that the LK token is subscribe-only.

### 2) moderator tokens

- For moderators, `roleToGrant("moderator")` returns:
  - `canPublish: true`, `canPublishData: true`, `canUpdateMetadata: true`, `roomAdmin: true`.
- This is a superset of basic streaming abilities; moderator tokens can both publish and moderate.
- Permissions in the roomAccess token (`permissions` object) will show `canModerate: true`, `canStream: true`, etc., but actual room moderation endpoints still rely on `assertRoomPerm(..., "canModerate")` using the token’s `permissions` claim.

### 3) cohost tokens

- `GrantRole` mapping treats `cohost` as:
  - `effectiveRoleKey: "cohost"`.
  - `grantRole: "participant"` to LiveKit (can publish, but no `roomAdmin`).
  - Permissions object in roomAccess token includes `canStream`, `canRecord`, `canDestinations`, `canInvite`, etc., clamped by entitlements.

### 4) Alignment with UI and guards

- UI:
  - The client reads room permissions from the roomAccess token (see `setRoomPermissions` in `Room.tsx`) and exposes `can(key)` as a thin wrapper.
  - For example, HLS currently uses `can("canDestinations")` in the UI, which differs from server behavior (owner-only + plan).
- Server:
  - Relies on `assertRoomPerm` (which trusts the roomAccess token’s `permissions` and role) for most room-scoped actions, plus plan entitlements.

---

## E. UI Gating

### 1) `can()` helper (client)

- File: `streamline-client/src/pages/Room.tsx`.
- Definitions:
  - `type RoomPermissions` mirrors server `RolePermissions`.
  - `const [roomPermissions, setRoomPermissions] = useState<RoomPermissions | null>(null);`
  - `const can = (key: keyof RoomPermissions) => isHost || !!roomPermissions?.[key];`
- `roomPermissions` is populated from the decoded room token (roomAccess token claims) when joining a room.

### 2) Key UI gates

- Invite links (Room header / invites UI):
  - `const canInviteLinks = !isViewer && (isHost || can("canInvite"));`
  - Matches `/api/invites/create` guard (`canInvite`).

- Generic stream management CTA:
  - `const canManageStream = !isViewer && (isHost || can("canStream") || can("canRecord") || can("canDestinations"));`
  - This drives whether a user sees the main stream-management UI.

- Recording controls:
  - `const recordingEnabled = planRecordingEnabled && can("canRecord");`
  - UI requires both:
    - Plan flag for recording, and
    - Room permission `canRecord`.
  - Matches `/api/recordings/start` and `/stop` (plan gate + `canRecord`).

- Multistream controls:
  - `const canMultistream = planMultistreamEnabled && can("canDestinations");`
  - UI requires:
    - `features.multistream` (plan-level), and
    - Room permission `canDestinations`.
  - Matches `/api/multistream/*` (plan gate + `canDestinations`).

- HLS controls:
  - `const canHls = planHlsEnabled && can("canDestinations");`
  - HLS panel props in `Room.tsx`:
    - `hlsEnabled={canHls}`.
  - In `StreamSetupModal.tsx`:
    - `const hlsAllowed = hlsEnabled !== false;`.
    - When `!hlsAllowed`, show upgrade CTA and disable HLS start.
  - **Mismatch** with server:
    - Server: `assertRoomOwner` + `assertCanStartHls` (no `canDestinations` requirement).
    - UI: ties HLS to `canDestinations`; cohosts with `canDestinations` but not owners will see HLS controls enabled, but will be rejected by the server.

- Moderation UI:
  - Not fully enumerated here, but moderation controls in the room UI are expected to be gated on `can("canModerate")` and/or host status; server enforces `canModerate` for `/roomModeration/*`.

---

## F. Drift & Gaps

### 1) HLS permission mismatch (UI vs server)

- **Intended model**:
  - HLS is an owner-only capability, further gated by the plan’s `canHls` feature.
- **Current server behavior**:
  - `/api/hls/start/:roomId`:
    - Requires room owner via `assertRoomOwner(req, roomId)`.
    - Requires entitlements via `assertCanStartHls` (checks `features.canHls` + legacy HLS feature flags).
  - `/api/hls/stop/:roomId`:
    - Owner-only; no plan gate (owner can always stop).
- **Current UI behavior**:
  - `canHls = planHlsEnabled && can("canDestinations");` in `Room.tsx`.
  - HLS controls enabled for any user with `canDestinations` (cohost) when plan has HLS.
- **Impact**:
  - Cohosts with `canDestinations` will see HLS controls enabled but receive 403s when calling `/api/hls/start`.
- **Recommended fix (no behavior change applied yet)**:
  - UI should align to owner-only semantics:
    - `const canHls = planHlsEnabled && isHost;` or a dedicated `can("canStream")` check for HLS if we ever permit non-owners.
  - Patch suggestion (not yet applied):
    - [streamline-client/src/pages/Room.tsx](streamline-client/src/pages/Room.tsx#L1720-L1765): change `canHls` to depend on `isHost` and plan flag instead of `can("canDestinations")`.

### 2) Advanced-mode moderator/cohost permissions vs LiveKit grants

- **Observation**:
  - In advanced mode, `resolveRoleForInvite` seeds moderators and cohosts with fairly broad base permissions, then clamps via entitlements.
  - LiveKit grants for moderators allow publishing and full room admin (`roomAdmin: true`), even though in simple mode moderators are not expected to have stream-start authority.
- **Risk**:
  - The permission matrix for advanced-mode moderators may diverge from the expectations encoded in `SIMPLE_ROLE_DEFAULTS.moderator` and `ROLE_PERMISSIONS.moderator`.
- **Recommended follow-up** (not behavior changes yet):
  - Document the intended advanced-mode roles in this audit.
  - Consider aligning advanced-mode base permissions for moderators/cohosts with `SIMPLE_ROLE_DEFAULTS` for consistency, then only widening where explicitly configured via role profiles.

### 3) `canAnalytics` is largely unused

- **Observation**:
  - `canAnalytics` exists in `RolePermissions`, `PermissionSet`, and `RoomPermissions`.
  - There are currently no server endpoints or UI surfaces that clearly enforce or depend on `canAnalytics`.
- **Risk**:
  - Dead or misleading permission key; clients may assume it is enforced when it is not.
- **Recommended follow-up**:
  - Either:
    - Wire `canAnalytics` to the relevant analytics/usage endpoints and views, or
    - Remove it from role editors and documentation, leaving it as an internal future flag.

### 4) Viewer vs guest semantics

- **Observation**:
  - Viewer room tokens are blocked in simple mode but supported in advanced mode.
  - Viewer roles are mapped to subscribe-only tokens in LiveKit.
  - The room UI treats `isViewer` separately (e.g., banner: "View-only mode — publishing controls are disabled.").
- **Gap**:
  - There is no single, central document describing when viewer tokens vs watch links should be used, and how that interacts with Advanced Permissions.
- **Recommended follow-up**:
  - Expand this audit or `ADVANCED_PERMISSIONS_FLAG.md` with a section on viewer/watch-link policy and how it relates to `permissionsMode`.

---

## G. Fix Order / Patch Plan (No changes applied yet)

> The items below are a proposed implementation order. They are **not** yet applied; this document is an audit and patch plan.

1) **Align HLS UI gating with server model**

- Goal: Ensure only owners with `canHls` plan feature see HLS Start enabled.
- Files / functions:
  - [streamline-client/src/pages/Room.tsx](streamline-client/src/pages/Room.tsx#L1720-L1765)
    - Change:
      - From: `const canHls = planHlsEnabled && can("canDestinations");`
      - To (example): `const canHls = planHlsEnabled && isHost;`
    - Verify:
      - HLS controls (Start button and section in `StreamSetupModalV2`) only appear enabled when host and plan allow HLS.
- Regression probes:
  - Extend `scripts/security-probes.ts` (already includes HLS start/stop tests) to assert that cohosts with `canDestinations` cannot start HLS and that the UI hides/locks controls for them (manual UI check).

2) **Clarify and, if needed, align advanced-mode moderator/cohost base permissions**

- Goal: Reduce confusion between simple-mode and advanced-mode role semantics.
- Files / functions:
  - [streamline-server/routes/account.ts](streamline-server/routes/account.ts#L240-L320)
    - Confirm `SIMPLE_ROLE_DEFAULTS` and `DEFAULT_ROLE_TEMPLATES` describe the intended defaults for moderator/cohost.
  - [streamline-server/routes/roomToken.ts](streamline-server/routes/roomToken.ts#L80-L160)
    - Compare advanced-mode `basePerms` in `resolveRoleForInvite` to `SIMPLE_ROLE_DEFAULTS`.
- Proposed change (if you choose to align them):
  - Base permissions for advanced-mode moderator/cohost should be derived from the same defaults as simple-mode, then overridden by user-defined roleProfiles, instead of using an all-true baseline.
- Tests:
  - Add unit-level tests or probes for token payloads under both simple and advanced modes, confirming `permissions` shape for host/cohost/moderator.

3) **Decide on `canAnalytics` usage and wire or deprecate**

- Goal: Avoid dead or misleading permission keys.
- Files / functions:
  - [streamline-server/routes/account.ts](streamline-server/routes/account.ts#L240-L320) – `normalizePermissions` and role templates.
  - Client analytics / usage UI components (to be identified) that should obey `canAnalytics`.
- Proposed options:
  - Option A: Wire Analytics UI visibility and any analytics-focused API endpoints to `canAnalytics` (plus relevant plan limits).
  - Option B: Remove `canAnalytics` from role editor UI and mark it as reserved for future use.

4) **Document viewer vs watch-link policy in Advanced Permissions docs**

- Goal: Make it clear how viewer tokens, invites, and watch links should be used across Simple/Advanced modes.
- Files:
  - [docs/ADVANCED_PERMISSIONS_FLAG.md](docs/ADVANCED_PERMISSIONS_FLAG.md)
  - [docs/ADV_PERMS_AUDIT.md](docs/ADV_PERMS_AUDIT.md) (this file).
- Proposed changes:
  - Add a section that:
    - States that Simple mode disables viewer room tokens and prefers watch links.
    - Describes how Advanced mode can enable viewer roles, and how these interact with invites and room moderation.

This patch plan intentionally focuses on **synchronizing** the permissions model across server guards, token minting, and UI gating, without proposing any breaking behavior change beyond clarifying HLS ownership semantics in the UI.
