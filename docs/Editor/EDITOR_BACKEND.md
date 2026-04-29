# Editor Backend + API Wiring (Condensed)

Date: 2026-02-03 (updated 2026-03-10)

This doc captures the **actual API surface** that the editor and recording/download flows rely on.

---

## Current truth: client expectations vs server reality

### Client expects (editing projects)
Client wrapper: `streamline-client/src/lib/editingApi.ts`

Projects + timeline endpoints:
- `GET /api/editing/projects` (list) ✅
- `POST /api/editing/projects` (create) ✅
- `GET /api/editing/projects/:id` ✅
- `PATCH /api/editing/projects/:id` ✅
- `DELETE /api/editing/projects/:id` ✅
- `POST /api/editing/projects/:id/duplicate` ✅
- `PUT /api/editing/projects/:id/timeline` ✅

Export endpoints:
- `POST /api/editing/export` ✅
- `GET /api/editing/exports/:exportId` ✅
- `POST /api/editing/exports/:exportId/cancel` ✅

### Server currently provides (editing)
Server router: `streamline-server/routes/editing.ts`

All endpoints above are implemented, including:
- Full project CRUD (list, create, get, update, delete, duplicate)
- Timeline save/load with track state persistence
- Recording library helpers (list + recording details)
- `POST /api/editing/render` (recording-centric render/upload path)
- Export pipeline: durable job creation, progress tracking, cancel support

### Export Pipeline Architecture

```
POST /api/editing/export
  → validates request + auth + plan access
  → builds ExportTimeline from project timeline (resolves asset URLs)
  → creates job record in Firestore (editing_exports) with status "queued"
  → returns { id, status: "queued" }

Background Render Worker (lib/renderWorker.ts)
  → polls Firestore for queued jobs (EXPORT_WORKER_POLL_MS, default 5s)
  → claims oldest queued job (atomic status transition to "preparing")
  → downloads source assets to temp directory
  → builds FFmpeg command from timeline edit decision list
  → runs FFmpeg with progress parsing (time= regex on stderr)
  → uploads rendered file to R2 (exports/{userId}/{projectId}/{timestamp}.ext)
  → updates job to "completed" with outputUrl
  → on error: sets status to "failed" with errorMessage
  → cleans up temp files

GET /api/editing/exports/:exportId
  → returns full job state: status, progressPercent, currentStep, outputUrl, etc.

POST /api/editing/exports/:exportId/cancel
  → transitions non-terminal jobs to "canceled"
```

Key modules:
- `lib/exportTypes.ts` — ExportJobDoc, ExportTimeline, resolution/format helpers
- `lib/exportQueue.ts` — Firestore-backed queue: createExportJob, claimNextJob, updateExportJob, failJob, completeJob, cancelJob
- `lib/renderWorker.ts` — processExportJob, startExportWorker, stopExportWorker

Environment variables:
- `EXPORT_WORKER_ENABLED` — set to "0" to disable the background worker (default: enabled)
- `EXPORT_WORKER_POLL_MS` — poll interval in ms (default: 5000)
- `FFMPEG_PATH` — path to ffmpeg binary (default: "ffmpeg")
- `FFPROBE_PATH` — path to ffprobe binary (default: "ffprobe")

---

## Recording download endpoints (implemented)

Server router: `streamline-server/routes/recordings.ts`

Implemented:
- `GET /api/recordings/:id/download-link` → returns a signed URL (15 min TTL)
- `GET /api/recordings/:id/download` → redirects to `/download-link`
- `POST /api/recordings/:id/report-download-issue`

Key behavior:
- ownership is enforced
- expired links return 410
- signed URL generation failure suggests "Emergency Download" fallback

---

## Data storage (what to persist)

### Recordings
Firestore: `recordings/{recordingId}`
- used for content library + download + editor load

### Editing projects
Firestore: `editing_projects/{projectId}`
- Full CRUD + timeline persistence + duplicate endpoints implemented
- Timeline data includes clips (with trackId) and track state (mute/lock/solo/link)

### Export jobs
Firestore: `editing_exports/{jobId}`
- Created by POST /api/editing/export
- Updated by render worker throughout the pipeline
- Fields: status, progressPercent, currentStep, errorMessage, attemptCount, outputUrl, outputPath, settings, timeline, createdAt, startedAt, completedAt
