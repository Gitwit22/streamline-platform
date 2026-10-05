# Deploy Runbook — October 2026 stages (1–7)

Everything below is required or recommended before/after deploying `creator` with the entitlement,
billing, jobs, admin, viewer-access, cleanup and content-consolidation stages.

## 1. Render service settings (backend `streamline-backend2`, root dir `streamline-server`)

- Build: `npm ci --include=dev && npm run build`
- Start: `npm start`
- Cron service: `npm run cron:run-jobs` (posts to `/api/maintenance/jobs/run-due`; retries while the web service wakes)

## 2. Environment variables

**Required**

| Var | Why |
|-----|-----|
| `NODE_ENV=production` | Enables prod-only secret guards and fail-closed errors |
| `JWT_SECRET`, `ROOM_ACCESS_TOKEN_SECRET` | Sessions / room tokens |
| `STREAM_KEY_SECRET_V1` | base64 32-byte key; encrypts stream keys and pending PPV codes |
| `MONETIZATION_CODE_SALT` | PPV access-code hashing |
| `HLS_PLAYBACK_SECRET` | 32+ chars; signs protected HLS playback tokens (non-public channels return 503 without it) |
| `HORIZON_WEBHOOK_SECRET` | Horizon endpoints fail closed without it |
| `MAINTENANCE_KEY` | Cron → maintenance/jobs endpoints (web + cron services) |
| `EGRESS_TEMPLATE_BASE_URL` | Backend public URL, e.g. `https://streamline-backend2.onrender.com` (falls back to `RENDER_EXTERNAL_URL`) |
| `STREAMING_METER_CUTOVER_ISO` | Set to the deploy time to avoid re-billing pre-deploy streams |

**Cron service:** `MAINTENANCE_KEY`, `MAINTENANCE_JOBS_URL` (or `MAINTENANCE_BASE_URL`).

**Optional (defaults are sensible)**

`HLS_PROXY_ALL`, `HLS_PLAYBACK_TOKEN_TTL_SEC` (1800), `HLS_SEGMENT_URL_TTL_SEC` (600), `PLATFORM_FEE_BPS` (1000),
`JOBS_ENABLED`, `JOBS_TICK_MS`, `JOB_<NAME>_MS`, `STREAMING_METER_SWEEP_MS`, `EXPORT_RETENTION_DAYS` (30),
`TEMP_UPLOAD_MAX_AGE_MS`, `TEMP_EXPORT_DIR_MAX_AGE_MS`, `JOB_HISTORY_RETENTION_DAYS`, `STRIPE_EVENT_RETENTION_DAYS`,
`TELEMETRY_RETENTION_DAYS` (30), `TELEMETRY_DISABLED`, `EXPORT_SOURCE_ALLOWED_HOSTS`, `INVITE_TOKEN_SECRET`,
`GUEST_SESSION_SECRET`.

## 3. External configuration

1. **Rotate credentials** that were committed in git history (Firebase SA, LiveKit, Stripe, R2, JWT, stream-key secret, internal tokens).
2. **Firestore indexes:** deploy `firestore.indexes.json` (e.g. `firebase deploy --only firestore:indexes` from a configured project). Includes `editing_exports (status, priority, createdAt)` for priority rendering; without it exports still run first-in-first-out.
3. **R2:**
   - CORS rule allowing `GET` from the client origin(s) on the S3 endpoint (`<account>.r2.cloudflarestorage.com`) — needed for presigned HLS segments.
   - Bucket must not be publicly listable. For a fully private bucket set `HLS_PROXY_ALL=1`.
4. **Stripe webhook events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.
5. **LiveKit webhook** must be configured (room/participant/egress events drive viewer stats, stream summaries and backup billing).
6. **Render host ffmpeg ≥ 4.4** for export audio mixing (`amix normalize=0`).

## 4. Data migrations (run after deploy; dry-run first)

```
cd streamline-server
npm run plans:migrate-v2            # dry run; add -- --apply (and --users) to write
npm run content:migrate             # dry run; add -- --apply to write
```

- Legacy plan docs keep their meaning until migrated (0 = unlimited only for legacy docs; v2 uses null = unlimited, 0 = none).
- Content reads fall back to legacy collections until migrated; nothing is deleted.
- Legacy `bonusMinutes` convert to one-time credits automatically on first use.

## 5. Post-deploy smoke checks

- Admin → System Jobs: all jobs show a recent successful run.
- Admin → Operations: service health green.
- Invite-only room: invite link works; bare link is refused.
- Multistream + HLS test: minutes counted once (Settings → Usage).
- Twitch destination shows "Adjusted to 1080p60 for Twitch".
- Instagram portrait test broadcast looks right.
- PPV channel: unpaid viewer gets checkout; after payment, playback starts; refund revokes access.
- Editor: export with music + muted clip has correct audio; "Save to library" adds it to Content.
