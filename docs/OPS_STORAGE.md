# Ops + Storage (R2) Notes

This doc summarizes storage integration and operational surfaces.

## Storage backend

StreamLine uses an object store (R2) via the server storage client.

Code entry points:

- Storage client: `streamline-server/lib/storageClient.ts`
- Recording + export flows: `streamline-server/routes/recordings.ts`, `streamline-server/routes/editing.ts`

## Quick storage smoke test

If enabled in the server, there is a basic test route:

- `GET /api/storage/test`

Expected behavior:

- Uploads a small test object
- Returns a public URL and the stored path

## Recording docs and storage paths

Common pattern:

- A `recordings/{recordingId}` document is created with metadata (userId, roomId, duration, status, storagePath, etc.).
- The object store path is deterministic (e.g. `recordings/<userId>/<room>/<timestamp>.mp4`).

## Storage limits

Storage checks should occur before uploading large objects:

- `checkStorageLimit(userId, fileSizeBytes)`
- `updateStorageUsage(userId, fileSizeBytes)`

These are typically located in server usage helpers and are used by upload/export flows.

## Export upload integration

Export flow (high-level):

- Client requests an export/render
- Server produces or receives the rendered output
- Server uploads the resulting file to storage
- Server updates the recording/project doc with the public URL/path and status

## Deployment helper scripts

PowerShell scripts in `deployment/`:

- `start-dev.ps1`
- `get-ngrok-urls.ps1`
- `update-env-ngrok.ps1`

See `deployment/README.md` and `deployment/HLS_TESTING.md` for environment-specific notes.
