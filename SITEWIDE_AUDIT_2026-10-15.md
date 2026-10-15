# Sitewide Audit — 2026-10-15

Branch: `creator`, head `5fbf4806`.

**Method**
- Build, test, lint and dependency vitals were run directly.
- Five read-only investigations were run in parallel: security, golden path, persistence, fake/dead features, and production readiness.
- Every finding rated P0 or P1, and the key P2s, were re-verified against the code before inclusion.
- No code was changed by this audit.

**Previous audits:** `FULL_AUDIT_2026-10.md`, `STORAGE_QUOTA_AUDIT.md` and `PRE_LAUNCH_AUDIT.md`. Items they list as fixed are not repeated here unless they regressed; none had regressed.

## 1. Executive health

| Area | Score | Why |
|---|---|---|
| Vitals | 85% | Builds, typecheck and 1,067 tests are green, and CI runs them. Remaining: lint debt, one critical dependency advisory (low real risk), no E2E tests. |
| Persistence | 60% | Account purge leaves most user data. A quota double-release race. Lost-update races. Missing indexes. |
| Core workflow | 55% | LiveKit room-name collision. Recording webhook never finalizes. A host reload loses control of live egress. |
| Security | 55% | Two P0s (room takeover, channel hijack) and a pay-per-view bypass through the RTC room. |
| UX | 70% | Gated pages bounce on refresh. Several pages show false empty or zero states on errors. One fake option (dual recording). |
| Production readiness | 60% | Client falls back to the test backend. Blueprint env names don't match the code. No startup config validation. No error tracking or backups. |
| **Overall** | **~62%** | |

**Vitals (measured)**

| Check | Result |
|---|---|
| Server build / tests | Pass, 752/752 |
| Client typecheck / build | Pass |
| Client tests | 315/315 |
| Client ESLint | 785 errors, 31 warnings (down from 936). Mostly `no-explicit-any` (547). Not in CI. |
| Server lint | No lint script exists |
| `npm audit`, server | 1 critical (`proxy-addr` IPv4-mapped IPv6 trust-subnet spoofing), 8 moderate. The app uses `trust proxy = 1` (hop count), so real risk is low; a semver-compatible fix is available. |
| `npm audit`, client | 4 high, 10 moderate (`firebase` / `@grpc`, needs a major upgrade; already known) |
| `npm audit`, root | 8 moderate |
| Client bundle | Single 2.7 MB JS chunk, no code splitting |
| E2E tests | None |

## 2. Golden path

Create room → host joins → invite guest → go live (destinations/HLS) → record → recording in library → edit → export.

| Workflow | Verdict |
|---|---|
| Create room → join → layout | **Broken across tenants.** Two hosts with the same room name share one LiveKit room (P0-1). Works for one host. |
| Invite / guest join | Works. Transactional redeem, room-bound invites, guest policy enforced. |
| Go live (multistream / HLS) | Works with caveats. Starts are idempotent and roll back on failure. A host reload loses the ability to stop (P1-3). A new channel's viewer page never starts (P2). |
| Recording → library → editor → export | **Broken.** The LiveKit webhook never marks recordings ready or failed (P1-2). No double-start guard (P1-4). Export and save-to-library are sound. |
| Stream end / billing | Works with caveats. Billing is server-side. "End" depends on client state, so a reload can leave egress running until a cap or until the room empties. |

## 3. P0 findings

