# StreamLine Monitoring Pipeline Audit Report

**Date**: 2026-04-01  
**Scope**: Full end-to-end audit of monitoring data collection, transformation, aggregation, and outbound delivery to Horizon and Support Hub.

---

## 1. Files Involved

### Horizon Integration (Outbound/Inbound)
| File | Role |
|------|------|
| `routes/horizon/roomHooks.ts` | Outbound chat-event and voice-stream webhook forwarding; inbound agent chat posting |
| `routes/horizon/botApi.ts` | Inbound bot events + pull-based support API (rooms, chat, status) |
| `routes/horizonApi.ts` | Admin heartbeat (`GET /api/horizon/status`) — **stub** |
| `routes/horizonWs.ts` | Admin WebSocket — **ping/pong only, no data streaming** |
| `lib/horizon/webhookForwarder.ts` | Resilient HTTP forwarder with retry, timeout, logging |
| `lib/horizon/webhookConfig.ts` | Env-var config for webhook URLs, secret, timeout, retries |
| `lib/horizon/hmacVerify.ts` | HMAC-SHA256 signing and constant-time verification |
| `lib/horizon/commandParser.ts` | Chat message Horizon command trigger detection |

### Admin / Monitoring Stubs
| File | Role |
|------|------|
| `routes/platformHealth.ts` | Returns `process.uptime()` + `process.memoryUsage()` — **stub** |
| `routes/diagnostics.ts` | Returns `process.version` + `NODE_ENV` — **stub** |
| `routes/alertRoutes.ts` | Returns `{ alerts: [] }` — **stub** |
| `routes/supportActions.ts` | Returns `{ actions: [] }` — **stub** |
| `routes/supportTickets.ts` | Returns `{ tickets: [] }` — **stub** |
| `routes/skillsIntegration.ts` | Returns `{ integrations: [] }` — **stub** |

### Usage Tracking / Billing
| File | Role |
|------|------|
| `routes/webhook.ts` | Stripe + LiveKit webhooks; billing minutes computation |
| `routes/usageRoutes.ts` | Usage summary endpoint; lazy billing-period reset |
| `usageHelper.ts` | Storage accounting; usage increment |
| `lib/usageTracker.ts` | Month key; stream gating; billed minute formatting |
| `lib/usageOverages.ts` | Overage computation + gate evaluation |
| `lib/usageOveragesWriter.ts` | Overage totals persistence (transactional) |
| `lib/normalizePlan.ts` | Plan normalization |
| `lib/planLimits.ts` | Plan limit resolution |
| `lib/effectiveEntitlements.ts` | Entitlement resolution |

### Telemetry
| File | Role |
|------|------|
| `routes/telemetry.ts` (server) | Receives client events; **logs to console only, no persistence** |
| `lib/telemetry.ts` (client) | Fire-and-forget telemetry sender |

### Room / Program State
| File | Role |
|------|------|
| `services/rooms.ts` | Room document management; HLS lifecycle |
| `routes/roomsProgramState.ts` | Program state GET/PATCH + LiveKit metadata broadcast |
| `lib/programState.ts` | Program state schema + normalization |

---

## 2. Monitoring Flow Summary

### Architecture: Event-Driven + Pull-Based (No Continuous Pipeline)

StreamLine does **NOT** have a continuous monitoring pipeline that collects, aggregates, and pushes metrics during active sessions. Instead, the monitoring system is composed of:

1. **Event-Driven Forwarding (Push)**: Chat messages and voice audio chunks are forwarded to Horizon via webhook as they occur during active rooms.
2. **Pull-Based Support API**: Horizon queries StreamLine on-demand for room state, participant counts, and chat history.
3. **Client Telemetry**: Guest join flow timing events are posted to the server and logged to console.
4. **Usage Billing**: Minute-level usage is computed when egress/recording ends (not during active sessions).

```
Active Room
  │
  ├──[Client sends chat]──→ POST /:roomId/chat-events ──→ Horizon (HORIZON_CHAT_EVENT_URL)
  ├──[Client sends audio]──→ POST /:roomId/voice-stream ──→ Horizon (HORIZON_VOICE_EVENT_URL)
  │
  ├──[Horizon queries]──→ GET /bot/support/rooms (on-demand pull)
  │
  ├──[Egress ends]──→ LiveKit webhook → computeBilledMinutes → usageMonthly
  └──[Recording ends]──→ maybeCountRecordingUsage → usageMonthly
```

