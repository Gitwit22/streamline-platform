# Rooms

Rooms are the core real-time interaction unit in StreamLine. Every live session — whether a video call, broadcast, or event — takes place inside a room.

## Overview

A StreamLine room is a LiveKit-backed WebRTC session that supports:

- Multi-participant video and audio communication
- Role-based permissions per participant
- Configurable access policies (public, private, invite-only)
- Multiple presence modes (normal, silent, invisible)
- Real-time layout management
- Integrated chat, recording, and broadcasting

## Room Types

| Type | Description |
|---|---|
| **RTC** | Full WebRTC room with interactive audio/video for all participants |
| **HLS** | Broadcast-oriented room optimized for HLS delivery to large audiences |

## Creating a Room

Hosts create rooms via the dashboard or API:

```
POST /api/rooms/create
Body: {
  livekitRoomName?: string,    // Optional custom room name
  roomType: "rtc" | "hls",     // Room type
  presenceMode: "normal",      // Default presence mode
  visibility: "public",        // Access visibility
  requiresAuth?: boolean,      // Require authentication to join
  requiresPayment?: boolean,   // Require payment to access
  savedEmbedId?: string        // Link to saved viewer embed
}

Response: {
  roomId: string,
  livekitRoomName: string,
  roomType: string,
  presenceMode: string
}
```

## Joining a Room

### Authenticated Users

1. User navigates to `/room/:roomId`
2. Client calls `POST /api/rooms/:roomId/token` with authentication
3. Server verifies permissions and mints a LiveKit access token
4. Client connects to LiveKit using the minted token
5. User's video/audio tracks are published based on permissions

### Guest Users

1. Guest receives an invite link (`/i/:inviteToken` or `/join/:roomId`)
2. Client resolves the invite token to get room details
3. Server mints a guest access token with invite-specified role
4. Guest connects to LiveKit with limited permissions
5. Guest session is maintained via `sl_guest` httpOnly cookie

## Room Visibility

| Visibility | Description |
|---|---|
| **Public** | Anyone can discover and join the room |
| **Unlisted** | Only accessible via direct link |
| **Private** | Requires invite token to join |

## Participant Roles

| Role | Publish Audio | Publish Video | Screen Share | Mute Others | Remove Others | Start Stream |
|---|---|---|---|---|---|---|
| **Host** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Co-Host** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Participant** | ✅ | ✅ | Configurable | ❌ | ❌ | ❌ |
| **Guest** | Configurable | Configurable | ❌ | ❌ | ❌ | ❌ |
| **Viewer** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Permissions are encoded into the LiveKit access token at join time and enforced by both the LiveKit server and the StreamLine API.

## Presence Modes

Presence modes control how a participant appears in the room:

| Mode | Visible in Roster | Can Send Chat | Audio/Video |
|---|---|---|---|
| **Normal** | ✅ | ✅ | Based on role |
| **Silent** | ✅ | ❌ | Disabled |
| **Invisible** | ❌ | ❌ | Disabled |

Presence mode is set during room creation or per-participant at join time. The mode is encoded in LiveKit token metadata.

## Room Policies

Room policies define access requirements:

- **Authentication Required** — Visitors must be logged in
- **Payment Required** — Access requires an active subscription or payment
- **Invite Required** — Only users with valid invite tokens can join
- **Host-Only Moderation** — Only the host can moderate (configurable via `ROOM_MODERATION_HOST_ONLY`)

## Chat

Each room includes an integrated chat system:

- Real-time messages via LiveKit data channels
- Server-side chat API for message persistence
- Moderation controls for hosts and co-hosts
- Chat permission controlled by presence mode

See [Messaging](./messaging.md) for details.

## Recording

Rooms support recording via HLS egress:

- Recording starts when HLS broadcast is initiated
- Composite video of all participants is captured
- Recordings stored in R2 and linked to the room
- Post-session recording accessible via Room Exit Page

See [Broadcast Studio](./broadcast-studio.md) for details.
