# Implementation Summary (Current)

This document summarizes the current (live) streaming + recording + editing surfaces.

## Routing & UX

- **Canonical post-stream page:** `/room-exit/:recordingId`.
- **Legacy alias:** `/stream-summary/:recordingId` redirects to `/room-exit/:recordingId`.

## Editing Suite Entry Points

- Asset library: `/content`
- Projects dashboard: `/projects`
- Editor: `/editing/editor/:projectId` (use `new` for create-from-recording/query-param flows)

## Recent Cleanup

- Removed the unused Stream Summary page and the old mock/localStorage recording helper code.
- The server PUT handler at `PUT /api/editing/:recordingId` is scoped to runtime stats only (duration/status/viewers).
