# Export Rendering

This document covers StreamLine's video export rendering system, which processes timeline-based video editing projects into final output files.

## Overview

The export rendering system takes timeline definitions from the video editor and renders them into finished video files using FFmpeg. It uses a Firestore-backed job queue with a background worker process that runs alongside the main server.

## Architecture

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   Client     │       │   Server     │       │  Render      │
│   (Editor)   │──────►│   (API)      │──────►│  Worker      │
│              │       │              │       │  (FFmpeg)    │
└──────────────┘       └──────┬───────┘       └──────┬───────┘
                              │                       │
                              ▼                       ▼
                       ┌──────────────┐       ┌──────────────┐
                       │  Firestore   │       │  R2 Storage  │
                       │  Job Queue   │       │  (Source +   │
                       │              │       │   Output)    │
                       └──────────────┘       └──────────────┘
```

## Job Queue

### Queue Implementation

The export queue is backed by Firestore with transactional job claiming:

**File**: `streamline-server/lib/exportQueue.ts`

```
No Redis, no external queue service — Firestore transactions ensure exactly-once job claiming.
```

### Job Document Structure

Each export job is a Firestore document:

```typescript
{
  id: string;
  userId: string;
  projectId: string;
  status: "queued" | "preparing" | "rendering" | "uploading" | "completed" | "failed" | "canceled";
  settings: {
    resolution: "720p" | "1080p" | "4k";
    format: "mp4" | "webm" | "mov";
    quality: "draft" | "standard" | "high";
  };
  timeline: {
    width: number;
    height: number;
    fps: number;
    tracks: ExportTimelineTrack[];
  };
  progressPercent: number;
  currentStep: string;
  outputUrl: string | null;
  errorMessage: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  claimedAt: Timestamp | null;
  completedAt: Timestamp | null;
}
```

### Job States

```
         ┌──────────┐
         │  queued   │ ← Client submits export
         └────┬─────┘
              │
              ▼
         ┌──────────┐
         │preparing  │ ← Worker claims job, downloads sources
         └────┬─────┘
              │
              ▼
         ┌──────────┐
         │rendering  │ ← FFmpeg processing
         └────┬─────┘
              │
              ▼
         ┌──────────┐
         │uploading  │ ← Output file uploaded to R2
         └────┬─────┘
              │
         ┌────┴────┐
         ▼         ▼
    ┌─────────┐  ┌──────┐
    │completed│  │failed│
    └─────────┘  └──────┘

    ┌──────────┐
    │ canceled │ ← User cancels non-terminal job
    └──────────┘
```

**Terminal states**: `completed`, `failed`, `canceled`

## Render Worker

### Worker Lifecycle

**File**: `streamline-server/lib/renderWorker.ts`

The render worker starts at server boot (unless `EXPORT_WORKER_ENABLED=0`):

```
Server Start
    │
    ├── if EXPORT_WORKER_ENABLED ≠ 0:
    │       Start render worker loop
    │
    └── Worker polls every EXPORT_WORKER_POLL_MS (default: 5000ms)
            │
            ├── Query Firestore for oldest "queued" job
            │
            ├── Claim job (Firestore transaction)
            │   (status: queued → preparing)
            │
            ├── Download source clips from R2
            │   (signed download URLs)
            │
            ├── Build FFmpeg command from timeline
            │   (status: preparing → rendering)
            │
            ├── Execute FFmpeg render
            │   (progressPercent updated periodically)
            │
            ├── Upload output to R2
            │   (status: rendering → uploading)
            │
            ├── Update job document
            │   (status: uploading → completed, outputUrl set)
            │
            └── Loop (poll for next job)
