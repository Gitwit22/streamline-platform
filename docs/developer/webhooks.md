# Webhooks

StreamLine uses webhooks for event-driven integrations with external services. This document covers both inbound webhooks (events StreamLine receives) and outbound webhooks (events StreamLine sends).

## Inbound Webhooks

### Horizon Bot Webhook

**Endpoint:** `POST /api/horizon/bot/events`

The Horizon AI agent POSTs events to StreamLine via this endpoint. It uses dual authentication: a Bearer token and HMAC-SHA256 signature verification.

#### Authentication

All bot API endpoints require a Bearer token:

```
Authorization: Bearer <HORIZON_WEBHOOK_SECRET>
```

The inbound webhook POST additionally requires an HMAC-SHA256 signature of the request body:

```
X-Horizon-Signature: sha256=<hex-digest>
```

The signature is computed as `HMAC-SHA256(HORIZON_WEBHOOK_SECRET, raw_request_body)`.

#### Rate Limiting

60 requests per 60-second window per IP address. Returns `429` with `retryAfterMs` when exceeded.

#### Inbound Event Types

| Event Type | Description |
|---|---|
| `support.alert` | Support system alert from Horizon |
| `chat.response` | Bot chat response to a user query |
| `monitoring.heartbeat` | Periodic health/status heartbeat |
| `skill.result` | Result from a Horizon skill execution |
| `ack` | Acknowledgement of a previously sent event |

#### Inbound Payload Format

```json
{
  "id": "evt_abc123",
  "type": "chat.response",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    "roomId": "room-id",
    "message": "Here is the meeting summary..."
  }
}
```

#### Webhook Flow

```
Horizon → POST /api/horizon/bot/events
                │
                ├── Rate limit check (60 req/min per IP)
                │
                ├── Parse raw body (preserves bytes for HMAC)
                │
                ├── Verify Bearer token
                │
                ├── Verify HMAC-SHA256 signature (X-Horizon-Signature)
                │
                ├── Parse JSON body
                │
                ├── Route by event type
                │
                └── Return { ok: true, type, id }
```

### Horizon Support API

The bot can query StreamLine for room and chat data.

| Endpoint | Description |
|---|---|
| `GET /api/horizon/bot/support/status` | Health check / connection test |
| `GET /api/horizon/bot/support/rooms` | List active rooms (optional `?status=live&limit=50`) |
| `GET /api/horizon/bot/support/rooms/:roomId` | Room detail |
| `GET /api/horizon/bot/support/rooms/:roomId/chat` | Recent chat messages (optional `?limit=50&sessionId=...`) |

All support API endpoints require: `Authorization: Bearer <HORIZON_WEBHOOK_SECRET>`

#### Status Response

```json
{
  "ok": true,
  "service": "StreamLine Horizon Integration",
  "version": "1.0.0",
  "timestamp": "2025-01-15T10:30:00Z",
  "capabilities": ["chat.message", "voice.room_started", "support.alert", "..."],
  "endpoints": {
    "inbound": "POST /api/horizon/bot/events",
    "outboundChat": "POST /api/rooms/:roomId/chat-events",
    "outboundVoice": "POST /api/rooms/:roomId/voice-stream",
    "agentChat": "POST /api/rooms/:roomId/chat",
    "supportStatus": "GET /api/horizon/bot/support/status",
    "supportRooms": "GET /api/horizon/bot/support/rooms",
    "supportRoomDetail": "GET /api/horizon/bot/support/rooms/:roomId",
    "supportRoomChat": "GET /api/horizon/bot/support/rooms/:roomId/chat"
  }
}
```

### Horizon Agent Chat Posting

**Endpoint:** `POST /api/rooms/:roomId/chat`

Allows the Horizon agent to post messages directly into a room's active chat session. Messages appear in real time via the existing SSE `/chat/stream` endpoint.

**Auth:** `Authorization: Bearer <HORIZON_WEBHOOK_SECRET>`

**Payload:**
```json
{
  "userId": "horizon-agent",
  "username": "Horizon",
  "message": "Meeting summary: ..."
}
```

---

### Stripe Webhooks

**Endpoint:** `POST /api/webhooks/stripe`

Stripe sends webhook events to notify StreamLine of payment and subscription changes. The webhook endpoint verifies the Stripe signature before processing.

> **Important**: The Stripe webhook route is registered _before_ the JSON body parser in the middleware stack. This is required because Stripe signature verification needs the raw request body.

#### Events Handled

| Event | Description | Action |
|---|---|---|
| `customer.subscription.created` | New subscription activated | Update user's plan ID and billing truth in Firestore |
| `customer.subscription.updated` | Plan change (upgrade/downgrade) | Reflect new plan status; apply scheduled changes |
| `customer.subscription.deleted` | Subscription canceled | Revert user to Free plan |
| `invoice.paid` | Payment succeeded | Confirm billing state |
| `invoice.payment_failed` | Payment failed | Flag billing issue on user account |

#### Webhook Flow