| # | Issue | Evidence | User impact | Recommended fix |
|---|---|---|---|---|
| P0-1 | **LiveKit room names are user-chosen and not unique: cross-tenant room merge and takeover** | `routes/roomsCreate.ts:59-60,107` (`livekitRoomName = rawName \|\| roomId`). The client sends the typed label (`Join.tsx:646`). Tokens grant by name (`roomGuestAccess.ts:716,1208,1592`). Egress, metadata and remove-all all key on the name. | Two hosts naming a room "Morning Show" share one LiveKit room: guests, recordings, multistream and layout all cross over. An attacker who learns or guesses a live room's name creates a room with the same name and gets `roomAdmin` in the victim's room. | Server sets `livekitRoomName = roomId` for every new room (and in `savedEmbeds.ts` `buildFriendlyLivekitRoomName`). The label stays display-only (`displayName` already exists). Existing rooms keep their names. A one-off check for existing duplicates is advisable. |
| P0-2 | **Another user's public channel can be hijacked via `savedEmbedId`** | `roomsCreate.ts:65-66` accepts any `savedEmbedId` with no owner check. `hls.ts:248-255` writes `savedEmbeds/{id}.activeRoomId` unconditionally on HLS start. `/api/saved-embeds/public/:id` and channel playback trust `activeRoomId`. | Any HLS-plan user who copies a channel id from a `/live/<id>` URL can make that channel play their own stream with their branding. | Reject `savedEmbedId` unless the embed's `ownerId` equals the room owner (create route and `ensureRoomDoc`). In `hls.ts`, write `activeRoomId` only when the owners match. |

## 4. P1 findings

| # | Issue | Evidence | User impact | Recommended fix |
|---|---|---|---|---|
| P1-1 | Pay-per-view bypass through the RTC room | `roomGuestAccess.ts:1550` (`decideDirectGuestJoin`) and the viewer branch of `/token` check only `rooms.access`. `viewerAccess` is not referenced in that file. The room id is exposed by `/api/monetization/events/:id` and `/api/saved-embeds/public/:id`. | If the owner sells pay-per-view on the channel and the production room is link or public, a non-payer joins the room as a viewer for free. | Refuse viewer-only joins (join-guest and the anonymous `/token` branch) when the room's viewer access isn't `public`, unless the caller is entitled or host-like. |
| P1-2 | LiveKit webhook never finalizes recordings | `webhook.ts:1182` `String(egressInfo.status)` gives `"3"` (the SDK parses the enum as a number; verified with the installed `livekit-server-sdk`). The checks at `:1196` / `:1212` compare against `"EGRESS_COMPLETE"` / `"EGRESS_FAILED"`, so everything falls into `"processing"`. | Recordings become ready only through the one-shot 4-second in-process head-check after Stop. Long uploads, tab-close endings, room-close endings and server restarts leave recordings stuck "processing" forever: never in the library, storage never counted. The webhook can also downgrade a just-readied recording. | Map numeric statuses (3 complete, 4 failed, 5 aborted, 6 limit reached). Use a transaction that never downgrades `ready`. Add a sweep that re-checks stuck `processing` recordings. |
| P1-3 | A host reload loses live/recording state, so egress can't be stopped from the UI | `Room.tsx` sets `streamEgressRef` and `recordingRef` only when starting (`~4194`, `~4478`) and never re-reads server state on mount. Stop returns early without an egress id (`~4526`). | Refresh or crash while live: the UI shows idle, "Go Live" gets a 409 alert, and Stop is impossible. Streams and recordings keep running and billing until a cap. | On mount, read multistream, HLS and recording status and hydrate the refs. Adopt the egress id from a 409. Allow server-side stop by `roomId`. |
| P1-4 | No guard against a second concurrent recording | `recordings.ts` start writes `activeRecordings/{uid}_{roomId}` but never reads it. | Two producer tabs, host plus cohost, or the reload case above each start an egress: double minutes and storage, plus an orphan only one tab can stop. | Transactional "one active recording per room" check; return 409 with the existing `recordingId`. |
| P1-5 | Account purge leaves most user data | `lib/jobs/accountPurge.ts` cleans only recordings, saved_videos, three user subcollections, `accounts` and `billingAudit`. Not removed: `users/{uid}/destinations` (encrypted third-party stream keys), `editing_assets` and `uploads/{uid}/` in R2, project assets and `projects/{uid}/` in R2, rooms and chat, savedEmbeds, brandKits, audioDecks, collaborator relationships, invites, monetization events. No `deleteUser` on the Firebase Auth user. | The UI promises "permanently removes your content after 7 days" (`SettingsBilling.tsx:3664`, `DeleteAccountDialog.tsx:176`). Stream keys and media persist indefinitely, which is a privacy/GDPR exposure and an ongoing R2 cost. | Purge steps per collection, `deletePrefix` for the user's R2 prefixes, and Firebase Auth `deleteUser`. |
| P1-6 | Gated pages redirect away on refresh before access has loaded | `App.tsx:24-38` derives `canProjects` / `canContentLibrary` / `canMonetization` from entitlements that start as `null` and ignores `loading` (`hooks/useEffectiveEntitlements.ts:15`). `routes.tsx:113-116` and others then `<Navigate replace>`. | Refreshing or deep-linking `/projects`, `/content` or `/settings/monetization` bounces to `/join`. The only link to Monetization is a full-page `<a href>` (`RoomMonetizationSetup.tsx:293`), so it always bounces. | Render a loader until entitlements and flags have loaded; redirect only after. |
| P1-7 | Production client falls back to the **test backend** when `VITE_API_BASE` is unset | `client/src/lib/apiBase.ts:5` falls back to `https://streamline-backend2test.onrender.com`. `services/apiBase.ts` falls back to `localhost:5137`. About 12 files fall back to `""`. | A build without the variable sends production users to the test database and Stripe test mode (or breaks signup and admin). | One API-base module that fails the production build when the variable is missing. |
| P1-8 | Missing composite index (repo file) for pay-per-view host events | `lib/monetization.ts:205` (`ownerUid ==` + `orderBy createdAt desc`). Not in `firestore.indexes.json`. | `GET /api/monetization/events` fails with FAILED_PRECONDITION unless the index was created by hand in the console. **Verify in the Firebase console.** | Add it to `firestore.indexes.json` and deploy. Full missing-index list in §5. |

