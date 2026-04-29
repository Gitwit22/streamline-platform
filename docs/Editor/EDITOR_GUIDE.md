# Editor Guide (User + UI Flow)

Date: 2026-02-03 (updated 2026-03-10)

## What the editor is

Streamline's editor is a browser-based, non-destructive timeline editor:
- clips on tracks
- playhead-based operations (split/trim/delete)
- draggable trim handles and drag-to-move clips
- undo/redo (Ctrl+Z / Ctrl+Shift+Z)
- zoom + click-to-seek
- export with FFmpeg render pipeline (background worker, progress tracking, R2 upload)

Primary client file: `streamline-client/src/creator/features/editing/EditorPage.tsx`

---

## Main user flows

### 1) Record → Exit page
1. Host starts a stream.
2. Recording metadata is created and eventually becomes `ready`.
3. User lands on the exit/summary pages with actions.

### 2) Exit page → Download recording
- The exit page provides a download action once the recording is `ready`.
- Download UX includes progress reporting (percent, speed, time remaining).

### 3) Exit page → Go to editor
- "Go to editor" navigates to an editor route with `recordingId` in query params.
- The editor loads the recording and constructs initial timeline clips.

### 4) Editor → Export
- Click "Export Video" in the right sidebar.
- RenderAndUploadPage starts an export job (`POST /api/editing/export`).
- Backend creates a durable job record and the render worker picks it up.
- UI polls for status, showing progress bar with current step.
- On completion, a download link is shown.
- User can cancel mid-export or retry on failure.

---

## Editor UI map (quick)

- **Top bar**: project name, save, export, back to projects
- **Left sidebar**: undo/redo, edit operations (split/trim/delete) + clip info + track management
- **Center**: video preview + transport controls
- **Bottom**: timeline ruler + clips + playhead + zoom
- **Right sidebar**: export settings (resolution/format)

---

## Keyboard shortcuts

- `Space`: Play/Pause
- `S`: Split at playhead
- `Delete` / `Backspace`: Delete selected clip
- `←` / `→`: Seek 1s
- `Shift+←` / `Shift+→`: Seek 5s
- `Ctrl+Z` / `Cmd+Z`: Undo
- `Ctrl+Shift+Z` / `Cmd+Shift+Z`: Redo

---

## Quick smoke test (local)

1. Run client + server.
2. Create a short recording.
3. Open editor via the exit/summary flow.
4. Verify: video loads, timeline shows clips, playhead moves, split works.
5. Drag trim handles to resize clips. Drag clip bodies to reposition.
6. Use Ctrl+Z to undo, Ctrl+Shift+Z to redo.
7. Click Save → see "Saved" confirmation.
8. Reload page → timeline loads exactly as saved.
9. Click Export Video → RenderAndUploadPage shows progress.
10. Once complete, download link appears.
