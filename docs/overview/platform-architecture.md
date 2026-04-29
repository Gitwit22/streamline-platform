# Platform Architecture

This document describes the technical architecture of the StreamLine platform, covering each major system layer.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        StreamLine Client                            │
│              React 19 + Vite SPA (streamline-client/)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Rooms   │ │Broadcast │ │  Editor  │ │  Admin   │ │ Billing  │ │
│  │   UI     │ │  Studio  │ │ Timeline │ │Dashboard │ │ Portal   │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │            │             │            │       │
│       └─────────────┴────────────┴─────────────┴────────────┘       │
│                              │                                      │
│                    REST API + WebSocket                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────────────┐
│                       StreamLine Server                             │
│             Express.js 5 + TypeScript (streamline-server/)          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Auth    │ │  Rooms   │ │ Editing  │ │ Billing  │ │  Admin   │ │
│  │Middleware│ │  Routes  │ │ Pipeline │ │  Routes  │ │  Routes  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │            │             │            │       │
└───────┴─────────────┴────────────┴─────────────┴────────────┴───────┘
        │             │            │             │
   ┌────┴────┐  ┌─────┴─────┐ ┌───┴────┐  ┌─────┴─────┐
   │Firebase │  │  LiveKit   │ │  R2    │  │  Stripe   │
   │Auth + DB│  │  WebRTC    │ │Storage │  │ Payments  │
   └─────────┘  └────────────┘ └────────┘  └───────────┘
