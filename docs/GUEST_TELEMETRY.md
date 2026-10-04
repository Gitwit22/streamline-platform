# Telemetry

The console-only client events that used to live here (`viewer_join_success`,
`viewer_first_video_track_ms`, `legacy_roomname_join_attempt`) were removed in
Stage 6a: they were never stored. Product telemetry is now recorded
server-side, at the source of truth.

## Server-side events (`telemetryEvents`)

`streamline-server/lib/telemetry.ts` → `recordTelemetry(eventType, fields)`
(fire-and-forget, never throws, rate limited per event type + room/user and
per process). Documents:

```
telemetryEvents/{id}: { id, eventType, userId?, roomId?, broadcastId?, timestamp (ms), metadata }
```

`metadata` is sanitized (no secrets / stream keys / emails, RTMP URLs
redacted) and capped at 2 KB. Only the allowlist in
`lib/telemetryPure.ts` (`TELEMETRY_EVENT_TYPES`) is stored:

| Event | Emitted from |
|---|---|
| `broadcast.started` | `routes/multistream.ts` start (one per output egress) |
| `broadcast.ended` | `lib/streamSummary.ts` `recordEgressOutcome` (LiveKit `egress_ended`, RTMP outputs) |
| `destination.connected` | `routes/multistream.ts` start (one per destination) |
| `destination.failed` | multistream start failure; `egress_ended` stream results with status failed |
| `destination.reconnected` | allowlisted; no server-side reconnect path exists yet |
| `recording.started` | `routes/recordings.ts` start |
| `recording.failed` | recordings start failure; `egress_ended` webhook |
| `recording.completed` | `egress_ended` webhook; recordings stop head-check (when it claims the file) |
| `hls.started` | `routes/hls.ts` start |
| `hls.viewer_joined` / `hls.viewer_left` | `lib/viewerStats.ts` (first heartbeat per viewer per session / leave beacon) |
| `checkout.started` / `checkout.failed` | `routes/billing.ts` and `routes/monetization.ts` checkout |
| `checkout.completed` / `checkout.failed` | Stripe webhook (`checkout.session.completed`, `checkout.session.async_payment_failed`) |
| `entitlement.denied` | `entitlementDenialTelemetry` middleware (any `/api` response with a `LIMIT_ERRORS` code) |
| `job.failed` | `lib/jobs/framework.ts` (job run with status error) |

Retention: the `expired-sessions` job deletes `telemetryEvents` older than
`TELEMETRY_RETENTION_DAYS` (default 30). `TELEMETRY_DISABLED=true` stops writes.

## Guest join-page presence (not telemetry)

`POST /api/telemetry/guest { roomId, stage: "join_page" | "entered_room" | "left" }`
powers the host's "guest is on the join page" indicator
(`rooms/{roomId}/joinPagePresence`, read by `GET /api/invites/room-status`).
Client: `postGuestPresence` in `streamline-client/src/lib/telemetry.ts`.