```
Stripe → POST /api/webhooks/stripe
                │
                ├── Verify Stripe signature (raw body)
                │
                ├── Parse event type
                │
                ├── Match event to handler
                │
                └── Update Firestore user document
                    (planId, billingTruth, stripeCustomerId,
                     scheduledPlanChange)
```

#### Configuration

| Environment Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (for signature verification) |

#### Subscription Lifecycle via Webhooks

1. **User initiates checkout** → `POST /api/billing/checkout` creates Stripe session
2. **User completes payment** → Stripe fires `customer.subscription.created`
3. **Webhook updates user** → User document updated with new plan and Stripe customer ID
4. **Plan change** → Stripe fires `customer.subscription.updated`
5. **Scheduled downgrade** → Applied at end of billing period via `scheduledPlanChange` field
6. **Cancellation** → Stripe fires `customer.subscription.deleted`, user reverts to Free

---

## Outbound Webhooks

### Horizon Event Webhooks

StreamLine forwards room events to the Horizon AI agent service via outbound webhooks.

#### Chat Events

**Outbound URL:** Configured via `HORIZON_CHAT_EVENT_URL`
**Trigger Endpoint:** `POST /api/rooms/:roomId/chat-events` (requires room access token)

When a chat message is sent in a room, StreamLine forwards it to Horizon. Messages containing triggers (`@horizon`, `horizon:`, `hey horizon`) are flagged as commands.

**Payload:**
```json
{
  "event": "message",
  "roomId": "room-id",
  "userId": "user-uid",
  "username": "display-name",
  "message": "hey horizon, summarize this meeting",
  "timestamp": "2025-01-15T10:30:00Z",
  "mentions": ["horizon"],
  "isCommand": true,
  "matchedTrigger": "hey horizon",
  "commandText": "summarize this meeting",
  "originalText": "hey horizon, summarize this meeting"
}
```

#### Voice Events

**Outbound URL:** Configured via `HORIZON_VOICE_EVENT_URL`
**Trigger Endpoint:** `POST /api/rooms/:roomId/voice-stream` (requires room access token)

Audio chunks (up to 5 MB, `audio/wav` or `application/octet-stream`) are forwarded to Horizon with speaker metadata in headers:

| Header | Description |
|---|---|
| `X-Room-Id` | Room identifier |
| `X-User-Id` | Speaker user ID |
| `X-Username` | Speaker display name |
| `X-Timestamp` | ISO-8601 timestamp |
| `X-Request-Id` | Correlation ID |
| `Authorization` | `Bearer <HORIZON_WEBHOOK_SECRET>` |

#### Authentication

Outbound webhooks include a Bearer token for authentication:

```
Authorization: Bearer <HORIZON_WEBHOOK_SECRET>
```

The receiving service verifies the token using `verifyHorizonSecret()`.

For inbound events (Horizon → StreamLine), HMAC-SHA256 signature verification is also required via the `X-Horizon-Signature` header. Use `signPayload()` from `lib/horizon/hmacVerify.ts` to generate signatures.

#### Retry Logic

| Setting | Default | Description |
|---|---|---|
| `HORIZON_WEBHOOK_TIMEOUT` | 5000ms | Per-request timeout |
| `HORIZON_WEBHOOK_RETRIES` | 2 | Max retries on 5xx responses |

Failed requests are retried automatically on 5xx server errors. Client errors (4xx) are not retried.

#### Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `HORIZON_CHAT_EVENT_URL` | Chat event webhook endpoint | `http://10.0.0.27:3000/api/streamline/chat-event` |
| `HORIZON_VOICE_EVENT_URL` | Voice event webhook endpoint | `http://10.0.0.27:3000/api/streamline/voice-event` |
| `HORIZON_WEBHOOK_SECRET` | Shared authentication secret | — |
| `HORIZON_WEBHOOK_TIMEOUT` | Request timeout (ms) | `5000` |
| `HORIZON_WEBHOOK_RETRIES` | Max retry attempts | `2` |

---

## LiveKit Webhooks

LiveKit can send server-side webhook notifications for room events (participant joined/left, recording started/stopped). These are received via the Horizon room hooks system.

**Endpoint:** `/api/rooms/:roomId/hooks`

**Events:**
- Room created / deleted
- Participant joined / left
- Track published / unpublished
- Egress started / completed / failed

These events can trigger automated actions in the Horizon AI system or be used for analytics and monitoring.

---

## Implementing Custom Webhooks

To add a new webhook integration:

1. **Create a route handler** in `streamline-server/routes/` for inbound webhooks
2. **Register the route** in `streamline-server/index.ts` — place _before_ JSON parser if raw body is needed
3. **Verify signatures** — Always validate webhook signatures for security
4. **Handle idempotently** — Webhook events may be delivered more than once
5. **Return quickly** — Process asynchronously if the handler involves heavy work
6. **Log events** — Use structured logging with request IDs for debugging

For outbound webhooks:
1. **Define the event** and payload format
2. **Add configuration** via environment variables for the target URL and secret
3. **Implement retry logic** for transient failures
4. **Encrypt sensitive data** in payloads if needed
