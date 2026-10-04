# Full Platform Audit — October 2026

Scope: `streamline-server` (auth, billing/webhooks/PPV, media/HLS/recordings), `streamline-client`, build/deploy/config.
Every finding below was confirmed against the code on branch `creator`.

## Fixed in this pass

| # | Severity | Area | Fix |
|---|----------|------|-----|
| 1 | Critical | PPV paywall bypass | `/api/public/hls/:roomId` and `/api/hls/public/:roomId` no longer return `playlistUrl` for rooms with an active fixed/PWYW event (they fail closed on lookup errors). `POST /api/monetization/enter` returns `playlistUrl` only when access is granted. `PpvViewer` polls `/enter` only after access is granted. |
| 2 | High | Logout | `logout()` now calls Firebase `signOut` and clears `meCache`. Previously the persisted Firebase user kept authenticating API calls after logout. The Join page button now uses `logout()`. |
| 3 | High | `apiFetchAuth` | A 403/500 on the post-refresh retry was swallowed and turned into a forced logout. It now surfaces as a normal HTTP error. |
| 4 | High | Live viewer | The `<video>` element is tracked by a callback ref, so playback re-attaches after error→live transitions instead of staying black. Retry/watchdog timers are cleared on teardown. |
| 5 | High | `useHlsReadiness` | Probes with CORS first, so a 404 is visible. It falls back to an opaque probe only when CORS blocks (Safari native HLS). Readiness resets when the URL changes. |
| 6 | Medium | PpvViewer | The player and donation box are plain elements instead of inner components, so HLS no longer reloads and the input no longer loses focus on every keystroke. Async state updates have cancellation guards. |
| 7 | High | Stripe webhook (PPV) | The purchase doc id is the checkout session id, and the access code id is the purchase id, both written with `create()`. Redelivery no longer mints extra codes. Unpaid (async) sessions are skipped. Errors return 500 so Stripe retries. |
| 8 | High | Plan downgrades | The plan is derived from the current Stripe price before `metadata.plan`, in both the webhook and `/billing/refresh`. Scheduled downgrades now take effect. |
| 9 | High | Guest direct join | `POST /rooms/:roomId/join-guest` now rejects private rooms, `requiresPayment` rooms, and rooms with an explicit `requiresAuth: true`. |
| 10 | Medium | LiveKit grants | `canPublishSources` (protobuf enum) is now sent, so guests and participants can't screen-share at the SFU level. |
| 11 | Medium | Admin auth | `requireAdmin` honors `authRevokedAtMs` and `deletedAtMs` like `requireAuth`. |
| 12 | Medium | Password reset | Sets `authRevokedAtMs` and revokes Firebase refresh tokens, so pre-reset sessions die. |
| 13 | Medium | CSRF | For state-changing requests from an untrusted browser `Origin`, cookies are stripped before parsing, so the `SameSite=None` session cookie can't be ridden. |
| 14 | Medium | Logs | `?t=` / `?gst=` / `?token=` query tokens are redacted from pino request logs. |
| 15 | Medium | Error handler | Fails closed: messages and stacks are exposed only when `NODE_ENV` is `development` or `test`. Previously an unset `NODE_ENV` leaked them. |
| 16 | Low | Secrets | Guest-session and invite secrets throw in production or staging instead of falling back to `dev-secret`. The unused `JWT_SECRET` fallback in `index.ts` is removed. |
| 17 | Medium | Horizon | `verifyHorizonSecret` fails closed when `HORIZON_WEBHOOK_SECRET` is unset. The opt-out is `HORIZON_ALLOW_UNAUTHENTICATED=1` or a dev/test env. Bot `/events` HMAC now uses the raw body captured by `express.json({verify})`; before this, it could never succeed. |
| 18 | Medium | Kill switches | HLS `/stop` is never entitlement-gated. `/status` is gated only when nothing is running. `/api/recordings/stop` is no longer behind the recordings kill switch. |
| 19 | Medium | Recording stop | Usage, lock, storage and saved-video records use the recording owner (`data.userId`), not the caller (for example a cohost). |
| 20 | Medium | Storage quota | Deleting an editing asset no longer releases storage for a recording that was already released or soft-deleted (this was a double-decrement quota bypass). |
| 21 | Medium | Editing API | Owners can no longer set arbitrary recording `status` (which could dodge retention). Only `failed` is accepted. |
| 22 | Low | Sweep | `POST /api/recordings/sweep` requires `x-maintenance-key` or an admin. |
| 23 | High | Tests | The server `npm test` glob is fixed (`dist/**/*.test.js`). The old `dist/lib` argument ran 0 tests on Node ≥21. The suite is now 237/238; the remaining failure is noted below. |

## Fixed in the follow-up pass

All "open" items from the first pass were implemented except those listed under **Still open** below.