### What Does NOT Exist
- ❌ No periodic metric snapshots during active sessions
- ❌ No automatic participant count tracking pushed to external APIs
- ❌ No room duration tracking pushed in real-time
- ❌ No recording state change notifications sent externally
- ❌ No "monitoring pipeline" aggregating metrics for outbound delivery
- ❌ No WebSocket data streaming (WS is ping/pong only)

---

## 3. How Active State Is Determined

### Source of Truth: `rooms/{roomId}.status`

| Value | Meaning | Transition Trigger |
|-------|---------|-------------------|
| `"idle"` | Room created, not yet live | `ensureRoomDoc()` in `services/rooms.ts` |
| `"live"` | Host has joined | Token issuance in `roomGuestAccess.ts` when host joins |
| `"ended"` | Session terminated | `POST /api/roomModeration/remove-all` in `index.ts` |

### Related Fields
- `hls.status`: Independent lifecycle (`idle` → `starting` → `live` → `error` → `idle`)
- `isLive`: **Read but never written** — stale/absent field returned by Support API
- `programState`: Layout/composition state, written by host control UI

### Reliability Assessment
- ✅ `room.status` is set atomically by server-side code
- ✅ Transitions are event-driven (host join, host end session)
- ⚠️ No automatic timeout: if host disconnects without ending, room stays "live" indefinitely
- ⚠️ `isLive` field in Support API responses will always be `false` (never set)

---

## 4. What Data Is Sent to Horizon

### Outbound Push (StreamLine → Horizon)

**Chat Events** (`POST` to `HORIZON_CHAT_EVENT_URL`):
```json
{
  "event": "message",
  "roomId": "...",
  "userId": "...",
  "username": "...",
  "message": "...",
  "timestamp": "ISO-8601",
  "mentions": ["@user1"],
  "isCommand": true,
  "matchedTrigger": "@horizon",
  "commandText": "help me",
  "originalText": "@horizon help me"
}
```

**Voice Events** (`POST` to `HORIZON_VOICE_EVENT_URL`):
- Raw binary audio with metadata headers:
  - `X-Room-Id`, `X-User-Id`, `X-Username`, `X-Timestamp`, `X-Request-Id`
  - `Authorization: Bearer <secret>` (when configured)

### Inbound Pull (Horizon → StreamLine)

**Room List** (`GET /bot/support/rooms`):
- Returns: `id`, `name`, `status`, `hostUid`, `participantCount`, `createdAt`, `updatedAt`, `isLive`

**Room Detail** (`GET /bot/support/rooms/:roomId`):
- Same fields + `chat.enabled`, `chat.activeSessionId`

**Chat History** (`GET /bot/support/rooms/:roomId/chat`):
- Returns messages with: `id`, `text`, `senderIdentity`, `senderName`, `senderRole`, `isAgent`, `createdAt`

---

## 5. What Data Is Sent to Support Hub

### Finding: "Support Hub" Is Not a Separate System

There is **no separate "Support Hub" outbound API target**. The term "Support Hub" refers to the **Horizon bot's support query endpoints** within the same bot API:

- `GET /api/horizon/bot/support/status`
- `GET /api/horizon/bot/support/rooms`
- `GET /api/horizon/bot/support/rooms/:roomId`
- `GET /api/horizon/bot/support/rooms/:roomId/chat`

These are **pull-based** endpoints that Horizon calls to query StreamLine — not outbound pushes.

---

## 6. Aggregation / Rounding Findings

### `computeBilledMinutes` (webhook.ts:83-88)
```typescript
return Math.max(1, Math.ceil(durationMs / 60_000));
```
- ✅ Correctly uses `Math.ceil` (rounds up)
- ✅ `Math.max(1, ...)` ensures minimum 1 minute billing
- ✅ `Math.max(0, ...)` prevents negative durations
- ✅ Returns 0 for null start time

### `incrementTranscodeMinutes` (webhook.ts:90-148)
```typescript
const safeMinutes = Math.max(0, Math.round(params.billedMinutes));
```
- ✅ Uses `Math.round` for already-ceiled values (safe: ceil then round is idempotent for integers)
- ✅ Transactional Firestore update

