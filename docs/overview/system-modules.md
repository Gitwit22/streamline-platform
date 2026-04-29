# System Modules

StreamLine is composed of several major system modules. Each module encapsulates a distinct area of platform functionality with its own routes, UI components, and data models.

## Module Overview

| Module | Purpose | Server Routes | Client Entry |
|---|---|---|---|
| [Broadcast Studio](#broadcast-studio) | Live streaming and multi-destination broadcasting | `roomControls.ts`, `hls.ts`, `multistream.ts`, `live.ts` | `Room.tsx`, `Live.tsx` |
| [Rooms](#rooms) | Real-time video/audio communication | `roomsCreate.ts`, `roomGuestAccess.ts`, `roomControls.ts` | `Room.tsx`, `Join.tsx` |
| [Messaging](#messaging) | In-room chat and moderation | `roomChat.ts` | Chat panel in `Room.tsx` |
| [Media Library](#media-library) | Asset upload, management, and organization | `editing.ts` (asset endpoints) | `AssetLibrary.tsx` |
| [Video Editor](#video-editor) | Timeline-based video editing and export | `editing.ts` (project/export endpoints) | `EditorPage.tsx`, `ProjectsDashboard.tsx` |
| [Recordings](#recordings) | Recording capture, storage, and playback | `recordings.ts`, `roomsRecordings.ts` | `RoomExitPage.tsx` |
| [Billing](#billing) | Subscription management and usage tracking | `billing.ts`, `plans.ts`, `usageRoutes.ts`, `webhook.ts` | `SettingsBilling.tsx`, `Checkout.tsx` |
| [Admin Dashboard](#admin-dashboard) | Platform administration and analytics | `admin.ts`, `adminStatus.ts`, `diagnostics.ts` | `AdminDashboard.tsx`, `AdminUsage.tsx` |
| [Guest Access](#guest-access) | Invite-based room entry for external participants | `roomGuestAccess.ts`, `roomInvites.ts`, `invites.ts` | `InviteLanding.tsx`, `InviteRedeem.tsx` |
| [Destinations](#destinations) | RTMP destination management | `destinations.ts`, `multistream.ts` | `SettingsDestinations.tsx` |
| [Horizon (AI)](#horizon-ai) | AI agent framework for room automation | `horizonApi.ts`, `horizonWs.ts`, `horizon/roomHooks.ts` | Admin WebSocket |

---

## Broadcast Studio

### Purpose

The Broadcast Studio is StreamLine's live streaming system. It handles starting and stopping broadcasts, managing HLS egress for viewers, multi-destination RTMP restreaming, and live layout switching.

### Key Features

- **HLS Broadcasting** — Server-side composite encoding to HLS segments for scalable viewer delivery
- **Multi-Destination Streaming** — Simultaneous RTMP output to YouTube, Twitch, Facebook, Instagram, and custom RTMP endpoints
- **Layout Switching** — Real-time switching between speaker, grid, carousel, and PIP layouts during a broadcast
- **Screen Sharing** — Participants can share their screen as an additional video source
- **Recording** — Automatic recording alongside HLS broadcast with R2 cloud storage

### User Roles

| Role | Capabilities |
|---|---|
| Host | Start/stop broadcast, switch layouts, manage participants, start multi-stream |
| Co-Host | Manage participants, moderate chat |
| Participant | Publish audio/video, screen share (if permitted) |
| Viewer | Watch HLS broadcast, participate in chat |

### Technical Implementation

- **LiveKit RoomComposite Egress** — Server-side composite of all participant tracks into a single video stream
- **HLS Segments** — Stored in R2 at `hls/<roomId>/seg-*.ts` with `room.m3u8` (VOD) and `live.m3u8` (live sliding window) playlists
- **RTMP Output** — LiveKit `StreamOutput` with encrypted stream keys (AES-256-GCM)
- **Encoding Presets** — 720p default, with plan-gated higher resolutions

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/rooms/:roomId/controls/start-hls` | POST | Start HLS broadcast |
| `/api/rooms/:roomId/controls/stop-hls` | POST | Stop HLS broadcast |
| `/api/rooms/:roomId/start-multistream` | POST | Start multi-destination RTMP |
| `/api/rooms/:roomId/stop-multistream` | POST | Stop multi-destination RTMP |
| `/api/rooms/:roomId/layout` | PUT | Update room layout mode |
| `/api/public/hls/:roomId` | GET | Public HLS playlist access |

---

## Rooms

### Purpose

Rooms are the core unit of real-time interaction in StreamLine. A room is a LiveKit-backed video/audio session where participants communicate via WebRTC.

### Key Features

- **Room Creation** — Hosts create rooms with configurable type (RTC or HLS), visibility (public, unlisted, private), and access policies
- **Participant Management** — Role-based permissions per participant, real-time muting and removal
- **Presence Modes** — Normal, silent (audio/video off), and invisible (hidden from roster) participant states
- **Room Policies** — Configurable access requirements (authentication, payment, invite-only)
- **Saved Embeds** — Rooms can link to saved viewer embed configurations

### User Roles

| Role | Description |
|---|---|
| Host | Room owner with full control over all settings and participants |
| Co-Host | Elevated participant who can manage others and moderate |
| Participant | Standard attendee who can publish audio/video |
| Guest | Limited attendee, typically via invite link |
| Viewer | Watch-only access, no publishing capability |

### Technical Implementation

- **Firestore Room Document** — Stores room configuration, owner, LiveKit room name, type, visibility, and policies
- **LiveKit Room** — Actual WebRTC room backed by LiveKit infrastructure
- **Access Tokens** — Server-minted JWT tokens with LiveKit-compatible claims and role-based permission grants
- **Presence Metadata** — Token metadata includes `presenceMode`, `isVisibleInRoster`, `canSendChat`

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/rooms/create` | POST | Create a new room |
| `/api/rooms/:roomId/token` | POST | Mint a LiveKit access token for room entry |
| `/api/rooms/:roomId/resolve` | GET | Get room info and access requirements |
| `/api/rooms/:roomId/controls` | POST | Room control actions |
| `/api/rooms/:roomId/policy` | PUT | Update room access policies |
| `/api/rooms/:roomId/hls-config` | PUT | Update HLS configuration |
| `/api/rooms/:roomId/active-embed` | GET/PUT | Manage active viewer embed |

---

## Messaging

### Purpose

In-room chat system for real-time text communication between room participants.

### Key Features

- **Real-Time Chat** — Messages delivered via LiveKit data channels
- **Moderation** — Host and co-host can moderate chat messages
- **Chat Permissions** — Controlled via presence mode and role-based grants
- **Host-Only Moderation** — Optional `ROOM_MODERATION_HOST_ONLY` flag restricts moderation to hosts only

### Technical Implementation

- **LiveKit Data Channels** — Chat messages are sent as data messages through LiveKit's real-time data channel infrastructure
- **Server-Side Chat** — API endpoint for sending messages with server-side validation
- **Role-Based Filtering** — `canSendChat` permission controls who can send messages, derived from presence mode

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/rooms/:roomId/chat` | POST | Send a chat message |
| `/api/rooms/:roomId/chat/history` | GET | Retrieve chat history |

---

## Media Library

### Purpose

The Media Library (Content Library) allows users to upload, organize, and manage media assets that can be used in video editing projects.

### Key Features

- **File Upload** — Upload video, audio, and image files to cloud storage
- **Asset Browser** — Browse and search uploaded assets
- **Storage Tracking** — Usage tracked against plan limits
- **Plan Gating** — Access requires `contentLibrary` feature flag on the user's plan

### Technical Implementation

- **R2 Storage** — Assets stored in Cloudflare R2 with signed upload/download URLs
- **Firestore Metadata** — Asset records stored with references to R2 object keys
- **Feature Gating** — `contentLibraryEnabled` flag checked on both client and server

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/editing/assets` | GET | List user assets |
| `/api/editing/assets/upload` | POST | Get signed upload URL |
| `/api/editing/assets/:id` | DELETE | Delete an asset |

---

## Video Editor

### Purpose

Timeline-based video editor for creating productions from recorded streams, uploaded assets, and media clips.

### Key Features

- **Timeline Editing** — Multi-track timeline with video and audio tracks
- **Clip Trimming** — Draggable trim handles for precise in/out point editing
- **Drag-and-Drop** — Clips can be repositioned on the timeline via drag
- **Undo/Redo** — Full undo/redo support (Ctrl+Z / Ctrl+Shift+Z)
- **Project Management** — Create, duplicate, and manage editing projects
- **Export Rendering** — FFmpeg-powered server-side rendering with progress tracking
- **Multiple Formats** — Export to MP4, WebM, or MOV at 720p, 1080p, or 4K

### Technical Implementation

- **Firestore Projects** — Project documents contain timeline state (tracks, clips, positions)
- **Export Queue** — Firestore-backed job queue with transactional claiming
- **Render Worker** — Background FFmpeg worker that polls for queued export jobs
- **R2 Storage** — Source assets downloaded and rendered output uploaded to R2
- **Plan Gating** — `projects` and `editor` feature flags required

### Export Job Lifecycle

```
queued → preparing → rendering → uploading → completed | failed | canceled
```

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/editing/projects` | GET | List user projects |
| `/api/editing/projects` | POST | Create a new project |
| `/api/editing/projects/:id` | GET | Get project details |
| `/api/editing/projects/:id` | PUT | Update project (save timeline) |
| `/api/editing/projects/:id/duplicate` | POST | Duplicate a project |
| `/api/editing/export` | POST | Start an export job |
| `/api/editing/export/:id` | GET | Check export job status |
| `/api/editing/export/:id/cancel` | POST | Cancel an export job |

---

## Recordings

### Purpose

Capture and manage recordings from live room sessions.

### Key Features

- **Automatic Recording** — Recordings captured during HLS egress sessions
- **Cloud Storage** — Recordings stored in Cloudflare R2
- **Post-Stream Summary** — Room exit page displays recording details and options
- **Recording Management** — Browse, download, and delete past recordings

### Technical Implementation

- **LiveKit Egress** — RoomComposite egress captures multi-participant video
- **R2 Storage** — Recording segments and finalized files stored in R2
- **Firestore Metadata** — Recording documents track status, duration, storage URL
- **Emergency Expiration** — Cron job (`cron:expire-emergency`) runs every 10 minutes to clean up stale emergency recordings

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/recordings` | GET | List user recordings |
| `/api/recordings/:id` | GET | Get recording details |
| `/api/recordings/:id` | DELETE | Delete a recording |
| `/api/rooms/:roomId/recordings` | GET | Get recordings for a room |

---

## Billing

### Purpose

Subscription management, payment processing, and usage tracking powered by Stripe.

### Key Features

- **Plan Selection** — Users can choose from Free, Starter, Pro, and Basic plans
- **Stripe Checkout** — Secure payment flow via Stripe Checkout Sessions
- **Usage Tracking** — Monthly usage tracked per user (recording minutes, destinations, etc.)
- **Plan Limits** — Feature and usage limits enforced based on subscription tier
- **Overage Detection** — Usage over plan limits is tracked and can trigger enforcement
- **Scheduled Changes** — Plan downgrades take effect at end of billing period

### Technical Implementation

- **Stripe Integration** — Server-side Stripe SDK for checkout, subscription management, and customer records
- **Webhook Processing** — Stripe webhooks (`customer.subscription.created/updated`) drive billing state changes
- **Firestore State** — User documents store `stripeCustomerId`, `planId`, `billingTruth`, and `scheduledPlanChange`
- **Usage Collections** — `usageMonthly/{uid}_{monthKey}` tracks per-period consumption
- **Usage Gates** — `evaluateUsageGate()` blocks operations when limits are exceeded

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/billing/checkout` | POST | Create Stripe checkout session |
| `/api/billing/portal` | POST | Create Stripe customer portal session |
| `/api/plans` | GET | List available plans |
| `/api/usage` | GET | Get current usage |
| `/api/webhooks/stripe` | POST | Stripe webhook receiver |

---

## Admin Dashboard

### Purpose

Platform-wide administration interface for monitoring, user management, and support.

### Key Features

- **Platform Analytics** — System-wide usage statistics and metrics
- **User Management** — View and manage user accounts
- **Support Tickets** — Manage support requests from users
- **System Diagnostics** — Health checks and diagnostic information
- **Platform Health** — Real-time platform status monitoring
- **Alert Management** — Configure and manage platform alerts

### Technical Implementation

- **Admin Auth** — Admin routes require `isAdmin` flag on user document
- **Firestore Queries** — Aggregated data from users, rooms, recordings, and usage collections
- **Horizon WebSocket** — Real-time admin observability stream

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/admin` | GET | Admin dashboard data |
| `/api/admin/status` | GET | Platform status |
| `/api/diagnostics` | GET | System diagnostics |
| `/api/platformHealth` | GET | Health check |
| `/api/alerts` | GET/POST | Alert management |
| `/api/support` | GET | Support tickets |
| `/api/supportActions` | POST | Support actions |

---

## Guest Access

### Purpose

Allow external participants to join rooms via invite links without requiring a full platform account.

### Key Features

- **Invite Links** — Generate shareable links with embedded invite tokens
- **Role Assignment** — Invites specify the role granted upon joining (host, co-host, participant, guest, viewer)
- **Expiry Control** — Invite tokens have configurable expiration times
- **Max Uses** — Optional limit on how many times an invite link can be used
- **Two Join Paths** — Modern (pre-fetched token) and legacy (on-demand token) flows

### Technical Implementation

- **JWT Invite Tokens** — Cryptographically signed tokens encoding room ID, role, and expiry
- **Cookie-Based Sessions** — Guest sessions maintained via `sl_guest` httpOnly cookies
- **Token Refresh** — Automatic token refresh after LiveKit's 30-minute token expiry
- **Pre-Existing Session Detection** — `hadPreExistingSession` flag distinguishes returning guests from new joins

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/rooms/:roomId/invites` | POST | Create a room invite |
| `/api/rooms/:roomId/invites` | GET | List room invites |
| `/api/invites/resolve/:token` | GET | Resolve invite token details |
| `/api/invites/redeem/:token` | POST | Redeem an invite token |
| `/api/rooms/:roomId/token` | POST | Mint guest access token |

---

## Destinations

### Purpose

Manage RTMP stream destinations for multi-destination broadcasting.

### Key Features

- **Saved Destinations** — Store RTMP endpoint configurations (YouTube, Twitch, Facebook, Instagram, custom)
- **Encrypted Stream Keys** — Stream keys encrypted at rest (AES-256-GCM)
- **Session Destinations** — Temporary destinations for one-time use during a broadcast
- **Multi-Platform Support** — Pre-configured support for major streaming platforms

### Technical Implementation

- **Firestore Storage** — Destination documents in `users/{uid}/destinations` subcollection
- **Encryption** — Stream keys encrypted before storage, decrypted only when building RTMP output
- **Validation** — URL and stream key format validation before save

### APIs

| Endpoint | Method | Description |
|---|---|---|
| `/api/destinations` | GET | List saved destinations |
| `/api/destinations` | POST | Create a destination |
| `/api/destinations/:id` | PUT | Update a destination |
| `/api/destinations/:id` | DELETE | Delete a destination |

---

## Horizon (AI)

### Purpose

AI agent framework for automated room assistance. Horizon listens to room events (chat messages, voice commands) and can execute automated responses and actions.

### Key Features

- **Chat Event Forwarding** — Room chat messages forwarded to Horizon service via webhooks
- **Voice Event Processing** — Voice commands detected and forwarded for AI processing
- **Command Parsing** — Recognizes trigger phrases (`@horizon`, `horizon:`, `hey horizon`)
- **Admin WebSocket** — Real-time observability stream for monitoring Horizon activity

### Technical Implementation

- **External Service** — Horizon runs as a separate service, StreamLine acts as the event conduit
- **Webhook Forwarding** — Chat and voice events forwarded via HTTP with shared secret authentication
- **Retry Logic** — Configurable retries on 5xx responses
- **Command Parser** — `parseCommand()` detects Horizon-directed messages and extracts command text and mentions

### Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `HORIZON_CHAT_EVENT_URL` | Chat event webhook endpoint | `http://10.0.0.27:3000/api/streamline/chat-event` |
| `HORIZON_VOICE_EVENT_URL` | Voice event webhook endpoint | `http://10.0.0.27:3000/api/streamline/voice-event` |
| `HORIZON_WEBHOOK_SECRET` | Shared authentication secret | — |
| `HORIZON_WEBHOOK_TIMEOUT` | Request timeout (ms) | `5000` |
| `HORIZON_WEBHOOK_RETRIES` | Max retries on failure | `2` |
