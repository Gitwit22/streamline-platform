# Editing Project Timeline Audit (Status + Remaining Work)

Date: 2026-02-03 (updated 2026-03-10)

Scope: This audit focuses on the **editing projects timeline** surface (client timeline UI + project persistence + timeline save/load + export integration).

## TL;DR

- **Timeline UI foundation is implemented** (ruler, clips, playhead styling; split/trim/delete operations; track UI exists).
- **Interactive timeline features are implemented**: draggable trim handles, drag-to-move clips, undo/redo.
- **Backend support for "Projects + Timeline persistence" is implemented**: server provides full CRUD for projects, timeline save/load (with track state), export job endpoints, and project duplicate.
- **Export pipeline is implemented**: POST /api/editing/export creates a durable job record in Firestore. A background render worker (FFmpeg-based) claims queued jobs, downloads source assets, renders video, uploads to R2, and updates the job status. GET /api/editing/exports/:exportId returns real-time progress. POST /api/editing/exports/:exportId/cancel supports cancellation.

---

## What exists today (repo reality)

### A) Timeline docs (documentation state)

- The editor docs were condensed to reduce duplication.
- Start here: `docs/Editor/README.md`

### B) Client timeline implementation (UI + in-memory behavior)

Primary file:
- `streamline-client/src/creator/features/editing/EditorPage.tsx`

Observed capabilities in current code:
- Timeline ruler renders major (5s) + minor (1s) markers, plus grid lines.
- Clip rendering is styled + selectable.
- Playhead is rendered and updates during playback.
- Operations exist:
  - split at playhead
  - trim (tool action trims end of clip)
  - delete
- Draggable trim handles on clip left/right edges (mouse-driven).
- Drag-to-move clips on the timeline.
- Undo/redo system (Ctrl+Z / Ctrl+Shift+Z) with up to 50 snapshots.
- Track UI exists (video/audio): mute, lock, solo, linking/unlinking, add/delete tracks (plan-gated).
- Click-to-seek correctly accounts for the 80px left gutter offset.

### C) Client API contract for editing projects

File:
- `streamline-client/src/lib/editingApi.ts`

Client uses these project/timeline endpoints (all implemented on server):
- `GET /api/editing/projects` (list)
- `POST /api/editing/projects` (create)
- `GET /api/editing/projects/:id`
- `PATCH /api/editing/projects/:id`
- `DELETE /api/editing/projects/:id`
- `POST /api/editing/projects/:id/duplicate`
- `PUT /api/editing/projects/:id/timeline` (Save clips + track state)

Client uses these export endpoints (all implemented on server):
- `POST /api/editing/export` → creates durable job, returns `{ id, status: "queued" }`
- `GET /api/editing/exports/:exportId` → returns full job state with progress
- `POST /api/editing/exports/:exportId/cancel` → cancel a non-terminal job

### D) Server editing routes (backend reality)

File:
- `streamline-server/routes/editing.ts`

What exists:
- Projects:
  - `GET /api/editing/projects` (list) ✅
  - `POST /api/editing/projects` (create) ✅
  - `GET /api/editing/projects/:id` ✅
  - `PATCH /api/editing/projects/:id` ✅
  - `DELETE /api/editing/projects/:id` ✅
  - `POST /api/editing/projects/:id/duplicate` ✅
  - `PUT /api/editing/projects/:id/timeline` ✅ (persists clips with trackId + track state)
- Export Pipeline:
  - `POST /api/editing/export` ✅ (creates durable job, enqueues to Firestore-backed queue)
  - `GET /api/editing/exports/:exportId` ✅ (returns full state: status, progressPercent, currentStep, outputUrl)
  - `POST /api/editing/exports/:exportId/cancel` ✅
- Export Modules:
  - `lib/exportTypes.ts` — type definitions, resolution/format helpers, validation
  - `lib/exportQueue.ts` — Firestore-backed job queue (create, claim, update, cancel)
  - `lib/renderWorker.ts` — FFmpeg render worker (download, render, upload, progress reporting)
- Recordings/content library:
  - `GET /api/editing/list`
  - `GET /api/editing/recordings/:id`
  - recording create/start/stop and other helpers
- Render:
  - `POST /api/editing/render` (recording-centric; accepts `renderedBuffer` upload)