## 5. P2–P4 findings

### P2: major function degraded

**Security**
- `GET /api/rooms/resolve` returns the whole `rooms.hls` object, including a protected run's `playlistUrl` / `prefix`, to any room-token holder (`roomsResolve.ts:60,68`). Return `{status}` only.
- Logout doesn't clear the `SameSite=None; Secure` session cookie (`auth.ts:577` clears without those options), so the cookie keeps authenticating for up to 7 days on a shared computer.
- When platform billing is off, any user can grant themselves any plan through `POST /api/billing/test/change-plan` (`billing.ts:975`), and the plan sticks after billing is turned back on.

**Workflow**
- A cohost's recording is billed to the owner but listed and deletable only by the cohost (`mediaAssets.ts:35`, `recordings.ts:~1450`).
- A `/live/:id` page opened before a new channel's first HLS start never plays: `activeRoomId` is null, there's no fallback to the home room, and the refresh doesn't switch rooms (`Live.tsx:223-225`).
- A failed "Stop stream" still resets the UI to idle and drops the egress id (`Room.tsx` `handleStopMultistream` `finally`), so the stop can't be retried.

**Persistence**
- Quota double-release on concurrent deletes (`routes/editing.ts:416-459`, `lib/savedVideos.ts:17-38`: get → release → delete with no transaction). Repeating it bypasses the storage limit.
- "Delete project" only archives (`projectManager.ts:170`). Its uploads keep their quota and become unreachable (STORAGE_QUOTA_AUDIT B8, now worse because project uploads reserve quota).
- Lost updates on program state and room metadata:
  - The Firestore program-state PATCH isn't transactional (`roomsProgramState.ts:171-185`).
  - LiveKit metadata is merged read-modify-write in two places (`roomsProgramState.ts:47-56`, `services/programOverlay.ts`). A layout change during an overlay sync can drop the branding overlay until the next sync.