- **Billing:**
  - Stripe events are deduplicated (`stripeEvents/{event.id}`).
  - Subscription events re-fetch the live subscription, so out-of-order delivery is harmless.
  - Fields that moved in API version `2025-12-15.clover` are read from their new locations (`lib/stripeFields.ts`), and the version is pinned.
  - `invoice.payment_failed` downgrades only on `unpaid`/`canceled`/`incomplete_expired`.
  - PPV pending codes are stored AES-GCM encrypted in Firestore with a 10-minute expiry, and `async_payment_succeeded` is handled.
  - `MONETIZATION_CODE_SALT` is required in production.
- **Usage:** live minutes are computed server-side from `egressSessions`, billed once per session in one transaction, and charged to the room owner. Counters use `FieldValue.increment`, and the storage clamp is transactional.
- **Auth:**
  - Admin resets require a single-use code shown once to the admin.
  - Login, signup and forgot-password are rate-limited.
  - The recovery lockout is transactional.
  - Login timing and the forgot-password check no longer reveal which accounts exist.
  - Admin delete is a soft delete that disables the Firebase user, and `/me` no longer resurrects deleted users.
  - Invites are bound to their room.
  - Logged-in non-owners get publish rights only with an invite or guest session for the room, or when the room is public and allows guests. The client forwards `x-guest-session`, and `ROOM_TOKEN_STRICT_AUTHED_PUBLISH=0` disables this.
- **Media:**
  - Export sources are allowlisted, with download timeouts and size/redirect caps; ffmpeg has a timeout, stale jobs are reaped, and cancel is safe.
  - Multistream rolls back partial starts, refuses double starts, and no longer stores plaintext keys.
  - HLS start is transactional.
  - Project uploads reserve quota and asset deletes remove their R2 objects.
  - Uploads stream from disk instead of memory.
  - Both retention purges page correctly.
  - The stale-HLS purge uses a heartbeat and bills minutes.
  - `latest-recording` reuses the `/download-link` rules.
  - `storageCounted` flips transactionally.
- **Build:**
  - Firebase Admin initializes lazily (accepts `GOOGLE_APPLICATION_CREDENTIALS` and URL-safe base64), and the full server suite passes (314/314).
  - Dependencies were upgraded and lockfiles regenerated.
  - A CI workflow (`.github/workflows/ci.yml`) was added.
  - Render config sets `NODE_ENV=production` and uses `npm ci --include=dev`.
  - Client `tsc` is down to 0 errors (react-joyride v3 migration) and ESLint runs.
  - `/api/health/config` is admin-only.
  - Graceful shutdown stops the workers.
  - `node_modules` is untracked.
  - Stray scripts were removed or guarded.

## Deploy checklist

1. **Rotate every credential** exposed in git history (`40a7f994` `.env` files, Firebase service account before `f4f67702`): Firebase SA key, LiveKit, Stripe, R2, JWT, stream-key secret, internal tokens. Then purge history (`git filter-repo`) — needs a coordinated force-push.
2. **Production env vars:**
   - `NODE_ENV=production` (set it in the Render dashboard too if the service isn't blueprint-synced)
   - `STREAM_KEY_SECRET_V1` (base64 32 bytes, required for PPV code encryption)
   - `MONETIZATION_CODE_SALT`
   - `HORIZON_WEBHOOK_SECRET` (Horizon endpoints now fail closed)
   - `GUEST_SESSION_SECRET` / `INVITE_TOKEN_SECRET`, or rely on `JWT_SECRET`
3. **`LIVE_MINUTES_CUTOVER_ISO`:** set to the deploy time to avoid re-billing streams from the previous 24h that were billed from client figures.
4. **`EXPORT_SOURCE_ALLOWED_HOSTS`:** set this if clips are served from a host other than the configured R2/HLS bases.
5. **Ship client and server together:** `streamEnded` now requires `roomId`, and room tokens rely on the `x-guest-session` header.
6. **Admin resets:** existing admin-enabled resets are void and must be re-issued (they now produce a code).
7. **Firestore TTL policies (optional):** `monetizationPendingCodes.ttlAt`, and consider `stripeEvents`.

## Still open

- **Remaining `npm audit` findings need major upgrades.**
  - Server/root: 8 moderate, all from `uuid` via firebase-admin 13 (fixed in firebase-admin 14).
  - Client: 4 high and 10 moderate (`@grpc/grpc-js` needs firebase 12, `react-router` 7, `uuid`).
- **Client ESLint:** 936 pre-existing errors, mostly `no-explicit-any` and `no-unused-vars`.
- **Route params typing:** `@types/express-serve-static-core` is pinned to `~5.0.7` because 5.1 types route params as `string | string[]`. Narrow `req.params` in the route files, then drop the override.
- **Unbilled crashed streams:** live minutes are still unbilled if `streamEnded` is never called (tab crash). Billing from stop-multistream or `egress_ended` with `billLiveStreamMinutes` would close that.
- **Rate limits and the HLS heartbeat purge are per-instance / poll-driven.** Move limits to a shared store if you run multiple instances.