```

### Transactional Claiming

Job claiming uses Firestore transactions to prevent duplicate processing:

1. Worker reads oldest `queued` job within a transaction
2. Atomically updates status to `preparing` and sets `claimedAt`
3. If another worker already claimed the job, the transaction fails and retries
4. This guarantees exactly-once processing without external coordination

### Progress Tracking

During rendering, the worker updates the job document with:

- `currentStep` — Human-readable step description
- `progressPercent` — 0-100 progress indicator
- `updatedAt` — Timestamp of last update

The client polls `GET /api/editing/export/:id` to display progress.

## FFmpeg Processing

### Command Construction

The worker builds FFmpeg commands from timeline definitions:

```
Timeline → FFmpeg filter graph
    │
    ├── Input: Source clips (downloaded from R2)
    │
    ├── Filters:
    │   ├── trim (source in/out points)
    │   ├── scale (output resolution)
    │   ├── concat (sequential clips)
    │   └── overlay (multi-track compositing)
    │
    └── Output: Rendered file in specified format
```

### Output Configuration

| Setting | Options | Default |
|---|---|---|
| Resolution | 720p, 1080p, 4K | 720p |
| Format | MP4, WebM, MOV | MP4 |
| Quality | Draft, Standard, High | Standard |
| Video Codec | H.264 (MP4/MOV), VP9 (WebM) | H.264 |
| Audio Codec | AAC (MP4/MOV), Opus (WebM) | AAC |

### Timeline Processing

Each clip in the timeline is processed:

```typescript
{
  startMs: number,      // Timeline position (where clip starts on timeline)
  endMs: number,        // Timeline end (where clip ends on timeline)
  sourceInMs: number,   // Source trim start (in-point within source file)
  sourceOutMs: number,  // Source trim end (out-point within source file)
  sourceUrl: string     // R2 signed download URL for source file
}
```

Multiple clips across video and audio tracks are composited according to the timeline layout.

## API Reference

### Start Export

```
POST /api/editing/export
Body: {
  "projectId": "project-id",
  "settings": {
    "resolution": "1080p",
    "format": "mp4",
    "quality": "standard"
  }
}

Response: {
  "id": "export-job-id",
  "status": "queued"
}
```

### Check Status

```
GET /api/editing/export/:id

Response: {
  "id": "export-job-id",
  "status": "rendering",
  "progressPercent": 45,
  "currentStep": "Rendering video track",
  "outputUrl": null,
  "errorMessage": null
}
```

### Cancel Export

```
POST /api/editing/export/:id/cancel

Response: {
  "id": "export-job-id",
  "status": "canceled"
}
```

Only non-terminal jobs can be canceled (queued, preparing, rendering, uploading).

## Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `EXPORT_WORKER_ENABLED` | Enable the background render worker | `1` (enabled) |
| `EXPORT_WORKER_POLL_MS` | Queue poll interval in milliseconds | `5000` |
| `FFMPEG_PATH` | Path to FFmpeg binary | `ffmpeg` |
| `FFPROBE_PATH` | Path to FFprobe binary | `ffprobe` |
| `PLATFORM_TRANSCODE_ENABLED` | Enable transcode feature gate | `true` |

## Error Handling

### Job Failures

If rendering fails:

1. Worker catches the error
2. Job status set to `failed`
3. `errorMessage` populated with a description (no stack traces exposed)
4. Worker continues polling for the next job

### Common Failure Causes

| Cause | Description |
|---|---|
| Source unavailable | Source clip URL expired or file deleted |
| FFmpeg error | Encoding failure, unsupported format |
| Storage error | R2 upload failure |
| Timeout | Processing exceeded time limit |

### Cancellation

Users can cancel exports via `POST /api/editing/export/:id/cancel`:

- **Queued jobs**: Immediately marked as `canceled`
- **In-progress jobs**: Worker checks cancellation flag during processing
- **Terminal jobs**: Cannot be canceled (already completed, failed, or canceled)

## Validation

Export settings are validated before job creation:

**File**: `streamline-server/lib/exportTypes.ts`

```typescript
// Validates:
- Resolution: must be "720p", "1080p", or "4k"
- Format: must be "mp4", "webm", or "mov"
- Quality: must be "draft", "standard", or "high"
- Timeline: must have at least one track with at least one clip
- Clips: sourceInMs < sourceOutMs, startMs < endMs
```

Validation errors return 400 responses with specific error messages.