### `incrementHlsMinutes` (webhook.ts:150-186)
```typescript
const safeMinutes = Math.max(0, Math.round(params.billedMinutes));
```
- ⚠️ **NOT transactional** — uses read-then-set pattern instead of `runTransaction`, creating a race window for concurrent HLS egress completions

### `maybeCountRecordingUsage` (webhook.ts:188-297)
- ✅ Fully transactional
- ✅ Idempotent via `usageCounted` flag
- ✅ Falls back to computed duration when `durationMs` is missing

### `upsertUsageMonthlyOverageTotals` (usageOveragesWriter.ts)
```typescript
const participantMinutes = Math.max(0, Math.round(Number(params.totals.participantMinutes || 0)));
```
- ✅ Correctly rounds and floors at 0
- ✅ Transactional

### `computeOverage` (usageOverages.ts)
```typescript
return Math.max(0, used - included);
```
- ✅ Correctly returns 0 when under limit
- ✅ Returns 0 when `includedMinutes <= 0` (unlimited)

### Storage Accounting (usageRoutes.ts:220-222)
```typescript
const storageUsedGB = Math.round((storageUsedBytes / GB) * 100) / 100;
const storageLimitGB = Math.round((maxStorageBytes / GB) * 100) / 100;
```
- ✅ Rounds to 2 decimal places for display
- ✅ Bytes remain source of truth

### Usage Summary Hours (usageRoutes.ts:269-270)
```typescript
participantHours: Math.round((participantUsed / 60) * 100) / 100,
transcodeHours: Math.round((transcodeUsed / 60) * 100) / 100,
```
- ✅ Rounds to 2 decimal places

---

## 7. Bugs / Risks Found

### CRITICAL

| # | File | Function | Problem | Impact |
|---|------|----------|---------|--------|
| C1 | `lib/horizon/webhookConfig.ts:49` | `verifyHorizonSecret` | Uses plain `===` string comparison instead of constant-time comparison | Timing attack vulnerability: attacker can brute-force the webhook secret by measuring response times |

### IMPORTANT

| # | File | Function/Line | Problem | Impact |
|---|------|---------------|---------|--------|
| I1 | `routes/horizon/botApi.ts:293` | Support room detail | Returns `isLive: d.isLive ?? false` but `isLive` is never written to room docs | Horizon always sees `isLive: false` even for active rooms; misleading monitoring data |
| I2 | `routes/horizon/botApi.ts:252` | Support rooms list | Same `isLive` issue in list endpoint | Same as I1 |
| I3 | `routes/horizon/botApi.ts:106` | POST /events handler | Double rate limiting: `router.use(horizonRateLimit)` at line 98 + per-route `horizonRateLimit` at line 106 | `/events` endpoint is rate-limited at 30 effective requests per minute instead of 60 |
| I4 | `routes/webhook.ts:150-186` | `incrementHlsMinutes` | Non-transactional read-then-set pattern | Concurrent HLS egress completions could cause lost minute increments (race condition) |
| I5 | `routes/horizonWs.ts` | Connection handler | WebSocket only supports ping/pong; no monitoring data is streamed | Admin WS connection provides no real-time monitoring capability |
| I6 | `routes/telemetry.ts:34,69` | Event/guest handlers | Events logged to console only (no persistence) | All telemetry data is lost on log rotation; no analytics possible |
| I7 | Monitoring architecture | — | No proactive monitoring data push during active sessions | Horizon has no real-time awareness of room state changes unless it polls the support API |

### MINOR

| # | File | Function | Problem | Impact |
|---|------|----------|---------|--------|
| M1 | `routes/horizon/roomHooks.ts:129` | chat-events response | Returns `forwarded: true` before webhook delivery completes | Misleading: caller thinks forwarding succeeded when it may not have |
| M2 | `lib/horizon/webhookConfig.ts:12-13` | Default URLs | Hardcoded to `http://10.0.0.27:3000/...` | Expected for internal network but not logged at startup; silent failure if Horizon is elsewhere |
| M3 | `routes/platformHealth.ts` | GET / | Only returns `process.uptime()` + `memoryUsage()` | No room/session/connection metrics |
| M4 | Admin stubs | alertRoutes, supportActions, supportTickets, skillsIntegration | All return empty arrays | These admin monitoring endpoints are non-functional |