- Signup check-then-create race creates duplicate accounts (`auth.ts:521-546`).
- A deleted owner's rooms, invites and collaborator grants keep working: no `deletedAtMs` checks outside `requireAuth`.
- Missing composite indexes in `firestore.indexes.json` (verify in the console):

  | Collection | Fields | Code | Effect |
  |---|---|---|---|
  | `rooms` | status + updatedAt desc | `horizon/botApi.ts:239` | 500 |
  | `recordings` | roomId + userId + startedAt desc | `roomsRecordings.ts:113` | Caught; latest-recording fallback lost |
  | `projects` | ownerId + status + updatedAt desc | `projectManager.ts:136` | Unbounded fallback read |
  | `project_assets` | projectId + createdAt desc | `projectManager.ts:229` | Unbounded fallback read |
  | collection group `emergencyRecording` | `expiresAt` | `mediaPurge.ts:49` | Hourly expiry job fails |
  | collection groups `joinPagePresence`, `hlsViewers` | `lastSeenAtMs` | `ephemeralCleanup.ts:107` | Falls back to a scan |

**Fake features and false states**
- "Redundant Recording (Cloud + Backup)" (dual mode) produces one file (`recordings.ts:1005-1041`).
- Media Defaults `maxTiles` / `followSpeaker` / `pinnedIdentity` are saved but read nowhere (`roomLayout.ts:96-120` uses `.mode` only).
- The Usage tab shows 0 used / unlimited when its API fails (`SettingsBilling.tsx:934-936`).
- The content library and projects show empty lists on API errors; a thrown 401 leaves an infinite spinner (`editingApi.ts:216-224`, `AssetLibrary.tsx:27-36`, `ProjectsDashboard.tsx:40-42`). A 500 looks like "your recordings are gone".
- Settings errors show "HTTP 409" instead of the server's reason, because `apiFetchAuth` throws before the `!res.ok` branches run. Affects overages, the billing portal and collaborators.
- The Join page links to `/settings/billing?tab=destinations`, but Settings reads `openTab` (`Join.tsx:1723`, `SettingsBilling.tsx:398`). `branding` is missing from `validTabs`.

**Production**
- Both `render.yaml` files declare R2 variable names the code doesn't read (`R2_BUCKET_NAME`, `R2_*_ACCESS_KEY_ID`; the code reads `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). A service rebuilt from the blueprint has no storage, and nothing warns at startup. (The current production service presumably has the correct names set by hand.)
- Stripe price variables (`STRIPE_PRICE_STARTER/PRO/BASIC`) are documented nowhere, so a fresh environment returns 500 at checkout.
- No startup config validation: a misconfigured deploy passes the health check (`index.ts:971-998`).
- Pay-per-view checkout redirects to `localhost:5173` when `CLIENT_URL` is unset (`monetization.ts:48-49`).
- No error tracking (no Sentry or similar). 668 `console.*` calls bypass pino, so those lines have no request id or redaction.
- No backup or rollback step before the runbook's `--apply` migrations. `scripts/migrateAddHlsToPlans.ts` has no dry-run.
- The drift-check and hooks workflows don't run on `creator` / `test`. The drift check currently fails locally with 48 banned literals. Lint is not in CI.

### P3: UX / polish
- Account enumeration through collaborator invite (`collaborators.ts:103`).
- Chat sender name can be spoofed by guests (`roomChat.ts:315`).
- Horizon voice-stream trusts `x-user-id` / `x-username` headers.
- Uploads accept any `image/*`, including SVG, served from the R2 public URL; use an allowlist.
- Branding image URLs allow `http://` and private hosts. The egress browser fetches them, which is a blind SSRF if egress is self-hosted.
- A failed recording shows "processing" for 6 minutes (the client poll ignores `status: failed`).
- Duplicate `saved_videos` rows per recording (check-then-`add()` from both the webhook and the head-check); becomes reachable once P1-2 is fixed.
- Dangling My Content rows after the 24h recording purge.
- An editing-asset delete drops the doc even when the R2 delete fails, leaving untracked R2 objects.
- The editor says "disabled platform-wide" for plan-gated users.
- Help page has placeholder video slots.
- LearnMore lists shipped features as "Planned".
- Save messages still say viewer pages update "on their next load" (they now refresh within a minute).
- Generic error boundary text ("live room UI hit an unexpected error") on every page.
- About 55 `console.log` calls with participant identities in production.
- Health check is shallow and `healthCheckPath` isn't set.
- No security headers on the static frontend except `/live`.
- `SUPPORT_TICKET_HASH_SALT` has a hard-coded default.
- The runbook names `LIVE_MINUTES_CUTOVER_ISO` and `ROOM_TOKEN_STRICT_AUTHED_PUBLISH`, which don't exist; the real variable is `STREAMING_METER_CUTOVER_ISO`.

