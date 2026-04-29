# Room Issues Chronicle

> Quick-reference for every room-related bug we've hit, its root cause, fix, and what to check if it resurfaces.

---

## Issue #1 — `Cannot convert TrackSource microphone to string` (500)

| Field | Detail |
|-------|--------|
| **Date** | 2026-03-02 |
| **Symptom** | `POST /api/rooms/:roomId/token` returns `500 { code: "internal_error", error: "Failed to create room token" }` |
| **Server log** | `/api/rooms/:roomId/token error Cannot convert TrackSource microphone to string` |
| **Root cause** | `roomGuestAccess.ts → roleGrant()` included `canPublishSources: ["microphone", "camera", ...]` (string literals) in the LiveKit grant. `livekit-server-sdk` v2.6.1 expects `TrackSource` protobuf enum values (integers), not strings. The SDK throws when it tries to serialize strings into the protobuf wire format. |
| **Fix** | Removed `canPublishSources` from the LiveKit grant in `roleGrant()`. `canPublish: true` already allows all track sources at the LiveKit level. `roomToken.ts` already omitted it and worked fine. |
| **Files** | `streamline-server/routes/roomGuestAccess.ts` (lines 250-267) |
| **Commit** | `fff65362` on `edu` branch |
| **Prevention** | Never pass string-typed `LiveKitTrackSource[]` into `addGrant()`. If fine-grained source control is needed, convert to `TrackSource` enum from `livekit-server-sdk` first. |

---

## Issue #2 — Demo bypass hijacks all API calls (token stops working)

| Field | Detail |
|-------|--------|
| **Date** | 2026-03-02 |
| **Symptom** | After testing demo mode, normal authenticated sessions get 401 errors or tokens aren't sent. All API calls fail silently. |
| **Root cause** | `getDemoBypassLane()` in `api.ts` checks `localStorage` for `sl_edu_bypass` or `sl_corporate_bypass`. If either is `"true"` (left over from a demo session), the `apiFetchAuth()` function skips Firebase token retrieval entirely and sends only the `x-sl-demo` header. In non-demo contexts this means no auth token is sent. |
| **Fix** | 1) Gated the demo bypass block behind `if (LANES_ENABLED)` so it's inert when lanes are disabled. 2) Manual cleanup: `localStorage.removeItem("sl_edu_bypass"); localStorage.removeItem("sl_corporate_bypass")` |
| **Files** | `streamline-client/src/lib/api.ts` (apiFetchAuth function) |
| **Prevention** | Demo bypass localStorage flags should be cleared on logout. Consider adding an auto-clear in `clearAuthStorage()`. |

---

## Issue #3 — Demo mode go-live returns 403

| Field | Detail |
|-------|--------|
| **Date** | 2026-03-02 |
| **Symptom** | In EDU or Corporate demo/bypass mode, clicking "Go Live" returns HTTP 403. Org context calls also fail. |
| **Root cause** | Demo bypass was client-only — no real Firebase auth token exists in bypass mode. The server's `requireAuth` middleware rejected all API calls because no valid JWT was present. |
| **Fix** | Multi-layer fix: |
|         | 1. **Client `api.ts`**: `getDemoBypassLane()` checks localStorage bypass flags, sends `x-sl-demo: edu\|corporate` header, skips token requirement |
|         | 2. **Server `requireAuth.ts`**: Checks `x-sl-demo` header at top of `requireAuth()`, injects synthetic `req.user` + `req.account` for demo UIDs (`edu-demo` / `corp-demo`) when not in production |
|         | 3. **Server `eduOrgContext.ts`**: Returns synthetic org context for `uid === "edu-demo"` |
|         | 4. **Server `corpOrg.ts`**: Returns synthetic org context for `uid === "corp-demo"` |
| **Files** | `api.ts`, `requireAuth.ts`, `eduOrgContext.ts`, `corpOrg.ts` |
| **Prevention** | Any new authenticated server route that demo mode needs must handle the `x-sl-demo` header or rely on the `requireAuth` synthetic injection. |

---

## Issue #4 — Deprecation warnings flooding server logs

| Field | Detail |
|-------|--------|
| **Date** | 2026-03-02 (observed) |
| **Symptom** | Server logs filled with: `[deprecation] guest session provided via Authorization header; send x-guest-session or use sl_guest cookie instead` and `[deprecation] roomAccessToken provided via Authorization header; send x-room-access-token instead` |
| **Root cause** | Client sending guest session tokens and room access tokens via the `Authorization` header instead of dedicated headers. The server accepts both but logs deprecation warnings. |
| **Files** | `streamline-server/middleware/guestSession.ts` (line 48), `streamline-server/middleware/roomAccessToken.ts` (line 103) |
| **Expected headers** | Guest sessions: `x-guest-session` header or `sl_guest` cookie. Room access: `x-room-access-token` header. |
| **Status** | Cosmetic / non-breaking — server still processes both paths. Client should migrate to dedicated headers to silence warnings. |

---

## Quick-Reference: All Room Token Error Codes

These are the HTTP error responses from `POST /api/rooms/:roomId/token` and `POST /api/roomToken`:

### 4xx Client Errors