---

## 8. Safe Fixes Applied

### Fix C1: Constant-time secret comparison
**File**: `lib/horizon/webhookConfig.ts`  
**Change**: Replace `===` with `timingSafeEqual` in `verifyHorizonSecret`

### Fix I1/I2: Derive `isLive` from `room.status`
**File**: `routes/horizon/botApi.ts`  
**Change**: Return `isLive: d.status === "live"` instead of `d.isLive ?? false`

### Fix I3: Remove duplicate rate limiting on /events
**File**: `routes/horizon/botApi.ts`  
**Change**: Remove per-route `horizonRateLimit` from POST /events (already applied via `router.use`)

### Add: Debug logging for monitoring pipeline verification
**Files**: `routes/horizon/roomHooks.ts`, `routes/horizon/botApi.ts`, `lib/horizon/webhookForwarder.ts`  
**Change**: Add targeted debug logs to trace monitoring data flow

---

## 9. Missing Instrumentation

1. **No room lifecycle events forwarded to Horizon**: When a room transitions to "live" or "ended", Horizon is not notified. Only chat/voice events are forwarded.
2. **No participant join/leave events forwarded**: The Support API `/status` endpoint advertises capabilities including `voice.participant_joined` and `voice.participant_left`, but these events are never emitted.
3. **No recording start/stop events forwarded**: Recording state changes are internal only.
4. **No HLS live/ended events forwarded**: HLS state is tracked in Firestore but not communicated externally.
5. **No heartbeat from StreamLine → Horizon**: There's a `monitoring.heartbeat` inbound handler, but StreamLine never sends heartbeats outbound.
6. **No WebSocket event streaming**: The Horizon WS is connected but idle.

---

## 10. Manual Verification Checklist

Use this checklist to manually verify the monitoring pipeline during testing:

### Pre-requisites
- [ ] Confirm `HORIZON_WEBHOOK_SECRET` is set in environment
- [ ] Confirm `HORIZON_CHAT_EVENT_URL` points to reachable Horizon instance
- [ ] Confirm `HORIZON_VOICE_EVENT_URL` points to reachable Horizon instance

### Test Flow
1. **Start room**
   - [ ] Create room → verify `room.status = "idle"` in Firestore
   - [ ] Host joins → verify `room.status = "live"` in Firestore
   - [ ] Check logs for: `[monitoring:support] rooms list query` (if Horizon polls)

2. **Go live (HLS)**
   - [ ] Start HLS → verify `hls.status = "starting"` then `"live"` in Firestore
   - [ ] Note: No outbound notification is sent to Horizon for HLS state changes

3. **Join participant**
   - [ ] Guest joins room → verify token issued
   - [ ] Note: No participant-join event is sent to Horizon

4. **Trigger state change (chat)**
   - [ ] Send chat message in room
   - [ ] Verify server log: `"chat-event hook fired"` with roomId, userId, isCommand
   - [ ] Verify webhook log: `"horizon webhook forwarded"` with status 200
   - [ ] If Horizon is down: verify `"horizon webhook forwarding failed after retries"` in logs

5. **Trigger state change (voice)**
   - [ ] Send voice chunk
   - [ ] Verify server log: `"voice-stream hook fired"` with roomId, userId, bytes
   - [ ] Verify webhook log: `"horizon voice webhook forwarded"` with status 200

6. **Observe Support API response**
   - [ ] Call `GET /api/horizon/bot/support/rooms` with Bearer token
   - [ ] Verify room appears with `status: "live"`, `isLive: true`
   - [ ] Call `GET /api/horizon/bot/support/rooms/:roomId`
   - [ ] Verify chat session data is present

7. **End session**
   - [ ] Host ends session → verify `room.status = "ended"` in Firestore
   - [ ] Note: No outbound "room ended" notification is sent to Horizon

8. **Recording verification**
   - [ ] After egress completes, verify LiveKit webhook arrives
   - [ ] Verify `computeBilledMinutes` log shows correct ceiling-rounded minutes
   - [ ] Verify `usageMonthly` doc is updated with recording minutes

9. **Failure scenarios**
   - [ ] Take Horizon offline → send chat → verify retry logs + final failure log
   - [ ] Send malformed chat → verify 4xx non-retry log
   - [ ] Call Support API with bad token → verify 401 response + log