### P4: technical debt
- **API helpers:** 12 `API_BASE` definitions with 3 different fallbacks; 6+ fetch helper variants.
- **Duplicate implementations:**
  - two HLS players (`Live.tsx` inline, `pages/HlsPlayes.tsx`);
  - two paywall viewers (`Live.tsx`, `PpvViewer.tsx`);
  - two invisible-host token paths.
- **Orphaned routes:** `/checkout`, `/settings/destinations`, `/my-content`, and several legacy aliases.
- **Unused server endpoints:** `/api/my-content*`, `/rooms/:id/token/invisible`, `/api/plans/:id`.
- **Oversized files:** `SettingsBilling.tsx` (4,062 lines) and `Room.tsx` (6,263 lines). The HLS tab is always mounted.
- **Dependencies:**
  - Client depends on `@livekit/components-*` at `"latest"`.
  - Server `livekit-server-sdk` 2.6.1 vs client ^2.14.
  - Client lists unused server-only dependencies, and its `server` script points to a missing directory.
- A tracked legacy token server, `streamline-client/dist-node/server.js`, mints LiveKit tokens with no auth. It isn't deployed; delete it.
- Ownership checks fail open when the owner field is missing (`recordings.ts` GET/DELETE/download-link, `savedEmbeds.ts:394`).
- JWTs aren't typed: room-access, invite and guest tokens share a secret and have no `typ`/`aud`.
- Production CORS still allows localhost origins.
- Rate limits are in memory (per instance). Production runs on the Render **free** plan in the stale blueprint: the instance sleeps, so in-process jobs drop.
- Rooms, savedEmbeds and invites have no delete path. The brand-kit limit is count-then-set. SavedEmbed create isn't atomic.

## 6. Persistence matrix (static trace)

| Feature | Create | Reload | Update | Delete | Restart / other device | Result |
|---|---|---|---|---|---|---|
| Rooms | Firestore | ✔ | ✔ (rename, kit, graphics) | ✘ no delete path | ✔ | Name collision (P0-1) |
| Saved channels | ✔ | ✔ | ✔ | archive only | ✔ | Hijackable (P0-2) |
| Recordings | ✔ | ✔ | — | ✔ (quota race) | **stuck "processing"** without the head-check | P1-2 |
| Uploads (library) | ✔ quota reserved | ✔ | — | ✔ (double-release race) | ✔ | P2 |
| Projects | ✔ | ✔ | ✔ | **archive only, quota stranded** | ✔ | P2 |
| Brand kits / graphics / audio deck | ✔ | ✔ | ✔ (graphics revision-checked) | ✔ | ✔ | OK |
| Program layout | ✔ | ✔ | lost-update race | — | ✔ | P2 |
| Account | ✔ | ✔ | ✔ | **purge incomplete** | — | P1-5 |
| Export settings, capture preset, screen-share mode | localStorage only | ✔ same device | ✔ | — | ✘ other devices | P4 |

## 7. Fake / incomplete features
1. Dual "Cloud + Backup" recording: one file only.
2. Media Defaults layout options (`maxTiles`, `followSpeaker`, pinned participant): saved but read nowhere.
3. Account deletion: "permanently removes your content" is not true (P1-5).
4. "Delete this project and all its recordings": archives only.
5. Usage and content-library pages show zero or empty values on API errors.
6. Help page video placeholders.
7. LearnMore "Planned" lists shipped features.

Intentional and honestly labeled: "Subscriber" access and "Payouts coming soon".

