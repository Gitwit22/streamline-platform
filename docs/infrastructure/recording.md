# Recording System

This document covers StreamLine's recording infrastructure, including how recordings are captured, stored, managed, and accessed.

## Overview

StreamLine records live room sessions using LiveKit's RoomComposite egress system. Recordings are stored as HLS segments in Cloudflare R2 and made available for playback, download, and editing.

## Recording Architecture

```
LiveKit Room (WebRTC)
       │
       ▼
RoomComposite Egress
       │
       ├── H.264/AAC encoding
       ├── Layout compositing (speaker/grid/carousel/pip)
       │
       ▼
HLS Segments → R2 Storage
       │
       ├── hls/<roomId>/room.m3u8     (VOD playlist)
       ├── hls/<roomId>/live.m3u8     (Live sliding window)
       ├── hls/<roomId>/seg-000001.ts (Video segments)
       └── ...
       │
       ▼
Firestore Recording Document
       │
       ├── recordingId
       ├── roomId
       ├── ownerId
       ├── status
       ├── duration
       ├── storageUrl
       └── createdAt
```

## How Recording Works

### Starting a Recording

Recording is initiated when HLS broadcasting starts:

1. Host clicks **Go Live** or starts HLS broadcast
2. Server calls `startHlsEgress()` on LiveKit
3. LiveKit begins RoomComposite egress:
   - Composites all participant tracks according to the active layout
   - Encodes to H.264 video + AAC audio
   - Outputs HLS `.ts` segments to R2 storage
   - Generates `room.m3u8` (full) and `live.m3u8` (sliding window) playlists

### During Recording

While recording is active:

- New segments are continuously written to R2
- Layout changes are reflected in the composite output immediately
- Participant joins/leaves update the composite
- Progress is monitored via egress status

### Stopping a Recording

When the broadcast ends:

1. Host clicks **Stop Broadcast**
2. Server calls `stopEgress()` on LiveKit
3. LiveKit finalizes the last segment
4. Final `room.m3u8` playlist contains all segments
5. Recording document in Firestore is updated with final status and duration

## Storage

### Cloudflare R2

Recordings are stored in Cloudflare R2 (S3-compatible object storage):

| Setting | Value |
|---|---|
| Bucket | Configured via `R2_BUCKET` |
| Path prefix | `hls/<roomId>/` |
| Segment format | MPEG-TS (`.ts`) |
| Playlist format | HLS (`.m3u8`) |
| Access | Pre-signed URLs for download |

### Storage Path Structure

```
r2-bucket/
└── hls/
    └── <roomId>/
        ├── room.m3u8        # Full VOD playlist
        ├── live.m3u8        # Live sliding window playlist
        ├── seg-000001.ts    # Segment 1
        ├── seg-000002.ts    # Segment 2
        └── ...
```

### Recordings Root Prefix

The `R2_RECORDINGS_ROOT_PREFIX` environment variable configures the base path for organized recording storage (default: `recordings/`).

## Recording Management

### Listing Recordings

```
GET /api/recordings
→ Returns all recordings for the authenticated user

GET /api/rooms/:roomId/recordings
→ Returns recordings for a specific room
```

### Viewing a Recording

```
GET /api/recordings/:id
→ Returns recording details (duration, status, URLs)
```

### Deleting a Recording

```
DELETE /api/recordings/:id
→ Deletes recording metadata and associated R2 objects
```

### Post-Stream Summary

After ending a broadcast, the host is directed to:

```
/room-exit/:recordingId
```

This page shows:
- Recording details (duration, date)
- Playback option (HLS player)
- Download link
- Options to import into editing projects

> **Legacy alias**: `/stream-summary/:recordingId` redirects to `/room-exit/:recordingId`

## Emergency Recording Cleanup

A cron job runs every 10 minutes to clean up stale emergency recordings:

```
Schedule: */10 * * * *
Command: npm run cron:expire-emergency
```

This handles edge cases where:
- A broadcast was interrupted without proper cleanup
- Egress failed but recording documents remain
- Orphaned segments need to be cleaned up

The cron job requires the `MAINTENANCE_KEY` environment variable for authentication.

## Recording and Plans

Recording availability is gated by subscription plan:

| Plan | Recording Available |
|---|---|
| Free | ❌ |
| Starter | ✅ |
| Pro | ✅ |
| Basic | ✅ |

### Usage Limits

Plans define recording limits:

| Limit | Description |
|---|---|
| `monthlyMinutes` | Maximum recording minutes per month |
| `concurrentRecordings` | Maximum simultaneous recordings |

Usage is tracked in the `usageMonthly` collection and enforced via `evaluateUsageGate()`.

## Multi-Camera Recording

StreamLine's recording system supports multi-camera setups:

- Each participant's camera is a separate video source
- The RoomComposite layout determines how cameras are arranged
- Layout switches during recording are reflected in the output
- Screen shares are included as additional video sources

### Layout Modes in Recording

| Layout | Recording Output |
|---|---|
| Speaker | Active speaker large, others in sidebar |
| Grid | Equal-sized tiles for all cameras |
| Carousel | Scrollable view with featured camera |
| PIP | Main camera with small overlay |

## Playback

### Live Playback

During a broadcast, viewers connect to the live HLS playlist:

```
GET /api/public/hls/:roomId → live.m3u8
```

The sliding window playlist shows the most recent segments for near-live viewing.

### VOD Playback

After the broadcast ends, the full VOD playlist is available:

```
GET /api/public/hls/:roomId → room.m3u8
```

This contains all segments from the entire recording session.

### Client Playback

The client uses HLS.js for adaptive streaming playback in the browser, supporting:
- Automatic quality adaptation
- Seek and scrub through VOD recordings
- Full-screen playback
