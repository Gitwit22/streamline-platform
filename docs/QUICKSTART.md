# StreamLine Quickstart (Current)

This quickstart reflects the current routing and post-stream UX.

## Local Run

Use [DEVELOPMENT.md](DEVELOPMENT.md) for environment variables and full setup.

1. Server
   - `cd streamline-server`
   - `npm install`
   - `npm run dev`

2. Client
   - `cd streamline-client`
   - `npm install`
   - `npm run dev`

## Smoke Test Flow

1. Go to `/join` and create/join a room.
2. Join as host.
3. Start/stop recording and/or streaming.
4. Use `/room-exit/:recordingId` for post-stream actions (download, next steps).
5. Confirm legacy compatibility: visiting `/stream-summary/:recordingId` redirects to `/room-exit/:recordingId`.
6. Open the editing suite:
   - Go to `/content` (Asset Library)
   - On a recording, click **Create Project** to open `/editing/editor/new?recordingId=...`

## Key Routes

- `/room/:roomName` - Live room (host + participants)
- `/live/:savedEmbedId` - Viewer experience
- `/room-exit/:recordingId` - Canonical post-stream exit page
- `/stream-summary/:recordingId` - Legacy redirect to `/room-exit/:recordingId`
- `/content` - Asset Library
- `/projects` - Projects Dashboard
- `/editing/editor/:projectId` - Timeline editor (`new` supported)
