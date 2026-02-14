# Development (Local Setup + Runbook)

This doc is the **current** setup/runbook for developing StreamLine locally.

## Prerequisites

- Node.js (project uses npm scripts)
- ngrok (optional; only needed for exposing local backend)
- Firebase service account JSON available to the server

## Env vars

Backend env file: `streamline-server/.env`

Common variables:

- `PORT` (default server port is `5137`)
- LiveKit:
  - `LIVEKIT_URL`
  - `LIVEKIT_API_KEY`
  - `LIVEKIT_API_SECRET`
- `JWT_SECRET`

Frontend env file: `streamline-client/.env`

- Use the same LiveKit URL when needed by the client.
- If the client is proxying to the backend via Vite, most API calls should remain relative (`/api/*`).

## Start the backend

PowerShell:

```powershell
cd streamline-server
npm install
npm run dev
```

Expected output includes: `Server listening on http://localhost:5137`.

## Start the frontend

In a second terminal:

```powershell
cd streamline-client
npm install
npm run dev
```

Expected output includes a Vite URL (commonly `http://localhost:5173`).

## (Optional) Expose backend with ngrok

```powershell
ngrok http 5137
```

Use the public URL for any external callbacks/services that need to reach your local server.

## Handy dev scripts

See the `deployment/` folder:

- `deployment/start-dev.ps1` — convenience script to start backend + ngrok
- `deployment/get-ngrok-urls.ps1` — prints current ngrok URLs
- `deployment/update-env-ngrok.ps1` — updates env with the current ngrok URL

## Troubleshooting

### Backend fails to start

- Confirm the port is free:
  - `netstat -ano | findstr :5137`
- Verify required env vars exist in `streamline-server/.env`.
- Ensure the Firebase service account JSON file is present where the server expects it.

### Frontend can’t reach backend

- Confirm backend is running and reachable at `http://localhost:5137`.
- Check the proxy in `streamline-client/vite.config.ts`.

### LiveKit issues

- Verify `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
- Confirm your room name/ID mapping matches how the server resolves rooms.
