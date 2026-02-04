# StreamLine Permissions Audit

This document tracks all HTTP and websocket surfaces that affect rooms, streams, recording, destinations, invites, and related resources. Each row will be updated as we harden permissions and centralize checks.

| Surface | Method | Path/Event | Action | Required Role(s) | Required Permission(s) | Current Guard (where) | Data Returned | Risk | Fix |
| LiveKit Tokens | POST | /api/rooms/:roomId/token | Mint room-scoped LiveKit access token + roomAccessToken (single RTC mint path) | Host (owner), Participant (authed non-owner), Viewer (guest session only) | room.join; roomAccessToken announces canStream/canRecord/canInvite etc | `streamline-server/routes/roomGuestAccess.ts`: secure-by-default policy checks (requiresAuth default true; private rooms owner-only; optional guest join gated behind `ALLOW_GUEST_RTC_JOIN=1` + verified `sl_guest` cookie) | LK access token + roomAccessToken + serverUrl + `x-sl-token-grants: v3-no-sources` header | Low–Medium – join is centralized and returns structured 4xx; primary risk is misconfig (missing LiveKit env) | Keep `/api/health/config` protected and used for deploy sanity checks; consider removing legacy `routes/roomToken.ts` once fully sunset |
| Invites | POST | /api/invites/create | Create invite token for a room with role claim | Host | canInvite | requireAuth + assertRoomPerm(req, roomId, "canInvite"); body must include roomId (no name-only invites) | Signed invite token (roomId, roomName, role) | Low – only the room owner (or a roomAccess token with canInvite for that room) can mint invites | FIXED: server loads room by id and enforces room-level canInvite via assertRoomPerm before issuing invite tokens |
| Invites | POST | /api/invites/accept | Accept invite and optionally persist acceptance record | Guest, Cohost, Moderator | room.join | No auth required for guests; tryGetAuthUser optional; invite token validated via verifyInviteToken; no per-user/room membership check | Room id/name + role, invite acceptance stored when authed | Medium – relies on secrecy of invite token; role is encoded but not re-checked against host’s current permissions | When user is authenticated, check plan/entitlements before allowing elevated roles; mark future work to tie invite role to host’s role profiles |
| HLS | POST | /api/hls/start/:roomId | Start LiveKit HLS egress for room | Host (room owner) | canStream, canRecord, canDestinations (implicit) | requireAuth + requireRoomAccessToken; getRoom(roomId) and check room.ownerId === req.user.uid; assertCanStartHls(req, uid) → canAccessFeature("multistream") | Starts HLS egress, persists playlist URL + egressId | Medium → Low – tied to roomAccess token, room owner, and plan feature gate | Centralized helper: assertCanStartHls(req, uid) uses canAccessFeature("multistream") so HLS start is blocked when the plan/entitlements don’t allow multistream/HLS |
| HLS | POST | /api/hls/stop/:roomId | Stop LiveKit HLS egress | Host (room owner) | canStream | requireAuth + requireRoomAccessToken; getRoom(roomId) and check room.ownerId === req.user.uid | Stops egress, marks HLS idle | Low – same checks as start; owner-only | Consider shared helper with /start to keep checks in one place |
| Multistream | POST | /api/multistream/:roomId/start-multistream | Start RTMP multistream for room | Host (room owner) | canDestinations, canStream | requireAuth + assertRoomPerm(req, roomId, "canDestinations"); resolveRoomIdentity(roomId or name) | Starts composite egress to RTMP URLs (YouTube/FB/Twitch/custom), writes activeStreams entry | High → Medium – now fails with 403 when caller is not the room owner or lacks canDestinations | Centralized guard: assertRoomPerm(req, roomId, "canDestinations") in routes/multistream.ts; only owner (or properly permissioned roomAccess token) can start multistream for a room |
| Recording | POST | /api/recordings/start | Start LiveKit recording for room | Host (room owner) | canRecord | requireAuth; resolveRoomIdentity(roomId or name); canAccessFeature("recording") on account; assertRoomPerm(req, roomId, "canRecord") | Creates recording doc, activeRecordings lock, and starts egress | High → Medium – now returns 403 when caller is not the room owner or lacks canRecord | Centralized guard: assertRoomPerm(req, roomId, "canRecord") in routes/recordings.ts; ownership is resolved via rooms collection before starting egress |
| Recording | POST | /api/recordings/stop | Stop recording | Host (room owner) | canRecord | requireAuth; uses egressId & recording state; does not reload room or assert ownership | Stops egress and updates recording doc | Medium – requires knowledge of recording id/active lock; still no room membership check | Add roomId on active lock and assert it matches caller’s room; or re-load room and assert owner before stopping |
| Destinations | POST | /api/destinations | Create RTMP destination (stores encrypted key) | Host | canDestinations | requireAuth; destination stored under users/{uid}/destinations; no room context | Encrypted stream key, RTMP base URL, platform | Low – scoped to user; no room-level IDOR surface | None – already user-scoped; plan limits enforced via resolveMaxDestinations |
| Room Moderation | POST | /api/roomModeration/mute-all | Mute/unmute all participants in room | Host/Moderator (room-level) | canModerate | requireAuth; resolveRoomIdentity({ roomName: room }); assertRoomPerm(req, roomId, "canModerate") before calling LiveKit | Server-side mute across all participants’ audio tracks | High → Medium – now 403s unless caller is the room owner (or holds a room token with canModerate) | index.ts uses resolveRoomIdentity + assertRoomPerm(req, roomId, "canModerate") for /mute, /mute-all, /mute-lock, and /remove so arbitrary logged-in users can no longer moderate other rooms |

