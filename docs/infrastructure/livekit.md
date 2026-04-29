# LiveKit Integration

This document describes how StreamLine integrates with LiveKit for real-time video/audio communication, recording, and streaming.

## Overview

StreamLine uses [LiveKit](https://livekit.io) as its core real-time media infrastructure. LiveKit provides:

- **WebRTC Rooms** — Low-latency video/audio communication
- **Server SDK** — Room management, token generation, egress control
- **RoomComposite Egress** — Server-side video compositing for recording and streaming
- **Data Channels** — Real-time messaging between participants

## Architecture

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  StreamLine  │       │  StreamLine  │       │   LiveKit    │
│   Client     │◄─────►│   Server     │──────►│   Server     │
│  (React)     │       │  (Express)   │       │   (WebRTC)   │
└──────┬───────┘       └──────────────┘       └──────┬───────┘
       │                                              │
       │         WebRTC Media Streams                 │
       └──────────────────────────────────────────────┘
```

### Client-Side

- **`@livekit/components-react`** — React components for video grid, controls, chat
- **`livekit-client`** — Core LiveKit client SDK for room connection and track management

### Server-Side

- **`livekit-server-sdk` (v2.6.1)** — Server SDK for:
  - Access token generation
  - Room management (create, list, delete)
  - Egress control (HLS, RTMP, recording)
  - Participant management

### Key Server Files

| File | Purpose |
|---|---|
| `livekitClient.ts` | LiveKit server SDK client initialization |
| `lib/livekit.ts` | Dynamic SDK import utility |
| `lib/livekitPermissions.ts` | Role → LiveKit permission grant mapping |
| `services/livekitEgress.ts` | HLS/recording egress management |

## Room Lifecycle

### 1. Room Creation

```
Host calls POST /api/rooms/create
    │
    ├── Generate Firestore room document
    │   (roomId, ownerId, livekitRoomName, roomType, visibility)
    │
    └── LiveKit room is created lazily when first participant joins
```

### 2. Token Generation

```
User calls POST /api/rooms/:roomId/token
    │
    ├── Verify user authentication
    │
    ├── Determine role (host, co-host, participant, guest, viewer)
    │
    ├── Map role → LiveKit permission grants
    │   (canPublish, canSubscribe, canPublishData, etc.)
    │
    ├── Add presence metadata to token
    │   (presenceMode, isVisibleInRoster, canSendChat)
    │
    └── Return signed LiveKit AccessToken
```

### 3. Room Connection

```
Client receives access token
    │
    ├── Connect to LiveKit WSS endpoint
    │
    ├── Publish local tracks (audio, video) based on permissions
    │
    ├── Subscribe to remote tracks (other participants)
    │
    └── Render video grid using @livekit/components-react
```

### 4. Token Refresh

LiveKit access tokens expire after 30 minutes. The client automatically refreshes:

```
Token approaching expiry
    │
    ├── Client detects token nearing expiry
    │
    ├── POST /api/rooms/:roomId/token (with existing session cookie)
    │
    ├── Server mints new token (same role, updated expiry)
    │
    └── Client reconnects with new token (seamless for user)
```

## Permission Mapping

The server maps StreamLine roles to LiveKit permission grants:

```typescript
// lib/livekitPermissions.ts

Host → {
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,    // Data channels (chat)
  canUpdateOwnMetadata: true
}

Co-Host → {
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
  canUpdateOwnMetadata: true
}

Participant → {
  canPublish: true,
  canSubscribe: true,
  canPublishData: true,
  canUpdateOwnMetadata: false
}

Guest → {
  canPublish: configurable,    // Based on room settings
  canSubscribe: true,
  canPublishData: configurable,
  canUpdateOwnMetadata: false
}

Viewer → {
  canPublish: false,
  canSubscribe: true,
  canPublishData: false,
  canUpdateOwnMetadata: false
}
```

## Presence Modes

Presence mode adds metadata to the LiveKit token that controls visibility and interaction:

```typescript
// lib/presenceMode.ts

Normal → {
  presenceMode: "normal",
  isVisibleInRoster: true,
  canSendChat: true
}

Silent → {
  presenceMode: "silent",
  isVisibleInRoster: true,
  canSendChat: false
}

Invisible → {
  presenceMode: "invisible",
  isVisibleInRoster: false,
  canSendChat: false
}
```

Client-side filtering uses `extractPresenceMetadata()` from `roles.ts` to read these fields from participant metadata.

## Egress (Recording & Streaming)

### HLS Egress

Server-side HLS recording using RoomComposite:

```typescript
// services/livekitEgress.ts → startHlsEgress()

Configuration:
- Layout: "speaker" or "grid" (with "-dark" suffix)
- Segments: SegmentedFileOutput to R2/S3
- Playlists:
  - room.m3u8 — Full VOD playlist
  - live.m3u8 — Sliding window for live viewers
- Storage: R2 at hls/<roomId>/seg-*
- Encoding: H.264/AAC, default 720p
```

### RTMP Streaming Egress

Multi-destination RTMP output using StreamOutput:

```typescript
// routes/multistream.ts

Configuration:
- Multiple RTMP destinations (YouTube, Twitch, etc.)
- Stream keys decrypted from AES-256-GCM storage
- Layout: "grid-dark" (default for broadcast)
- Encoding: Plan-gated resolution presets
- Health monitoring with auto-retry
```

### Egress Lifecycle

```
Start Egress → LiveKit begins compositing
    │
    ├── All participant tracks composited per layout mode
    │
    ├── Encoded to H.264/AAC
    │
    ├── Output to HLS segments (R2) and/or RTMP destinations
    │
    ├── Monitor egress health
    │
    └── Stop Egress → Finalize recording, close RTMP connections
```

## Configuration

### Required Environment Variables

| Variable | Description |
|---|---|
| `LIVEKIT_URL` | LiveKit server WebSocket URL (`wss://...`) |
| `LIVEKIT_API_KEY` | LiveKit API key for server SDK authentication |
| `LIVEKIT_API_SECRET` | LiveKit API secret for token signing |

### Client Environment

| Variable | Description |
|---|---|
| `VITE_LIVEKIT_URL` | LiveKit server URL for client-side connection |

## Layout Modes

LiveKit RoomComposite supports these layout modes for recording and streaming:

| Mode | Description | Layout Variant |
|---|---|---|
| Speaker | Active speaker highlighted | `speaker`, `speaker-dark` |
| Grid | Equal-sized tiles | `grid`, `grid-dark` |
| Carousel | Scrollable participant list | `carousel` |
| PIP | Picture-in-Picture | `pip` |

Layout changes during a session are applied in real-time to the composite output.

## Data Channels

LiveKit data channels are used for:

- **Chat messages** — Real-time text delivery between participants
- **Room state updates** — Layout changes, participant updates
- **Moderation actions** — Mute/unmute notifications

Data channel access is controlled by the `canPublishData` permission grant.
