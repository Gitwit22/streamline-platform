# API Reference

This document provides a comprehensive reference for all StreamLine API endpoints. All endpoints are prefixed with `/api` and served by the Express.js backend.

## Authentication

Most endpoints require authentication via one of:
- **Authorization header**: `Bearer <firebase-id-token>` or `Bearer <legacy-jwt>`
- **Session cookie**: `token` (httpOnly, set during login)

Endpoints marked with 🔓 require authentication. Endpoints marked with 🌐 are public.

---

## Auth

### Login

🌐 `POST /api/auth/login`

Authenticate a user and receive a session token.

**Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "jwt-session-token",
  "user": {
    "uid": "abc123",
    "email": "user@example.com",
    "displayName": "User Name"
  }
}
```

**Notes:**
- Password verified via Firestore `passwordHash` (bcrypt)
- Legacy users without `passwordHash` fall back to Firebase Identity Toolkit REST API, then migrate hash to Firestore
- Sets httpOnly session cookie

### Signup

🌐 `POST /api/auth/signup`

Create a new user account.

**Body:**
```json
{
  "email": "newuser@example.com",
  "password": "securePassword123",
  "displayName": "New User"
}
```

**Response:**
```json
{
  "token": "jwt-session-token",
  "user": {
    "uid": "new-uid",
    "email": "newuser@example.com",
    "displayName": "New User"
  }
}
```

### Logout

🔓 `POST /api/auth/logout`

End the current session.

**Response:** `200 OK` with cleared session cookie.

---

## Rooms

### Create Room

🔓 `POST /api/rooms/create`

Create a new room.

**Body:**
```json
{
  "livekitRoomName": "my-room",
  "roomType": "rtc",
  "presenceMode": "normal",
  "visibility": "public",
  "requiresAuth": false,
  "requiresPayment": false,
  "savedEmbedId": null
}
```

**Response:**
```json
{
  "roomId": "firestore-generated-id",
  "livekitRoomName": "my-room",
  "roomType": "rtc",
  "presenceMode": "normal"
}
```

### Get Room Token

🔓 `POST /api/rooms/:roomId/token`

Mint a LiveKit access token for joining a room.

**Headers:**
- `Authorization: Bearer <token>` or session cookie
- `X-Invite-Token: <invite-jwt>` (for guest access)

**Response:**
```json
{
  "token": "livekit-access-token",
  "identity": "user-identity",
  "role": "host"
}
```

### Resolve Room

🌐 `GET /api/rooms/:roomId/resolve`

Get room information and access requirements.

**Response:**
```json
{
  "roomId": "room-id",
  "roomType": "rtc",
  "visibility": "public",
  "requiresAuth": false,
  "requiresPayment": false,
  "isLive": true
}
```

### Update Room Layout

🔓 `PUT /api/rooms/:roomId/layout`

Change the room's layout mode.

**Body:**
```json
{
  "mode": "speaker"
}
```

**Modes:** `speaker`, `grid`, `carousel`, `pip`

### Update Room Policy

🔓 `PUT /api/rooms/:roomId/policy`

Update room access policies.

**Body:**
```json
{
  "visibility": "private",
  "requiresAuth": true,
  "requiresPayment": false
}
```

---

## Room Controls

### Start HLS Broadcast

🔓 `POST /api/rooms/:roomId/controls/start-hls`

Start HLS broadcasting for the room.

**Response:**
```json
{
  "egressId": "egress-id",
  "hlsUrl": "https://cdn.example.com/hls/room-id/live.m3u8"
}
```

### Stop HLS Broadcast

🔓 `POST /api/rooms/:roomId/controls/stop-hls`

Stop the active HLS broadcast.

### Start Multistream

🔓 `POST /api/rooms/:roomId/start-multistream`

Start multi-destination RTMP streaming.

**Response:**
```json
{
  "egressId": "egress-id",
  "destinations": [
    { "name": "YouTube", "platform": "youtube", "status": "active" }
  ]
}
```

### Stop Multistream

🔓 `POST /api/rooms/:roomId/stop-multistream`

Stop all RTMP output streams.

---

## Room Chat

### Send Message

🔓 `POST /api/rooms/:roomId/chat`

Send a chat message to the room.

**Body:**
```json
{
  "message": "Hello, everyone!"
}
```

### Get Chat History

🔓 `GET /api/rooms/:roomId/chat/history`

Retrieve chat history for the room.

---

## Room Invites

### Create Invite

🔓 `POST /api/rooms/:roomId/invites`

Create an invite link for the room.

**Body:**
```json
{
  "role": "participant",
  "maxUses": 10,
  "expiresInHours": 24
}
```

**Response:**
```json
{
  "inviteToken": "jwt-invite-token",
  "inviteUrl": "https://app.example.com/i/jwt-invite-token"
}
```

### List Invites

🔓 `GET /api/rooms/:roomId/invites`

List all invites for a room.

---

## Guest Access

### Resolve Invite Token

🌐 `GET /api/invites/resolve/:token`

Resolve an invite token to get room details.

**Response:**
```json
{
  "roomId": "room-id",
  "role": "participant",
  "roomName": "My Room",
  "isValid": true
}
```

### Redeem Invite

🌐 `POST /api/invites/redeem/:token`

Redeem an invite token and get room access.

---

## HLS

### Public HLS Playlist

🌐 `GET /api/public/hls/:roomId`

Get the HLS playlist for a live room (no authentication required).

### HLS Config

🔓 `PUT /api/rooms/:roomId/hls-config`

Update HLS configuration for a room.

---

## Recordings

### List Recordings

🔓 `GET /api/recordings`

List all recordings for the authenticated user.

### Get Recording

🔓 `GET /api/recordings/:id`

Get details for a specific recording.

### Delete Recording

🔓 `DELETE /api/recordings/:id`

Delete a recording.

### Room Recordings

🔓 `GET /api/rooms/:roomId/recordings`

Get recordings for a specific room.

---

## Editing

### Assets

🔓 `GET /api/editing/assets` — List user assets

🔓 `POST /api/editing/assets/upload` — Get signed upload URL

🔓 `DELETE /api/editing/assets/:id` — Delete an asset

### Projects

🔓 `GET /api/editing/projects` — List projects

🔓 `POST /api/editing/projects` — Create a project

🔓 `GET /api/editing/projects/:id` — Get project details

🔓 `PUT /api/editing/projects/:id` — Update project timeline

🔓 `DELETE /api/editing/projects/:id` — Delete a project

🔓 `POST /api/editing/projects/:id/duplicate` — Duplicate a project

### Export

🔓 `POST /api/editing/export` — Start an export job

**Body:**
```json
{
  "projectId": "project-id",
  "settings": {
    "resolution": "1080p",
    "format": "mp4",
    "quality": "standard"
  }
}
```

**Response:**
```json
{
  "id": "export-job-id",
  "status": "queued"
}
```

🔓 `GET /api/editing/export/:id` — Check export status

**Response:**
```json
{
  "id": "export-job-id",
  "status": "rendering",
  "progressPercent": 45,
  "currentStep": "rendering",
  "outputUrl": null,
  "errorMessage": null
}
```

🔓 `POST /api/editing/export/:id/cancel` — Cancel an export

---

## Billing

### Create Checkout Session

🔓 `POST /api/billing/checkout`

**Query:** `?planId=starter`

**Response:**
```json
{
  "sessionUrl": "https://checkout.stripe.com/session/..."
}
```

### Create Customer Portal Session

🔓 `POST /api/billing/portal`

Redirect to Stripe customer portal for subscription management.

### List Plans

🌐 `GET /api/plans`

Get available subscription plans.

**Response:**
```json
[
  {
    "id": "free",
    "name": "Free",
    "priceMonthly": 0,
    "features": { "recording": false, "hls": false },
    "limits": { "monthlyMinutes": 60 }
  },
  {
    "id": "starter",
    "name": "Starter",
    "priceMonthly": 9.99,
    "features": { "recording": true, "hls": true },
    "limits": { "monthlyMinutes": 300 }
  }
]
```

### Get Usage

🔓 `GET /api/usage`

Get current month's usage for the authenticated user.

---

## Destinations

🔓 `GET /api/destinations` — List saved RTMP destinations

🔓 `POST /api/destinations` — Create a destination

🔓 `PUT /api/destinations/:id` — Update a destination

🔓 `DELETE /api/destinations/:id` — Delete a destination

---

## Admin

All admin endpoints require `isAdmin` flag on the user document.

🔓 `GET /api/admin` — Admin dashboard data

🔓 `GET /api/admin/status` — Platform status

🔓 `GET /api/diagnostics` — System diagnostics

🔓 `GET /api/platformHealth` — Platform health check

🔓 `GET /api/alerts` — List alerts

🔓 `POST /api/alerts` — Create/manage alerts

🔓 `GET /api/support` — List support tickets

🔓 `POST /api/supportActions` — Execute support actions

---

## Feature Access

🔓 `GET /api/featureAccess`

Check feature access for the authenticated user based on their plan.

**Response:**
```json
{
  "contentLibrary": true,
  "projects": true,
  "editor": false,
  "hls": true,
  "multistream": false,
  "recording": true,
  "advancedPermissions": false
}
```

---

## Onboarding

### Create EDU Organization

🌐 `POST /api/onboarding/create-edu-org`

Create a new EDU organization with a faculty admin user.

**Body:**
```json
{
  "orgName": "Springfield Elementary",
  "orgType": "edu",
  "email": "admin@school.edu",
  "password": "securePassword"
}
```

---

## Health and Telemetry

🌐 `GET /api/health` — Basic health check

🌐 `GET /api/platformHealth` — Detailed platform health

🔓 `POST /api/telemetry` — Submit telemetry events

🔓 `GET /api/stats` — Analytics data

---

## Webhooks

### Stripe Webhook

🌐 `POST /api/webhooks/stripe`

Receives Stripe webhook events. Requires valid Stripe signature.

**Events handled:**
- `customer.subscription.created` — New subscription activation
- `customer.subscription.updated` — Subscription changes (upgrade/downgrade)
- `customer.subscription.deleted` — Subscription cancellation
- `invoice.paid` — Successful payment
- `invoice.payment_failed` — Failed payment

> **Note**: This endpoint is registered _before_ the JSON body parser to receive the raw request body for Stripe signature verification.
