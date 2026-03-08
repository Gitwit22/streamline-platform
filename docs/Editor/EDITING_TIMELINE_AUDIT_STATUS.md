# Editing Project Timeline Audit (Status + Remaining Work)

Date: 2026-02-03 (updated 2026-03-08)

Scope: This audit focuses on the **editing projects timeline** surface (client timeline UI + project persistence + timeline save/load + export integration).

## TL;DR

- **Timeline UI foundation is implemented** (ruler, clips, playhead styling; split/trim/delete operations; track UI exists).
- **Backend support for "Projects + Timeline persistence" is implemented**: server provides full CRUD for projects, timeline save/load (with track state), and export job endpoints.
- **Export is partially wired**: client expects `/api/editing/export` + status endpoints; server creates export job documents but the actual render worker is not yet connected.

This means: the editor can create, save, reload, and manage projects end-to-end. Export job creation works but the render pipeline is not yet complete.

---

## What exists today (repo reality)

### A) Timeline docs (documentation state)

- The editor docs were condensed to reduce duplication.
- Start here: `docs/Editor/README.md`

Notes:
- Trim handles are rendered but **not draggable** (visual only, no mouse handlers for drag trimming).
- There is **no clip drag/reorder implementation** in the current `EditorPage` timeline region.

### B) Client timeline implementation (UI + in-memory behavior)

Primary file:
- `streamline-client/src/lanes/movie-maker/features/editing/EditorPage.tsx`

Observed capabilities in current code:
- Timeline ruler renders major (5s) + minor (1s) markers, plus grid lines.
- Clip rendering is styled + selectable.
- Playhead is rendered and updates during playback.
- Operations exist:
  - split at playhead
  - trim (tool action trims end of clip)
  - delete
- Track UI exists (video/audio): mute, lock, solo, linking/unlinking, add/delete tracks (plan-gated).
- Click-to-seek correctly accounts for the 80px left gutter offset.

### C) Client API contract for editing projects

File:
- `streamline-client/src/core/lib/editingApi.ts`

Client uses these project/timeline endpoints (all implemented on server):
- `GET /api/editing/projects/:id`
- `PATCH /api/editing/projects/:id`
- `DELETE /api/editing/projects/:id`
- `PUT /api/editing/projects/:id/timeline` (Save clips + track state)

Client uses these export endpoints (implemented on server):
- `POST /api/editing/export`
- `GET /api/editing/exports/:exportId`

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
  - `PUT /api/editing/projects/:id/timeline` ✅ (persists clips with trackId + track state)
- Export:
  - `POST /api/editing/export` ✅ (creates export job document)
  - `GET /api/editing/exports/:exportId` ✅
- Recordings/content library:
  - `GET /api/editing/list`
  - `GET /api/editing/recordings/:id`
  - recording create/start/stop and other helpers
- Render:
  - `POST /api/editing/render` (recording-centric; accepts `renderedBuffer` upload)

---

## Where we are (status assessment)

### ✅ Completed / working
- Timeline styling foundation: ruler markers, grid lines, clip styling, playhead visuals.
- Basic editing operations in UI state: split/trim/delete.
- Track UX exists (mute/lock/solo/link), and plan gating hooks exist.
- Full project CRUD endpoints (create, read, update, delete).
- Timeline save/load with track state persistence (mute/lock/solo/link survives reload).
- Project loading restores saved track state.
- Save handler provides user-facing feedback (saved/error states).
- Effect cleanup prevents stale state updates on unmount.

### ⚠️ Partially implemented
- Trim handles are rendered, but **not draggable** (no mouse handlers driving trim behavior).
- Export job creation works, but the actual render/encode worker is not yet connected.

### ❌ Not implemented
- Draggable trim handles / drag-to-reorder clips.
- Undo/redo system.
- Export render pipeline (actual video processing).

---

## What needs to be done (recommended execution order)

### 1) Export render pipeline
- Connect `POST /api/editing/export` to a worker/queue that processes the timeline and produces output video.
- Or wire the export UI to existing `POST /api/editing/render` for short-term recording render.

### 2) Interactive timeline features
- Implement drag-to-trim handles (mouse handlers on clip edges).
- Implement drag-to-reorder clips on the timeline.

### 3) Undo/redo
- Add an undo/redo stack for destructive operations (split, trim, delete).

---

## Concrete "next tasks" checklist

Backend
- [x] Add `GET/PATCH/DELETE /api/editing/projects/:id`
- [x] Add `PUT /api/editing/projects/:id/timeline`
- [x] Persist `updatedAt` on every mutation
- [x] Validate clip fields and clamp invalid durations

Client
- [x] Ensure Save uses a real `projectId` (not `"new"`)
- [x] Load timeline from project if present (not just reconstruct from asset)
- [x] Persist tracks; align types in `editingApi.ts`

Export
- [x] Project-based export job endpoints implemented
- [ ] Connect export render pipeline (actual video processing)

---

## Verification (how we'll know it's done)

- Create project from Projects dashboard.
- Open editor for that project.
- Make edits (split/trim).
- Click Save.
- Reload page → timeline loads exactly as saved.
- Export produces a downloadable file via the chosen export path.
