# Media Library & Video Editor

StreamLine includes a content library for managing media assets and a timeline-based video editor for post-production work.

## Content Library (Media Library)

### Overview

The Content Library is a cloud-based media asset manager where users can upload, organize, and browse video, audio, and image files. Assets in the library can be used in video editing projects.

**Client entry point**: `/content` → `AssetLibrary.tsx`

### Features

- **File Upload** — Upload media files directly to Cloudflare R2 via signed upload URLs
- **Asset Browser** — Grid view of uploaded assets with metadata (filename, type, duration, size)
- **Storage Tracking** — Upload sizes tracked against the user's plan storage limits
- **Delete Management** — Remove assets from library and storage

### Plan Gating

Access to the Content Library requires the `contentLibrary` feature flag on the user's plan. The flag is checked:
- Client-side via `useEffectiveEntitlements()` hook (gates navigation)
- Server-side via `contentLibraryEnabled` flag (gates API access)

Users without access are redirected to `/my-content-disabled`.

### API

| Endpoint | Method | Description |
|---|---|---|
| `/api/editing/assets` | GET | List user's media assets |
| `/api/editing/assets/upload` | POST | Get signed upload URL for a new asset |
| `/api/editing/assets/:id` | GET | Get asset details |
| `/api/editing/assets/:id` | DELETE | Delete an asset |

---

## Video Editor

### Overview

The Video Editor is a timeline-based editing tool for creating video productions from recordings, uploaded assets, and media clips. It supports multi-track editing, clip trimming, and server-side FFmpeg rendering.

**Client entry point**: `/editing/editor/:projectId` → `EditorPage.tsx`

### Features

- **Multi-Track Timeline** — Separate video and audio tracks with independent clip positioning
- **Clip Trimming** — Draggable trim handles for precise source in/out point editing
- **Drag-to-Move** — Reposition clips on the timeline via drag-and-drop
- **Undo/Redo** — Full undo/redo stack with keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z)
- **Project Management** — Create, save, duplicate, and delete editing projects
- **Export Rendering** — Server-side FFmpeg rendering with real-time progress tracking
- **Multiple Output Formats** — MP4, WebM, MOV
- **Resolution Options** — 720p, 1080p, 4K (plan-gated)
- **Quality Presets** — Draft, Standard, High

### Plan Gating

Access requires both `projects` and `editor` feature flags:
- Project list: requires `projects` flag → `/projects` route
- Editor: requires `editor` flag → `/editing/editor/:projectId` route

Users without access are redirected to `/editor-disabled`.

---

## Projects

### Overview

Projects are containers for editing timelines. Each project stores the complete timeline state including tracks, clips, positions, and trim points.

**Client entry point**: `/projects` → `ProjectsDashboard.tsx`

### Features

- **Create Project** — Start a new editing project
- **Open Project** — Load a project into the timeline editor
- **Save Project** — Persist timeline state to Firestore
- **Duplicate Project** — Clone an existing project (enforces ownership, plan limits, and max project count)
- **Delete Project** — Remove a project and its data

### API

| Endpoint | Method | Description |
|---|---|---|
| `/api/editing/projects` | GET | List user's projects |
| `/api/editing/projects` | POST | Create a new project |
| `/api/editing/projects/:id` | GET | Get project details and timeline |
| `/api/editing/projects/:id` | PUT | Save project timeline |
| `/api/editing/projects/:id` | DELETE | Delete a project |
| `/api/editing/projects/:id/duplicate` | POST | Duplicate a project |

---

## Export Pipeline

### Overview

The export pipeline renders timeline projects into final video files using FFmpeg. It uses a Firestore-backed job queue with a background worker process.

### Architecture

```
Client requests export
        │
        ▼
POST /api/editing/export
        │
        ▼
Export job created in Firestore (status: "queued")
        │
        ▼
Render Worker polls queue every 5s
        │
        ▼
Worker claims job (status: "preparing")
        │
        ▼
Downloads source clips from R2
        │
        ▼
Builds FFmpeg command from timeline
        │
        ▼
Renders video (status: "rendering")
        │
        ▼
Uploads output to R2 (status: "uploading")
        │
        ▼
Job complete (status: "completed")
        │
        ▼
Client receives outputUrl
```

### Job States

| State | Description |
|---|---|
| `queued` | Job submitted, waiting for worker |
| `preparing` | Worker claimed job, downloading sources |
| `rendering` | FFmpeg rendering in progress |
| `uploading` | Rendered file being uploaded to R2 |
| `completed` | Export finished, output URL available |
| `failed` | Export failed (error message available) |
| `canceled` | Export canceled by user |

### Export Settings

```typescript
{
  resolution: "720p" | "1080p" | "4k",
  format: "mp4" | "webm" | "mov",
  quality: "draft" | "standard" | "high"
}
```

### Timeline Format

The export system processes timelines with this structure:

```typescript
{
  width: number,      // Output width in pixels
  height: number,     // Output height in pixels
  fps: number,        // Frames per second
  tracks: [
    {
      kind: "video" | "audio",
      clips: [
        {
          startMs: number,      // Position on timeline (ms)
          endMs: number,        // End position on timeline (ms)
          sourceInMs: number,   // Source clip trim start
          sourceOutMs: number,  // Source clip trim end
          sourceUrl: string     // R2 signed download URL
        }
      ]
    }
  ]
}
```

### Export API

| Endpoint | Method | Description |
|---|---|---|
| `/api/editing/export` | POST | Start an export job |
| `/api/editing/export/:id` | GET | Check export status and progress |
| `/api/editing/export/:id/cancel` | POST | Cancel a queued or in-progress export |

### Worker Configuration

| Environment Variable | Description | Default |
|---|---|---|
| `EXPORT_WORKER_ENABLED` | Enable background export worker | `1` |
| `EXPORT_WORKER_POLL_MS` | Queue poll interval (ms) | `5000` |
| `FFMPEG_PATH` | Path to FFmpeg binary | `ffmpeg` |
| `FFPROBE_PATH` | Path to FFprobe binary | `ffprobe` |
