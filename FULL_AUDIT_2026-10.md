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

## Open — needs a decision or larger change

### Do now (ops)
- **Rotate credentials.** Git history contains `.env` files (commit `40a7f994`) and a Firebase service-account private key (before `f4f67702`). They include LiveKit, Stripe, R2, JWT, stream-key and internal tokens. Rotate everything, then purge history with `git filter-repo`.
- **Set `NODE_ENV=production` on the prod Render service.** It is not in `streamline-server/render.yaml`. Without it, every "no dev-secret in production" guard is skipped.
- **Untrack `node_modules`.** About 24k files are committed, and the server copy is stale (it is missing helmet, pino and ws). Run `git rm -r --cached node_modules streamline-server/node_modules`.
- **`npm audit fix`.** There are 3 critical issues (fast-xml-parser pinned at 5.3.3 via `overrides`, protobufjs, websocket-driver) and 6 high. Upgrade multer to 2.x.

### Security / correctness
- **Admin password reset is an account-takeover window (High).** When an admin enables reset, anyone can call `/forgot-password/reset` with `method:"admin"` for that login within 24h. Require a single-use secret delivered out of band. `/forgot-password/check` also advertises the window.
- **Live usage minutes are client-reported (Critical for billing).** `/api/usage/streamEnded` trusts `minutes` from the body. Compute them server-side from LiveKit room or egress timestamps.
- **Stripe event idempotency and ordering for subscriptions.** Store `event.id`, and re-fetch the subscription instead of trusting payload order. A late `updated` after `deleted` can resurrect a plan.
- **API version drift (`2025-12-15.clover`).** `current_period_end` moved to items, and `invoice.subscription` moved to `invoice.parent.subscription_details`. `invoice.payment_failed` and the `invoice.paid` usage reset may never fire.
- **First `invoice.payment_failed` downgrades to free** while Stripe is still retrying.
- **PPV raw codes live in an in-memory Map.** They are lost on restart or a second instance. Persist them encrypted with a TTL.
- **PPV playlist URLs are static public R2 URLs.** Once leaked they are shareable. Move to signed, short-lived URLs.
- **SSRF in the export worker.** Timeline `clips[].videoUrl` is fetched server-side with no host allowlist, timeout or size cap.
- **Multistream leaks egress.** A partial failure, or calling start twice, leaves an untracked egress running. HLS start has the same race.
- **No rate limiting on login, signup or forgot-password.** The recovery-code lockout is also racy (not transactional).
- **Any logged-in user gets a publish token for any non-private room** (`visibility` defaults to `unlisted`). Direct guest join defaults to `allowGuests: true`. Decide the product default.
- **Usage counters use read-modify-write without transactions** (`index.ts` streamEnded, `usageHelper` floor clamp). Use `FieldValue.increment`.
- **Project asset uploads bypass the storage quota** and never delete their R2 objects.
- **24h retention purge can stall** once 200+ old non-purgeable docs exist (no status filter or pagination).
- **500 MB `multer.memoryStorage()` uploads on a 512 MB instance** risk running out of memory. Stream to disk or R2, or use presigned uploads.
- **Admin hard-delete** doesn't lock the user out: `/me` recreates the doc.
- **Stream keys** are stored in plaintext on `activeStreams` docs.

### Build / CI
- `firebaseAdmin.ts` initializes at import time. It breaks `lib/roomGuestAccessInvite.test.ts` and scripts, and it ignores `GOOGLE_APPLICATION_CREDENTIALS`.
- CI doesn't build or test server or client before Render auto-deploys.
- Client: `tsconfig.json` sets `"ignoreDeprecations": "6.0"`, which TS 5.9 rejects, so `tsc` stops on a config error. With that removed there are 8 pre-existing type errors, mostly react-joyride v3 types. ESLint fails because `@eslint/js` is missing from devDependencies.
- `Room.tsx` has 2 raw `fetch` calls that bypass `apiFetch`.