## Bypass Pattern Matches

- **IDOR by roomId**
	- `/api/multistream/:roomId/start-multistream` **FIXED**: now calls `assertRoomPerm(req, roomId, "canDestinations")` after `resolveRoomIdentity`, which loads the canonical room doc and enforces ownership/permissions before starting egress.
	- `/api/recordings/start` **FIXED**: now calls `assertRoomPerm(req, roomId, "canRecord")` after `resolveRoomIdentity`, so only the room owner (or a room-scoped token with canRecord) can start recordings.
	- `/api/roomModeration/mute`, `/mute-all`, `/mute-lock`, `/remove` **FIXED**: now resolve roomId from `room` via `resolveRoomIdentity` and gate with `assertRoomPerm(req, roomId, "canModerate")`, preventing arbitrary logged-in users from moderating other rooms.

- **Viewer/guest surfaces**
	- Viewer/guest access is implemented via guest sessions:
		- `POST /api/invites/:inviteId/redeem` sets HttpOnly `sl_guest` cookie (no RTC token minted here).
		- `GET /api/rooms/:roomId/status` is allowed for host auth OR a matching guest session.
		- `POST /api/rooms/:roomId/token` mints a viewer-only RTC token **only** when `ALLOW_GUEST_RTC_JOIN=1` and the guest session cookie is valid.
	- Public viewer endpoints like `/api/public/hls/:roomId` and `/api/stats/public` are read-only and do not mint RTC tokens or start streams/recordings.

- **Client-provided roles/permissions**
	- Role labels and `permissions` are accepted from the client under `/api/account/roles` (`POST /roles`, `PATCH /roles/:id`, `PUT /roles/quick`), but they are always normalized via `normalizePermissions` and stored on the *caller’s own* user doc; there is no cross-user trust.
	- RTC token minting is centralized at `POST /api/rooms/:roomId/token` and **does not trust client-requested roles**. Role is derived from room ownership + authentication (owner→host, authed non-owner→participant, guest session→viewer).

- **Invite tokens**
	- Invite redemption is done via `POST /api/invites/:inviteId/redeem` (no auth). This issues a signed guest session cookie (`sl_guest`) used for read-only room status and (optionally) viewer RTC join.
	- Tokens are room-bound via these claims; they cannot be used to arbitrarily target other rooms, but currently lack explicit expiry/grace enforcement for viewer invites beyond basic `expiresAt` and usage counters.

## Manual Regression Script (Permissions)

Use these curl-style probes against a dev/staging environment (set `API_BASE` accordingly):

- Anonymous hitting stream start → 401/403
	- `curl -X POST "$API_BASE/api/multistream/ROOM_ID/start-multistream" -H "Content-Type: application/json" -d '{}'`
	- Expected: `401 Unauthorized` (no auth cookie/JWT).

- Logged-in user not in room hitting stream start → 403
	- Login as User B (not the room owner) and reuse a known `ROOM_ID` for User A.
	- `curl -X POST "$API_BASE/api/multistream/ROOM_ID/start-multistream" --cookie "token=USER_B_JWT" -H "Content-Type: application/json" -d '{"youtubeStreamKey":"test"}'`
	- Expected: `403` with `{ "error": "forbidden" }`.

- Viewer token hitting RTC join → 403 (existing behavior)
	- Default (auth-only): `POST /api/rooms/:roomId/token` without auth → `401 { error: "login_required" }`.
	- Optional guest RTC join: with a valid `sl_guest` cookie and `ALLOW_GUEST_RTC_JOIN=1`, token mint returns `200` but role is viewer-only.

- Cohost trying to edit destinations (if not allowed) → 403
	- Using a cohost invite/token, call any future room-scoped destinations/branding endpoint once wired to `assertRoomOwner`.
	- Expected: `403` with `{ "error": "not_room_owner" }`.

- Owner can do all required actions → 200
	- As the room owner:
		- `POST /api/multistream/ROOM_ID/start-multistream` with valid keys → `200` and `success: true`.
		- `POST /api/recordings/start` with `{ roomId: ROOM_ID }` → `200` and `success: true`.
		- `POST /api/roomModeration/mute-all` with `{ room: LIVEKIT_ROOM_NAME, muted: true }` → `200` and `ok: true`.

These scenarios should be re-run after any change to room permissions, roomAccess tokens, or invite handling.
