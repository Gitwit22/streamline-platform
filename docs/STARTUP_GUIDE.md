# StreamLine Editing Suite - Quick Startup Guide

## Prerequisites
- Node.js installed
- ngrok installed and authenticated (https://ngrok.com/download)
- Firebase service account JSON in `streamline-server/server/firebaseServiceAccount.json`

## Environment Setup

### Backend (.env)
Location: `streamline-server/.env`

Required variables:
```
PORT=5137
LIVEKIT_URL=wss://streamline-nnn01wzh.livekit.cloud
LIVEKIT_API_KEY=<your-key>
LIVEKIT_API_SECRET=<your-secret>
JWT_SECRET=super_secret_change_later
VITE_LIVEKIT_URL=wss://streamline-nnn01wzh.livekit.cloud
```

### Frontend (.env)
Location: `streamline-client/.env`

Same as backend (the Vite proxy will handle routing).

## Startup Steps

### 1. Start Backend
```powershell
cd streamline-server
npm install  # if needed
npm run dev  # runs: tsx server/index.ts
```
Expected output: `✅ Server listening on http://localhost:5137`

### 2. Start Frontend (in a new terminal)
```powershell
cd streamline-client
npm install  # if needed
npm run dev  # runs: vite
```
Expected output: `VITE v7.2.2 ... Local: http://localhost:5173/`

### 3. Start ngrok (in a new terminal)
If you want to expose the backend to external services:
```powershell
ngrok http 5137
```
This will give you a public URL like: `https://xxxxx.ngrok.io`

## Testing the App

1. **Local Development**: Open `http://localhost:5173` in your browser
2. **Signup/Login**: Create an account or login
3. **Join a Room**: Enter a room name to start streaming

## Architecture

```
Frontend (React + Vite on :5173)
         ↓
    [Vite Proxy]
         ↓
Backend (Express on :5137)
         ↓
  [Firebase + LiveKit]
```

All API calls from the frontend use relative paths (`/api/*`), which the Vite proxy automatically forwards to `http://localhost:5137`.

## API Endpoints

### Auth
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login

### Rooms
- `POST /api/rooms/{roomId}/token` - Get token for joining a room (RTC)
- `POST /api/rooms/{roomName}/start-multistream` - Start streaming to YouTube/FB/Twitch
- `POST /api/rooms/{roomName}/stop-multistream` - Stop streaming

### Editing
- `GET /api/editing/list` - List user's recordings
- `POST /api/editing/save` - Save edit configuration
- `POST /api/editing/render` - Render/export recording

### Admin
- `POST /api/admin/mute` - Mute participant
- `POST /api/admin/mute-all` - Mute all participants
- `POST /api/admin/remove` - Remove participant

### Usage
- `GET /api/usage/summary` - Get usage stats
- Response header: `x-sl-usage-summary-version: v1`
- `POST /api/usage/streamEnded` - Log stream end

## Troubleshooting

### Backend fails to start
- Check that port 5137 is not already in use: `netstat -ano | findstr :5137`
- Ensure all env vars in `.env` are set correctly
- Check Firebase service account file exists

### Frontend can't connect to backend
- Ensure backend is running on :5137
- Check Vite proxy config in `vite.config.ts`
- Clear browser cache and refresh

### ngrok connection issues
- Ensure ngrok is installed: `ngrok --version`
- Authenticated with: `ngrok config add-authtoken <token>`
- Port is correct (should match your backend port: 5137)

## Using the Deployment Scripts

PowerShell scripts in `deployment/` folder:

```powershell
# Start backend and ngrok automatically
.\deployment\start-dev.ps1

# Get current ngrok URLs
.\deployment\get-ngrok-urls.ps1

# Update .env with new ngrok URL
.\deployment\update-env-ngrok.ps1
```

## Next Steps

1. Test the complete auth flow (signup → login → room)
2. Verify all API routes are accessible
3. Test the editing dashboard and record/playback
4. Check plan-based feature gating works correctly
