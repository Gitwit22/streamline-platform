# Editing Project Timeline Audit (Status + Remaining Work)

Date: 2026-02-03

Scope: This audit focuses on the **editing projects timeline** surface (client timeline UI + project persistence + timeline save/load + export integration).

## TL;DR

- **Timeline UI foundation is implemented** (ruler, clips, playhead styling; split/trim/delete operations; track UI exists).
- **Backend support for “Projects + Timeline persistence” is incomplete**: server currently has only `GET /api/editing/projects` + `POST /api/editing/projects` and does **not** implement the endpoints the client calls for save/load/update/delete timeline.
- **Export is currently UI-only** from the “Projects API” perspective (client expects `/api/editing/export` + status endpoints; server currently has `/api/editing/render` for recordings, not project-based export jobs).

This means: the editor can *feel* functional in-session, but **Save/Reload + Export-as-project are not end-to-end wired yet**.

---

## What exists today (repo reality)

### A) Timeline docs (documentation state)

- The editor docs were condensed to reduce duplication.
- Start here: `docs/Editor/README.md`

Notes:
- Some higher-level editor docs describe interactive trim handles / reorder / export as “complete”, but the code shows **trim handles are currently visual (non-draggable)** and there is **no clip drag/reorder implementation** in the current `EditorPage` timeline region.

### B) Client timeline implementation (UI + in-memory behavior)

Primary file:
- `streamline-client/src/editing/EditorPage.tsx`

Observed capabilities in current code:
- Timeline ruler renders major (5s) + minor (1s) markers, plus grid lines.
- Clip rendering is styled + selectable.
- Playhead is rendered and updates during playback.
- Operations exist:
  - split at playhead
  - trim (tool action trims end of clip)
  - delete
- Track UI exists (video/audio): mute, lock, solo, linking/unlinking, add/delete tracks (plan-gated).

Important implementation note:
- The timeline visuals use an **80px left offset** (ruler markers, clip positions, playhead), but the click-to-seek handler currently converts pixel → time without subtracting the same offset. This can make click seeking feel “shifted”.

### C) Client API contract for editing projects

File:
- `streamline-client/src/lib/editingApi.ts`

Client expects these project/timeline endpoints:
- `GET /api/editing/projects/:id`
- `PATCH /api/editing/projects/:id`
- `DELETE /api/editing/projects/:id`
- `PUT /api/editing/projects/:id/timeline` (Save)

Client expects export endpoints:
- `POST /api/editing/export`
- `GET /api/editing/exports/:exportId`

### D) Server editing routes (backend reality)

File:
- `streamline-server/routes/editing.ts`

What exists:
- Projects:
  - `GET /api/editing/projects` (list)
  - `POST /api/editing/projects` (create, initializes `timeline: []`)
- Recordings/content library:
  - `GET /api/editing/list`
  - `GET /api/editing/recordings/:id`
  - recording create/start/stop and other helpers
- Render:
  - `POST /api/editing/render` (recording-centric; accepts `renderedBuffer` upload and stores `publicExportUrl`)

What is missing (but client calls it):
- `GET /api/editing/projects/:id`
- `PATCH /api/editing/projects/:id`
- `DELETE /api/editing/projects/:id`
- `PUT /api/editing/projects/:id/timeline`
- `POST /api/editing/export` and `GET /api/editing/exports/:id`

Net effect:
- “Projects” can be created/listed, but **cannot be opened reliably, saved, updated, or deleted** via the API the client uses.

---

## Where we are (status assessment)

### ✅ Completed / working (in isolation)
- Timeline styling foundation (Phase 1): ruler markers, grid lines, clip styling, playhead visuals.
- Basic editing operations in UI state: split/trim/delete.
- Track UX exists (mute/lock/solo/link), and plan gating hooks exist.

### ⚠️ Partially implemented / misleading UX
- Trim handles are rendered, but **not draggable** (no mouse handlers driving trim behavior).
- “Save” calls `PUT /api/editing/projects/:id/timeline` which is **not implemented** on the server.
- “Export” navigates to an export route; the client API expects project-based export jobs, but server currently has a different render path.

### ❌ Not implemented end-to-end
- Project persistence lifecycle:
  - load project by id
  - update project name
  - save timeline and reload it
  - delete project
- Timeline persistence model alignment:
  - Client `EditorPage` clips include `trackId` and multi-track state, but the shared `editingApi` timeline type is minimal and doesn’t model tracks explicitly.
- Export job system tied to projects/timelines.

---

## What needs to be done (recommended execution order)

### 1) Align the “Project Timeline” data model (client ↔ server)
Goal: define the canonical persisted shape so both sides agree.

Recommended minimal persisted shape (MVP):
- `project.name`
- `project.assetId`
- `timeline.clips[]` with at least: `id, assetId, trackId, startTime, duration, inPoint, outPoint, name, videoUrl`
- `timeline.tracks[]` or a simple `tracks` config object (if multi-track is meant to persist)

Decide:
- Do we persist full track objects (mute/lock/solo/link), or only clips + track count?

### 2) Implement missing server endpoints (projects CRUD + timeline save)
Add to `streamline-server/routes/editing.ts` (or a new module) with:
- `GET /api/editing/projects/:id`
- `PATCH /api/editing/projects/:id` (rename, status updates)
- `DELETE /api/editing/projects/:id`
- `PUT /api/editing/projects/:id/timeline`

Minimum behaviors:
- Auth: owner-only (`userId` must match).
- Feature flags/segments: consistent use of `projectsEnabled` + `editorEnabled`.
- Validation: ensure timeline is an array of clips with numeric times.

### 3) Fix editor routing + “new project” lifecycle
Current behavior uses `projectId === "new"` for ephemeral projects.

Pick one:
- (Preferred) When opening editor for a recording, **create a real project first**, then navigate to `/editing/editor/:projectId`.
- Or keep “new” ephemeral mode but **disable Save/Export** until a project is created.

### 4) Make timeline interactions match visuals
- Fix click-to-seek math to match the 80px offset.
- If trim handles are shown, either:
  - implement drag trimming, or
  - hide them until Phase 2.

### 5) Export: choose a coherent backend path
Two options:

A) Project-based export jobs (recommended long-term)
- Implement `POST /api/editing/export` and `GET /api/editing/exports/:id`.
- Store export jobs in Firestore and render via a worker/queue.

B) Recording-based render (short-term)
- Wire export UI to the existing `POST /api/editing/render` path.
- Clarify that export is “render the current recording” (not a multi-clip project timeline) until the full pipeline exists.

---

## Concrete “next tasks” checklist

Backend (highest priority)
- [ ] Add `GET/PATCH/DELETE /api/editing/projects/:id`
- [ ] Add `PUT /api/editing/projects/:id/timeline`
- [ ] Persist `updatedAt` on every mutation
- [ ] Validate clip fields and clamp invalid durations

Client
- [ ] Ensure Save uses a real `projectId` (not `"new"`)
- [ ] Load timeline from project if present (not just reconstruct from asset)
- [ ] Decide whether to persist tracks; align types in `editingApi.ts`

Export
- [ ] Decide whether export is project-based (jobs) or recording-based (existing render)
- [ ] If project-based: implement endpoints + status polling
- [ ] If recording-based: update UI copy and wire to `/api/editing/render`

---

## Verification (how we’ll know it’s done)

- Create project from Projects dashboard.
- Open editor for that project.
- Make edits (split/trim).
- Click Save.
- Reload page → timeline loads exactly as saved.
- Export produces a downloadable file via the chosen export path.