### E) Export Job States

```
queued → preparing → rendering → uploading → completed
                                              ↗
                                     failed ←
                                              ↘
                                     canceled
```

Job fields:
- `status`: queued | preparing | rendering | uploading | completed | failed | canceled
- `progressPercent`: 0-100
- `currentStep`: human-readable step description
- `errorMessage`: set when failed
- `attemptCount`: incremented on each claim
- `outputUrl`: R2 public URL when completed
- `outputPath`: R2 key when completed
- `startedAt` / `completedAt`: timestamps

---

## Where we are (status assessment)

### ✅ Completed / working
- Timeline styling foundation: ruler markers, grid lines, clip styling, playhead visuals.
- Basic editing operations in UI state: split/trim/delete.
- Draggable trim handles (left/right edge drag with mouse handlers).
- Drag-to-move clips on the timeline.
- Undo/redo system (Ctrl+Z / Ctrl+Shift+Z, up to 50 history snapshots).
- Track UX exists (mute/lock/solo/link), and plan gating hooks exist.
- Full project CRUD endpoints (create, read, update, delete, duplicate).
- Timeline save/load with track state persistence (mute/lock/solo/link survives reload).
- Project loading restores saved track state.
- Save handler provides user-facing feedback (saved/error states).
- Effect cleanup prevents stale state updates on unmount.
- Project duplicate from dashboard.
- Export pipeline: durable job creation, Firestore-backed queue, FFmpeg render worker with progress reporting, R2 upload, cancel support.
- Export UI: RenderAndUploadPage shows real job status, progress bar, current step, download link on completion, cancel button, retry on failure.

### ⚠️ Future enhancements
- Multi-track mixing: current render worker renders video track clips sequentially. Audio track overlay mixing could be added.
- Transitions: cross-dissolve, fade, etc. between clips.
- Text/image overlays in the render pipeline.
- BullMQ upgrade: replace Firestore poller with BullMQ+Redis for better concurrency and retry semantics at scale.

---

## Concrete "next tasks" checklist

Backend
- [x] Add `GET/PATCH/DELETE /api/editing/projects/:id`
- [x] Add `PUT /api/editing/projects/:id/timeline`
- [x] Persist `updatedAt` on every mutation
- [x] Validate clip fields and clamp invalid durations
- [x] Persist track state (mute/lock/solo/link) alongside clips
- [x] Add `POST /api/editing/projects/:id/duplicate`
- [x] Create durable export job records (Firestore collection: `editing_exports`)
- [x] Build Firestore-backed export queue (create, claim, update, cancel)
- [x] Build FFmpeg render worker (download assets, render, upload to R2)
- [x] Report render progress back to job record
- [x] Support job cancellation
- [x] Wire export worker into server startup (env-gated: `EXPORT_WORKER_ENABLED`)

Client
- [x] Ensure Save uses a real `projectId` (not `"new"`)
- [x] Load timeline from project if present (not just reconstruct from asset)
- [x] Persist tracks; `editingApi.ts` `TimelineClip` includes `trackId`
- [x] Restore track state on project load
- [x] User-facing save feedback (saved/error states)
- [x] Implement draggable trim handles
- [x] Implement clip drag-to-move
- [x] Add undo/redo system
- [x] Implement project duplicate
- [x] Update ExportJob type with new statuses (preparing, rendering, uploading, completed, canceled)
- [x] Update RenderAndUploadPage to display real job progress, cancel button, retry, download link

---

## Verification (how we know it works)

- Create project from Projects dashboard.
- Open editor for that project.
- Make edits (split/trim, mute/lock tracks).
- Drag trim handles to resize clips.
- Drag clip bodies to reposition on timeline.
- Use Ctrl+Z to undo, Ctrl+Shift+Z to redo.
- Click Save → see "Saved" confirmation.
- Reload page → timeline loads exactly as saved, including track state.
- Duplicate project from dashboard → copy appears in project list.
- Export creates a queued job (RenderAndUploadPage shows progress).
- Worker claims job, downloads assets, renders with FFmpeg, uploads to R2.
- Job status API returns progressPercent, currentStep, outputUrl on completion.
- Cancel button stops a non-terminal job.
- Failed exports show error message and retry button.
