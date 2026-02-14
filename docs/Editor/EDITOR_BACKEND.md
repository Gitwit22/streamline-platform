# Editor Backend + API Wiring (Condensed)

Date: 2026-02-03

This doc captures the **actual API surface** that the editor and recording/download flows rely on, plus what’s missing.

---

## Current truth: client expectations vs server reality

### Client expects (editing projects)
Client wrapper: `streamline-client/src/lib/editingApi.ts`

Projects + timeline endpoints expected:
- `GET /api/editing/projects` (list)
- `POST /api/editing/projects` (create)
- `GET /api/editing/projects/:id` (missing on server today)
- `PATCH /api/editing/projects/:id` (missing)
- `DELETE /api/editing/projects/:id` (missing)
- `PUT /api/editing/projects/:id/timeline` (missing)

Export endpoints expected:
- `POST /api/editing/export` (missing)
- `GET /api/editing/exports/:exportId` (missing)

### Server currently provides (editing)
Server router: `streamline-server/routes/editing.ts`

Implemented:
- `GET /api/editing/projects`
- `POST /api/editing/projects` (initializes `timeline: []`)
- Recording library helpers (list + recording details)
- `POST /api/editing/render` (recording-centric render/upload path)

Net: the editor can work in-memory, but **Save/Reload/Export-as-project are not end-to-end yet**.

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
- signed URL generation failure suggests “Emergency Download” fallback

---

## Data storage (what to persist)

### Recordings
Firestore: `recordings/{recordingId}`
- used for content library + download + editor load

### Editing projects
Firestore: `editing_projects/{projectId}`
- currently created with `{ userId, name, assetId, timeline: [] }`
- needs full CRUD + timeline persistence endpoints to be useful

---

## Recommended next backend work (minimum)

1) Implement missing project endpoints in `streamline-server/routes/editing.ts`:
- `GET/PATCH/DELETE /api/editing/projects/:id`
- `PUT /api/editing/projects/:id/timeline`

2) Validate + persist a canonical timeline model:
- clips should include `trackId` if multi-track is real
- clamp negative times/durations

3) Decide export direction:
- **Project-based export jobs** (new endpoints + job persistence), or
- wire UI to existing `POST /api/editing/render` for a short-term “recording render” story

For the detailed status + execution order, see:
- `docs/Editor/EDITING_TIMELINE_AUDIT_STATUS.md`
