# HLS Testing (local + env smoke checks)

## One-time setup checks

- `ROOM_ACCESS_TOKEN_SECRET` is set in every non-local environment.
  - Production/staging must **not** use `dev-secret`.
  - The server now throws on startup in `NODE_ENV=production|staging` if `ROOM_ACCESS_TOKEN_SECRET` is missing or would fall back to `dev-secret`.

- Client API base:
  - The client uses `VITE_API_BASE` when provided, otherwise defaults to the test backend.
  - See [streamline-client/src/lib/apiBase.ts](../streamline-client/src/lib/apiBase.ts).

- Firestore room doc:
  - Ensure the room exists at `rooms/{roomId}`.
  - Ensure it includes the LiveKit room name field (`livekitRoomName`).

## Get tokens

From the host Room UI (or your flow), confirm `/api/roomToken` returns:
- `roomAccessToken` (non-empty)
- `roomId` (Firestore doc id)
- `roomName` (LiveKit room name)

You’ll use `roomAccessToken` as the bearer token in the steps below.

## Run the automated smoke test

PowerShell:

```powershell
# Security-only checks
./deployment/hls-smoke-test.ps1 \
  -ApiBase "http://localhost:5137" \
  -RoomAId "<ROOM_A_ID>" \
  -RoomBId "<ROOM_B_ID>" \
  -HostToken "<ROOM_A_HOST_TOKEN>" \
  -ViewerToken "<ROOM_A_VIEWER_TOKEN>"

# Full start/poll/stop
./deployment/hls-smoke-test.ps1 \
  -ApiBase "http://localhost:5137" \
  -RoomAId "<ROOM_A_ID>" \
  -RoomBId "<ROOM_B_ID>" \
  -HostToken "<ROOM_A_HOST_TOKEN>" \
  -ViewerToken "<ROOM_A_VIEWER_TOKEN>" \
  -RunStartStop
```

## Manual curl equivalents (header-auth)

Resolve:

```powershell
curl "http://localhost:5137/api/rooms/resolve" -H "Authorization: Bearer <TOKEN>"
```

Status (auth required):

```powershell
curl "http://localhost:5137/api/hls/status/<ROOM_ID>" -H "Authorization: Bearer <TOKEN>"
```

Start HLS (host/cohost/mod only):

```powershell
curl -X POST "http://localhost:5137/api/hls/start/<ROOM_ID>" `
  -H "Authorization: Bearer <TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{"presetId":"hls_720p"}'
```

Stop HLS (host/cohost/mod only):

```powershell
curl -X POST "http://localhost:5137/api/hls/stop/<ROOM_ID>" -H "Authorization: Bearer <TOKEN>"
```

Viewer public status (no auth, minimal data):

```powershell
curl "http://localhost:5137/api/hls/public/<ROOM_ID>"
```
