# ✅ StreamLine Checklist (Current)

Use this checklist to validate the end-to-end flow in dev.

## Streaming / Recording

- [ ] Join `/join` and create/join a room as host
- [ ] Start a stream and/or recording
- [ ] Stop the stream/recording without errors

## Post-Stream Exit

- [ ] Visit `/room-exit/:recordingId` and confirm host exit UX loads
- [ ] Click Download MP4 and confirm it opens a signed link (when available)
- [ ] Visit `/stream-summary/:recordingId` and confirm it redirects to `/room-exit/:recordingId`

## Editing Suite

- [ ] Open `/content` and confirm recordings/assets load
- [ ] Click **Create Project** on a recording and confirm it opens `/editing/editor/new?recordingId=...`
- [ ] Verify the editor loads the recording into the timeline
