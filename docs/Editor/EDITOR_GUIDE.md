# Editor Guide (User + UI Flow)

Date: 2026-02-03

## What the editor is

Streamline’s editor is a browser-based, non-destructive timeline editor:
- clips on tracks
- playhead-based operations (split/trim/delete)
- zoom + click-to-seek
- export UI (backend export wiring is still in progress)

Primary client file: `streamline-client/src/editing/EditorPage.tsx`

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
- “Go to editor” navigates to an editor route with `recordingId` in query params.
- The editor loads the recording and constructs initial timeline clips.

---

## Editor UI map (quick)

- **Top bar**: project name, save, export, back to projects
- **Left sidebar**: edit operations (split/trim/delete) + clip info
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

---

## What’s solid vs what’s still WIP

Solid in-session behavior:
- timeline ruler + markers + grid
- clip rendering + selection
- playhead rendering + playback sync
- split/trim/delete operations update UI state

Still WIP / not end-to-end:
- “Save timeline” persistence + reload (server endpoints not fully implemented)
- project-based export jobs (client expects endpoints that don’t exist yet)
- draggable trim handles / drag-to-reorder (handles are currently visual-only)

For the authoritative current status and remaining work, see:
- `docs/Editor/EDITING_TIMELINE_AUDIT_STATUS.md`

---

## Quick smoke test (local)

1. Run client + server.
2. Create a short recording.
3. Open editor via the exit/summary flow.
4. Verify: video loads, timeline shows clips, playhead moves, split works.

If Save/Export fails, that’s expected until backend wiring is completed.
