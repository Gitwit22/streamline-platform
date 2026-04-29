# Messaging

StreamLine's messaging system provides real-time chat within rooms, with support for moderation and role-based access controls.

## Overview

Chat is integrated into every StreamLine room session. Messages are delivered in real-time via LiveKit data channels and can be moderated by hosts and co-hosts.

## In-Room Chat

### Sending Messages

- Participants with `canSendChat` permission can send messages
- Messages are delivered to all room participants via LiveKit data channels
- Server-side API endpoint validates sender permissions before broadcast

### Chat Permissions

Chat access is controlled by the participant's role and presence mode:

| Presence Mode | Can Send Chat |
|---|---|
| Normal | ✅ (if role allows) |
| Silent | ❌ |
| Invisible | ❌ |

Hosts and co-hosts always have chat access. Participants have chat access in normal presence mode. Guests and viewers have limited or no chat access depending on room configuration.

## Moderation

### Host Controls

- **Message deletion** — Hosts can remove inappropriate messages
- **Participant muting** — Hosts can prevent specific users from chatting
- **Host-only mode** — When `ROOM_MODERATION_HOST_ONLY` is enabled, only the room host can perform moderation actions

### Co-Host Controls

Unless host-only moderation is enabled:
- Co-hosts can delete messages
- Co-hosts can mute disruptive participants

## Chat API

| Endpoint | Method | Description |
|---|---|---|
| `/api/rooms/:roomId/chat` | POST | Send a chat message (server-validated) |
| `/api/rooms/:roomId/chat/history` | GET | Retrieve chat message history |

## Technical Details

- **Transport**: LiveKit data channels for real-time delivery
- **Persistence**: Messages can be retrieved via the chat history API
- **Authentication**: Sender identity verified via room access token
- **Rate limiting**: Server-side validation prevents message flooding