```

## Frontend System

**Technology**: React 19, Vite 7, TypeScript, React Router v6

The client is a single-page application (SPA) built with React and bundled by Vite. It communicates with the backend via REST API calls and connects directly to LiveKit servers for real-time video/audio.

### Key Areas

| Area | Entry Point | Description |
|---|---|---|
| Authentication | `src/pages/LoginPage.tsx`, `SignupPage.tsx` | Login, signup, password reset flows |
| Room Experience | `src/creator/pages/Room.tsx` | Main live room — video grid, chat, controls, layout switching |
| Broadcast Studio | `src/creator/pages/Live.tsx` | Live broadcast viewer (HLS playback) |
| Video Editor | `src/creator/features/editing/EditorPage.tsx` | Timeline-based video editing with multi-track support |
| Content Library | `src/creator/features/editing/AssetLibrary.tsx` | Media asset management and upload |
| Projects | `src/creator/features/editing/ProjectsDashboard.tsx` | Video editing project management |
| Admin Dashboard | `src/creator/pages/AdminDashboard.tsx` | Platform administration, analytics, support |
| Billing | `src/creator/pages/SettingsBilling.tsx` | Plan management, Stripe checkout integration |
| Settings | `src/creator/pages/SettingsDestinations.tsx` | Stream destination configuration |

### Feature Gating

The client uses entitlement hooks (`useEffectiveEntitlements`) to gate access to features based on the user's subscription plan:

- `canContentLibrary` — Access to `/content` (asset library)
- `canProjects` — Access to `/projects` (project dashboard)
- `canEditor` — Access to `/editing/editor/:projectId` (timeline editor)
- `canMyContentRecordings` — Access to recording content

Feature flags are cached client-side (30-second TTL) and validated server-side on every API call.

### LiveKit Client Integration

The frontend uses `@livekit/components-react` and `livekit-client` to:

- Join rooms with server-minted access tokens
- Publish/subscribe to audio and video tracks
- Render participant video grids with dynamic layouts
- Handle screen sharing and multi-camera scenarios
- Display real-time connection quality indicators

## Backend System

**Technology**: Express.js 5, TypeScript, Node.js

The server is a monolithic Express application with 42+ route modules organized by domain. It handles authentication, room management, streaming control, billing, editing, and administration.

### Middleware Stack

Middleware is applied in the following order:

1. **CORS** — Cross-origin request handling (configurable allowed origins)
2. **Request ID** — Unique ID per request for distributed tracing (`middleware/requestId.ts`)
3. **Pino HTTP** — Structured JSON request logging (skips health checks)
4. **JSON Parser** — `express.json()` for request body parsing
5. **URL Encoded** — `express.urlencoded()` for form submissions
6. **Cookie Parser** — `cookieParser()` for session cookie handling
7. **Route Handlers** — 42+ domain-specific route modules
8. **404 Handler** — Catch-all for unmatched routes
9. **Global Error Handler** — Centralized error handling (`middleware/errorHandler.ts`)

> **Note**: Stripe webhook routes are registered _before_ the JSON body parser to receive raw request bodies for signature verification.

### Route Organization

Routes are organized by domain across 42+ files in `streamline-server/routes/`:

| Domain | Route Files | Base Path |
|---|---|---|
| Auth | `auth.ts`, `account.ts` | `/api/auth`, `/api/account` |
| Rooms | `roomsCreate.ts`, `roomControls.ts`, `roomGuestAccess.ts`, `roomInvites.ts`, `roomChat.ts`, `roomsLayout.ts`, `roomsPolicy.ts`, `roomsRecordings.ts`, `roomsHlsConfig.ts`, `roomsActiveEmbed.ts`, `roomsResolve.ts` | `/api/rooms` |
| Streaming | `hls.ts`, `publicHls.ts`, `live.ts`, `multistream.ts`, `destinations.ts` | `/api/hls`, `/api/live`, `/api/rooms/multistream` |
| Editing | `editing.ts` | `/api/editing` |
| Billing | `billing.ts`, `plans.ts`, `usageRoutes.ts`, `webhook.ts` | `/api/billing`, `/api/plans`, `/api/usage`, `/api/webhooks` |
| Admin | `admin.ts`, `adminStatus.ts`, `maintenance.ts`, `diagnostics.ts`, `platformHealth.ts`, `alertRoutes.ts` | `/api/admin`, `/api/maintenance`, `/api/diagnostics` |
| Support | `supportTickets.ts`, `supportActions.ts` | `/api/support`, `/api/supportActions` |
| Features | `featureAccess.ts`, `skillsIntegration.ts` | `/api/featureAccess` |
| Telemetry | `stats.ts`, `telemetry.ts` | `/api/stats`, `/api/telemetry` |
| AI/Horizon | `horizonApi.ts`, `horizonWs.ts`, `horizon/roomHooks.ts` | `/api/horizon` |
| Onboarding | `onboarding.ts` | `/api/onboarding` |
| Misc | `invites.ts`, `recordings.ts`, `savedEmbeds.ts` | `/api/invites`, `/api/recordings` |

### Error Handling

The server uses a centralized error handling pattern:

- **`safeError(res, err, label)`** — Returns generic 500 responses to clients while logging full error details server-side. Never exposes `err.message` or `err.stack` in HTTP responses.
- **`globalErrorHandler`** — Catches unhandled errors in the middleware chain.
- **Structured logging** — All errors are logged via Pino with request IDs for traceability.

## Real-Time Media Infrastructure

**Technology**: LiveKit (WebRTC), HLS.js

LiveKit is the core real-time communication layer. StreamLine uses the LiveKit server SDK to manage rooms, generate access tokens, and control egress (recording and restreaming).

### Room Lifecycle

```
1. Host creates room     → POST /api/rooms/create
                           (Firestore doc + LiveKit room name)

2. Participants join      → POST /api/rooms/:roomId/token
                           (Server mints LiveKit access token with role-based permissions)

3. Streaming starts       → POST /api/rooms/:roomId/controls/start-hls
                           (RoomComposite egress to R2 via HLS segments)

4. Multi-destination      → POST /api/rooms/:roomId/start-multistream
                           (RTMP egress to YouTube, Twitch, etc.)

5. Recording              → Automatic via HLS egress or explicit recording start

6. Room ends              → Host closes room, egress stops, recording finalizes
```

### Access Token Generation

Server-side token minting encodes:
- Room ID and participant identity
- Role (host, co-host, participant, guest, viewer)
- Granular permissions: `canPublishAudio`, `canPublishVideo`, `canScreenShare`, `canMuteGuests`, `canRemoveGuests`, `canStartStopStream`, `canStartStopRecording`
- Presence mode: `normal`, `silent`, or `invisible`

### Layout Modes

LiveKit RoomComposite egress supports multiple layout modes for recording and restreaming:

- **Speaker** — Active speaker highlighted, others in sidebar
- **Grid** — Equal-sized tiles for all participants
- **Carousel** — Scrollable participant list
- **PIP (Picture-in-Picture)** — Main speaker with small overlay

Layout modes can be set per-room and updated in real-time during a session.

## Video Processing Pipeline

### Recording Flow

```
Room Session → LiveKit RoomComposite Egress → HLS Segments → R2 Storage
                                                                  │
                                                          ┌───────┴───────┐
                                                          │  Playlist     │
                                                          │  room.m3u8   │
                                                          │  live.m3u8   │
                                                          │  Segments    │
                                                          │  seg-*.ts    │
                                                          └───────────────┘
