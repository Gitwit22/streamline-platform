# Editor Backend + API Wiring (Condensed)

Date: 2026-02-03 (updated 2026-03-08)

This doc captures the **actual API surface** that the editor and recording/download flows rely on.

---

## Current truth: client ↔ server API surface

### Client wrapper
`streamline-client/src/core/lib/editingApi.ts`

### Projects + timeline endpoints (all implemented)
- `GET /api/editing/projects` (list) ✅
- `POST /api/editing/projects` (create) ✅
- `GET /api/editing/projects/:id` ✅
- `PATCH /api/editing/projects/:id` ✅
- `DELETE /api/editing/projects/:id` ✅
- `PUT /api/editing/projects/:id/timeline` ✅ (persists clips + track state)

### Export endpoints (implemented, render pipeline pending)
- `POST /api/editing/export` ✅ (creates export job document)
- `GET /api/editing/exports/:exportId` ✅

### Server router
`streamline-server/routes/editing.ts`

Also implemented:
- Recording library helpers (list + recording details)
- `POST /api/editing/render` (recording-centric render/upload path)

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

## Data storage

### Recordings
Firestore: `recordings/{recordingId}`
- used for content library + download + editor load

### Editing projects
Firestore: `editing_projects/{projectId}`
- Full CRUD implemented
- Timeline persists clips (with `trackId`) and track state (mute/lock/solo/link)
- `updatedAt` maintained on every mutation

---

## Remaining backend work

1) **Export render pipeline**: Connect `POST /api/editing/export` to a worker/queue that processes the timeline and produces output video.

2) For the detailed status + execution order, see:
- `docs/Editor/EDITING_TIMELINE_AUDIT_STATUS.md`