## 8. Architecture risks
1. **Identity confusion.** `roomName`, `livekitRoomName`, `displayName` and `roomId` overlap, and user input flows into LiveKit identity (P0-1). LiveKit should be keyed only by server-generated ids.
2. **Client-held operational state.** Egress ids live only in the tab (P1-3). The server should be authoritative for "what is running in this room" and expose stop-by-room.
3. **Read-modify-write without transactions or versions** on shared documents (program state, LiveKit metadata, quota counters on delete, signup).
4. **Lifecycle gaps.** There are no delete or purge paths for rooms, channels, invites or uploads on account deletion, so data accumulates and privacy promises aren't met.
5. **Configuration drift.** Several API-base copies, blueprint env names that don't match the code, undocumented required variables, no startup validation.
6. **Errors become empty states.** Several client helpers turn failures into `[]` / zeros, which hides outages as "no data".

## 9. Tests added or needed
- **Regression tests (with each fix):**
  - The server never uses a client label as `livekitRoomName`.
  - A room can't bind another owner's `savedEmbedId`, and HLS start doesn't rewrite a foreign channel.
  - Webhook status mapping with numeric enum values, plus the never-downgrade-`ready` rule.
  - Direct guest join is refused when the channel isn't public.
  - Recording start returns 409 while one is active.
  - Purge covers every user collection and R2 prefix.
  - Concurrent deletes release quota once.
  - Gated routes don't redirect while entitlements are loading.
  - The production build fails without `VITE_API_BASE`.
- **Integration:**
  - The firestore emulator for transactional paths (quota, signup, program state).
  - The LiveKit webhook with SDK-parsed events.
- **E2E (none today):** sign in → create room → go live → record → stop → recording ready in library. Add a Playwright smoke run against a staging stack.
- **CI:**
  - Run the drift check and hooks check on `creator`.
  - Add lint with a baseline, so new errors fail while existing ones are tolerated.
  - Add `npm audit --omit=dev --audit-level=critical`.

## 10. Recommended execution order

### Stage 1: Foundation (security, data integrity)
1. **P0-1:** server-generated LiveKit room names, plus a check for existing duplicate names.
2. **P0-2:** owner check on `savedEmbedId` (create and HLS start).
3. **P1-1:** pay-per-view enforcement on RTC viewer joins.
4. **P1-2 and P1-4:** fix the webhook status mapping and add a recording single-flight guard and a stuck-recording sweep.
5. **P1-5:** complete account purge (stream keys first).
6. **P2:** quota double-release transaction; logout cookie clearing; `/rooms/resolve` leak; test-plan switch gating.
7. **P1-8:** commit missing indexes and verify them in the console.

### Stage 2: Core workflow
8. **P1-3:** hydrate live/recording state on reload; server stop-by-room; don't reset to idle on a failed stop.
9. First-time channel viewer fallback; cohost recording ownership; failed-recording poll; deterministic `saved_videos` ids.
10. Program-state transaction, and metadata rebuilt server-side under a version.

### Stage 3: Features and truthfulness
11. **P1-6:** entitlement-loading gate for routes.
12. Error states instead of fake zeros or empty lists (Usage, library, projects). Settings error messages and deep-link fix.
13. Decide on dual recording and the layout defaults: implement them or remove the controls. Project delete really deletes and releases quota.

### Stage 4: Polish
14. P3 copy and UX items, the error boundary text, removing identity logs, the upload MIME allowlist, `https`-only branding URLs.

### Stage 5: Scale and operations
15. **P1-7:** a single API base that fails the build when the variable is missing.
16. Fix the `render.yaml` env names and document the Stripe price variables.
17. Startup `validateEnv()`, a real `healthCheckPath`, Sentry, Firestore PITR and backups, and a rollback runbook.
18. CI: drift check on `creator`, lint baseline, audit gate. Fix the 48 drift literals.
19. Shared rate-limit store; take production off the free plan; code-split the client bundle; dependency majors (firebase 12, firebase-admin 14).