```

- **Segmented output**: HLS `.ts` segments stored in R2 under `hls/<roomId>/`
- **Playlists**: `room.m3u8` (full VOD) and `live.m3u8` (sliding window for live viewers)
- **Encoding**: Default 720p, with 1080p reserved for higher-tier plans

### Export Rendering

The export pipeline processes timeline-based video projects:

```
Timeline Definition → Export Queue (Firestore) → Render Worker (FFmpeg) → R2 Upload
```

- **Job states**: `queued` → `preparing` → `rendering` → `uploading` → `completed` | `failed` | `canceled`
- **Queue**: Firestore-backed with transactional job claiming (no Redis dependency)
- **Worker**: Background FFmpeg process that polls for jobs every 5 seconds
- **Output formats**: MP4, WebM, MOV at 720p, 1080p, or 4K resolution
- **Quality presets**: Draft, Standard, High

## Data Storage

### Firestore (Database)

Primary database for all application state:

| Collection | Purpose |
|---|---|
| `users` | User accounts, profiles, plan info, Stripe customer IDs |
| `rooms` | Room configuration, state, owner references |
| `recordings` | Recording metadata, storage URLs, status |
| `plans` | Subscription plan definitions and feature flags |
| `usageMonthly` | Per-user monthly usage tracking |
| `exports` | Video export job definitions and status |
| `supportTickets` | Support ticket records |
| `savedEmbeds` | Saved viewer embed configurations |

### Cloudflare R2 (Object Storage)

S3-compatible object storage for binary media:

- **HLS segments** — Live and recorded stream segments (`hls/<roomId>/`)
- **Recordings** — Finalized recording files
- **Assets** — User-uploaded media files for the content library
- **Exports** — Rendered video exports from the editing pipeline

Access is managed via pre-signed URLs generated server-side.

## Authentication

StreamLine uses a dual-path authentication system:

1. **Firebase ID Tokens** (primary) — Verified via `firebaseAuth.verifyIdToken()`
2. **Legacy JWT** (fallback) — Verified via `jwt.verify()` with server-side `JWT_SECRET`

### Session Management

- Sessions are maintained via httpOnly cookies with 7-day expiry
- Cookies use `secure` flag in production and `sameSite: none` for cross-origin API calls
- Token revocation is supported via `authRevokedAtMs` timestamp on user documents
- Deleted accounts return `403 account_deleted`

### Room Access Tokens

Separate from user authentication, room access tokens are minted per-session:
- Generated via `POST /api/rooms/:roomId/token`
- Contain LiveKit-compatible claims (room, identity, permissions)
- Passed as `X-Room-Access-Token` header for room-specific API calls

## Billing System

**Technology**: Stripe (Subscriptions, Checkout, Webhooks)

### Plan Tiers

| Plan | Features |
|---|---|
| **Free** | Basic room creation, limited recording |
| **Starter** | HLS streaming, recording, content library |
| **Pro** | Multi-destination streaming, video editor, advanced permissions |
| **Basic** | Core features with standard limits |

### Billing Flow

```
User selects plan → Stripe Checkout Session → Payment → Webhook → Plan activation
```

- Checkout sessions are created via `POST /api/billing/checkout`
- Stripe webhooks (`customer.subscription.created`, `customer.subscription.updated`) update user billing state
- Downgrades are scheduled for the end of the billing period
- Usage tracking (`usageMonthly` collection) enforces per-plan limits
- Overage detection and enforcement via `evaluateUsageGate()`

### Usage Limits

Plans define limits on:
- Monthly recording minutes
- RTMP destination count
- HLS streaming minutes
- Transcode minutes
- Concurrent recordings
- Export duration

## Monitoring and Observability

- **Structured Logging**: Pino JSON logger with request ID correlation
- **Request Tracing**: Unique request ID attached to every API call
- **Health Endpoints**: `/api/health`, `/api/platformHealth` for uptime monitoring
- **Horizon WebSocket**: Real-time observability stream for admin users
- **Diagnostics**: `/api/diagnostics` for system health checks
- **Alerts**: `/api/alerts` for platform alert management