| Status | Code | Meaning | Route File |
|--------|------|---------|------------|
| 400 | `roomId_required_for_host` | Authenticated host didn't provide roomId | roomToken.ts |
| 400 | `feature_not_entitled` | Room couldn't be resolved (missing entitlement) | roomToken.ts |
| 400 | `room_not_rtc` | Room is HLS-only, not an RTC room | roomToken.ts |
| 400 | `inviteId_required` | Invite redeem called without inviteId | roomGuestAccess.ts |
| 401 | `Authentication required` | No uid on request | roomToken.ts |
| 401 | `auth_required_for_elevated_role` | Cohost/moderator request without auth | roomToken.ts |
| 401 | `session_revoked` | Token issued before account's `authRevokedAtMs` | requireAuth.ts |
| 401 | `unauthorized` | No valid auth token at all | requireAuth.ts |
| 402 | `payment_required` | Plan doesn't cover live rooms | roomToken.ts |
| 403 | `invite_room_mismatch` | Invite's roomId doesn't match requested room | roomToken.ts |
| 403 | `invite_revoked` | Invite has been revoked | roomGuestAccess.ts |
| 403 | `account_deleted` | Account marked as deleted | requireAuth.ts |
| 403 | `not_room_owner` | Non-owner tried owner-only action | roomControls |
| 404 | `invite_not_found` | Invite doc doesn't exist | roomGuestAccess.ts |
| 409 | `room_owner_missing` | Room exists but no ownerId set | roomToken.ts |
| 409 | `invite_room_missing` | Invite exists but its room doesn't | roomGuestAccess.ts |
| 410 | `legacy_roomname_join_disabled` | Name-only join is deprecated | roomToken.ts |
| 410 | `invite_expired` | Invite past its TTL | roomGuestAccess.ts |
| 410 | `invite_max_used` | Invite exceeded max uses | roomGuestAccess.ts |
| 429 | `room_full` | Room at participant capacity | both |
| 429 | `rate_limited` | IP rate limit on invite redemption | roomGuestAccess.ts |

### 5xx Server Errors

| Status | Code | Meaning | Route File |
|--------|------|---------|------------|
| 500 | `misconfigured` / `LiveKit keys missing` | `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` not set | roomToken.ts |
| 500 | `misconfigured` / `LIVEKIT_URL missing` | `LIVEKIT_URL` env var not set | both |
| 500 | `internal_error` / `invalid_identity` | Token identity resolved to empty string | both |
| 500 | `internal_error` / `invalid_livekit_room_name` | LiveKit room name resolved to empty | roomToken.ts |
| 500 | `internal_error` / `room_init_failed` | Firestore room doc creation failed | roomToken.ts |
| 500 | `internal_error` / `Failed to create room token` | Catch-all for any unhandled exception | both |
| 503 | `capacity_check_busy` | Capacity lock contention | both |
| 503 | `capacity_check_unavailable` | Capacity system down | roomGuestAccess.ts |

---

## Quick-Reference: Environment Variables That Affect Room Tokens

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `LIVEKIT_API_KEY` | **Yes** | — | LiveKit API key for minting tokens |
| `LIVEKIT_API_SECRET` | **Yes** | — | LiveKit API secret for signing tokens |
| `LIVEKIT_URL` | **Yes** | — | LiveKit server URL returned to clients |
| `ROOM_ACCESS_TOKEN_SECRET` | Prod: Yes | Falls back to `JWT_SECRET`, then `"dev-secret"` | Signs the `roomAccessToken` JWT |
| `JWT_SECRET` | Prod: Yes | — | Fallback for room access token signing |
| `AUTH_DEBUG` | No | `"0"` | When `"1"`, logs detailed auth/token debug info and includes error messages in 500 responses |
| `AUDIT_ROOM_TOKENS` | No | `"0"` | When `"1"`, writes token issuance audit trail to Firestore |
| `ALLOW_DEMO_BYPASS` | No | `"0"` | When `"1"`, allows `x-sl-demo` header even in production |
| `LANES_ENABLED` | No | `"0"` | Server-side gate for EDU/Corporate API routes |

---

## Architecture Notes

### Two Token Routes (important!)

There are **two** files that mint room tokens:

1. **`routes/roomToken.ts`** — Mounted at `POST /api/roomToken`
   - Used by the **Creator lane** (authenticated host flow)
   - Uses `requireAuthOrInvite` middleware
   - `roleToGrant()` omits `canPublishSources` (safe)

2. **`routes/roomGuestAccess.ts`** — Mounted at `POST /api/rooms/:roomId/token`
   - Used by the **guest/invite flow** and **Room page** join
   - Uses custom auth (guest session + invite token + Firebase)
   - `roleGrant()` had the `canPublishSources` bug (now fixed)

Both catch-all to `"Failed to create room token"` — check server logs for the actual error.

### Token Types in Play

| Token | Signed By | Contains | Used For |
|-------|-----------|----------|----------|
| **LiveKit JWT** | `LIVEKIT_API_SECRET` | room, identity, publish/subscribe grants | Connecting to LiveKit server |
| **Room Access Token** | `ROOM_ACCESS_TOKEN_SECRET` | roomId, role, permissions, identity | App-level permission checks (layout, recording, etc.) |
| **Guest Session JWT** | `JWT_SECRET` | guestId, inviteId, roomId, role | Persisting guest identity across refreshes |
| **Invite Token** | `INVITE_TOKEN_SECRET` | roomId, role, inviteId | Authorizing invite-based joins |
| **Firebase ID Token** | Firebase | uid | Primary user authentication |

---

## Debugging Checklist

When you see `"Failed to create room token"`:

1. **Check Render logs** — the actual error is always logged before the 500 response
2. **Set `AUTH_DEBUG=1`** — includes error message in the JSON response
3. **Check env vars** — `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` must all be set
4. **Check SDK version** — `livekit-server-sdk` v2.x uses protobuf enums, not strings
5. **Check room doc** — does the room exist in Firestore? Is `livekitRoomName` set?
6. **Check capacity** — 503 means capacity lock contention, usually transient
7. **Check identity** — if uid + invite identity are both empty, you get `invalid_identity`
