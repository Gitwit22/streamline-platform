# Video Pipeline

This document describes StreamLine's video processing pipeline, covering the full lifecycle from live capture to recording, editing, and export.

## Pipeline Overview

```
Live Room Session
       │
       ▼
┌──────────────────┐
│ LiveKit WebRTC   │ ← Real-time video/audio from participants
│ Room             │
└────────┬─────────┘
         │
    ┌────┴────────────────────────────────────┐
    │                                          │
    ▼                                          ▼
┌──────────────┐                    ┌──────────────────┐
│ RoomComposite│                    │ Stream Output    │
│ HLS Egress   │                    │ RTMP Egress      │
└──────┬───────┘                    └──────┬───────────┘
       │                                    │
       ▼                                    ▼
┌──────────────┐                    ┌──────────────────┐
│ R2 Storage   │                    │ External         │
│ HLS Segments │                    │ Platforms        │
│ Playlists    │                    │ (YT, Twitch...)  │
└──────┬───────┘                    └──────────────────┘
       │
       ▼
┌──────────────┐
│ Content      │
│ Library      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Video Editor │
│ (Timeline)   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Export Queue  │
│ (Firestore)  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Render Worker│
│ (FFmpeg)     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Final Output │
│ (R2 Storage) │
└──────────────┘
```

## Stage 1: Live Capture

### WebRTC Room

All video originates in LiveKit WebRTC rooms:

- Participants publish video/audio tracks
- Multiple cameras supported (one per participant)
- Screen sharing adds additional video tracks
- Audio is mixed from all unmuted participants

### Real-Time Compositing

LiveKit RoomComposite combines all tracks into a single video stream:

| Parameter | Value |
|---|---|
| Codec | H.264 + AAC |
| Default Resolution | 720p (1280×720) |
| Higher Resolutions | Plan-gated (1080p, 4K) |
| Frame Rate | 30fps |
| Layout | Speaker, Grid, Carousel, PIP |

## Stage 2: HLS Delivery

### Segmentation

The composite video is segmented for HLS delivery:

```
Output: hls/<roomId>/
├── room.m3u8       # Full VOD playlist (all segments)
├── live.m3u8       # Sliding window playlist (live viewers)
├── seg-000001.ts   # Video segment 1
├── seg-000002.ts   # Video segment 2
└── ...
```

### Storage

HLS segments are stored in Cloudflare R2:

- **Bucket**: Configured via `R2_BUCKET` environment variable
- **Path prefix**: `hls/<roomId>/`
- **Access**: Public HLS endpoint serves playlists without authentication
- **CDN**: R2 provides built-in CDN for segment delivery

### Playback

- **Live viewers**: Connect to `live.m3u8` for sliding window playback
- **VOD**: After stream ends, `room.m3u8` contains the complete recording
- **Client**: HLS.js library handles adaptive streaming in the browser

## Stage 3: RTMP Restreaming

### Multi-Destination Output

For simultaneous broadcasting to external platforms:

```
RoomComposite → StreamOutput → RTMP Destinations
                                 ├── YouTube Live
                                 ├── Twitch
                                 ├── Facebook Live
                                 ├── Instagram Live
                                 └── Custom RTMP
```

### Stream Key Security

- Stream keys are **encrypted at rest** using AES-256-GCM
- Keys are decrypted only when building RTMP output URLs
- Encryption key derived from server-side secret

### Health Monitoring

- Egress health is monitored during active streams
- Auto-retry on transient failures
- Status reported to room controls UI

## Stage 4: Content Library

After recording:

1. HLS segments and playlists are retained in R2
2. Recording metadata is stored in Firestore
3. Recordings appear in the user's Content Library
4. Assets can be imported into editing projects

## Stage 5: Timeline Editing

### Project Structure

```typescript
{
  tracks: [
    {
      kind: "video",
      clips: [
        {
          startMs: 0,          // Timeline position
          endMs: 30000,        // Timeline end
          sourceInMs: 5000,    // Source trim start
          sourceOutMs: 35000,  // Source trim end
          sourceUrl: "r2://..."
        }
      ]
    },
    {
      kind: "audio",
      clips: [...]
    }
  ]
}
```

### Editing Operations

| Operation | Description |
|---|---|
| Clip trimming | Adjust source in/out points via drag handles |
| Clip moving | Reposition clips on timeline via drag |
| Multi-track | Separate video and audio tracks |
| Undo/Redo | Full state history (Ctrl+Z / Ctrl+Shift+Z) |

## Stage 6: Export Rendering

### Queue System

Export jobs are managed via a Firestore-backed queue:

1. Client submits export request
2. Job document created with `status: "queued"`
3. Render worker claims job transactionally
4. Worker processes through rendering stages
5. Output uploaded to R2

### FFmpeg Rendering

The render worker builds FFmpeg commands from timeline data:

```
Input: Timeline definition (tracks, clips, positions)
    │
    ├── Download source clips from R2 (signed URLs)
    │
    ├── Build FFmpeg filter graph
    │   (concat, trim, overlay, scale)
    │
    ├── Execute FFmpeg render
    │   (progress reported via job document)
    │
    └── Upload output to R2
```

### Output Formats

| Format | Codec | Container |
|---|---|---|
| MP4 | H.264 + AAC | MPEG-4 |
| WebM | VP9 + Opus | WebM |
| MOV | H.264 + AAC | QuickTime |

### Resolution Options

| Setting | Dimensions |
|---|---|
| 720p | 1280 × 720 |
| 1080p | 1920 × 1080 |
| 4K | 3840 × 2160 |

### Quality Presets

| Preset | Description |
|---|---|
| Draft | Fast render, lower quality (preview) |
| Standard | Balanced quality and speed |
| High | Maximum quality, slower render |

## Performance Considerations

### Live Streaming

- WebRTC provides sub-second latency for interactive sessions
- HLS adds 5-15 seconds of latency for broadcast viewers
- RTMP restreaming adds platform-specific latency

### Recording

- HLS segments are written continuously during broadcast
- No post-processing required for basic recording
- Composite resolution matches the configured preset

### Export Rendering

- CPU-bound FFmpeg processing
- Worker polls queue every 5 seconds (configurable via `EXPORT_WORKER_POLL_MS`)
- Single worker process per server instance
- Progress tracked in real-time via Firestore document updates
