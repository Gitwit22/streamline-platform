# Environment Setup

This guide covers how to set up a local development environment for the StreamLine platform.

## Prerequisites

- **Node.js** — v18+ recommended
- **npm** — Included with Node.js
- **Git** — For version control
- **FFmpeg** — Required for video export rendering (optional for basic development)

## Clone the Repository

```bash
git clone https://github.com/Gitwit22/streamline-platform.git
cd streamline-platform
```

## Install Dependencies

StreamLine is a monorepo with separate dependency sets for the server and client.

### Server Dependencies

```bash
cd streamline-server
npm install
```

### Client Dependencies

```bash
cd streamline-client
npm install
```

### Git Hooks (Optional)

```bash
# From the root directory
npm run hooks:install
```

This configures custom git hooks from `.githooks/`.

## Environment Variables

### Server Environment (`streamline-server/.env`)

Create a `.env` file in the `streamline-server/` directory with the following variables:

#### Required

```bash
# Firebase Authentication & Database
# Provide ONE of these three options:
FIREBASE_SERVICE_ACCOUNT_PATH=path/to/service-account.json
# FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
# FIREBASE_SERVICE_ACCOUNT_BASE64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwuLi59

# Authentication
JWT_SECRET=your-secret-key          # NEVER use "dev-secret" in production

# LiveKit WebRTC
LIVEKIT_URL=wss://your-livekit-instance.example.com
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret

# Server
PORT=5137                           # API server port (default: 5137)
CLIENT_URL=http://localhost:5173    # Frontend URL for CORS
```

#### Storage (Cloudflare R2)

```bash
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=your-bucket-name
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCOUNT_ID=your-account-id
R2_REGION=auto                      # Default: "auto"
R2_RECORDINGS_ROOT_PREFIX=recordings/
```

#### Billing (Stripe)

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRICE_STARTER=price_...      # Stripe price ID for Starter plan
STRIPE_PRICE_PRO=price_...          # Stripe price ID for Pro plan
STRIPE_PRICE_BASIC=price_...        # Stripe price ID for Basic plan
```

#### AI Agent (Horizon) — Optional

```bash
HORIZON_CHAT_EVENT_URL=http://localhost:3000/api/streamline/chat-event
HORIZON_VOICE_EVENT_URL=http://localhost:3000/api/streamline/voice-event
HORIZON_WEBHOOK_SECRET=your-webhook-secret
HORIZON_WEBHOOK_TIMEOUT=5000        # ms
HORIZON_WEBHOOK_RETRIES=2
```

#### Export Pipeline — Optional

```bash
FFMPEG_PATH=ffmpeg                  # Path to FFmpeg binary
FFPROBE_PATH=ffprobe                # Path to FFprobe binary
EXPORT_WORKER_ENABLED=1             # Enable background export worker
EXPORT_WORKER_POLL_MS=5000          # Queue poll interval (ms)
PLATFORM_TRANSCODE_ENABLED=true     # Enable transcode feature
```

#### Miscellaneous

```bash
NODE_ENV=development
AUTH_DEBUG=1                        # Extra auth logging (dev only)
MAINTENANCE_KEY=your-maintenance-key
ROOM_MODERATION_HOST_ONLY=0         # 1 = host-only moderation
HLS_PUBLIC_BASE_URL=http://localhost:8787/hls
INVITE_TOKEN_SECRET=               # Defaults to JWT_SECRET if not set
ROOM_ACCESS_TOKEN_SECRET=          # Separate secret for room tokens
```

### Client Environment (`streamline-client/.env`)

Create a `.env` file in the `streamline-client/` directory:

```bash
VITE_API_BASE=http://localhost:5137   # Backend API URL
VITE_LIVEKIT_URL=wss://your-livekit-instance.example.com
```

> **Note**: Client environment variables must be prefixed with `VITE_` to be accessible in the browser (Vite convention).

## Start the Development Servers

### Server (API)

```bash
cd streamline-server
npm run dev
```

This starts the Express server using `tsx` (TypeScript execution) on port 5137 (default).

### Client (Frontend)

```bash
cd streamline-client
npm run dev
```

This starts the Vite development server on port 5173 (default) with hot module replacement.

### Both Together

Run each in a separate terminal:

```bash
# Terminal 1: Server
cd streamline-server && npm run dev

# Terminal 2: Client
cd streamline-client && npm run dev
```

## Building for Production

### Server

```bash
cd streamline-server
npm run build        # Compiles TypeScript to dist/
npm run start        # Runs compiled JavaScript
```

### Client

```bash
cd streamline-client
npm run build        # Builds static assets to dist/
npm run preview      # Preview production build locally
```

## Running Tests

### Server Tests

```bash
cd streamline-server
npm run build                              # Must build first (tests run on compiled JS)
npm test                                    # Run all tests: node --test dist/lib/
node --test dist/lib/exportTypes.test.js   # Run specific test file
```

> **Note**: Some tests require Firebase credentials. Without credentials, expect 1–2 test failures (e.g., `roomGuestAccessInvite.test.ts`). 23/24 tests pass without credentials.

### Client Tests

```bash
cd streamline-client
npm test                                    # Run all tests: vitest run
npx vitest run src/lib/__tests__/roles.test.ts  # Run specific test
```

### Root Tests

```bash
# From root directory
npm test                                    # Runs test-usage.js, test-r2-connection.js
```

## Additional Scripts

### Server Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (tsx) |
| `npm run build` | Compile TypeScript |
| `npm run start` | Start production server |
| `npm test` | Build and run tests |
| `npm run security:probes` | Run security probe tests |
| `npm run smoke:deploy` | Run deploy smoke tests |
| `npm run cron:expire-emergency` | Run emergency recording expiration |
| `npm run auth:audit-duplicate-emails` | Audit for duplicate email accounts |

### Client Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm test` | Run Vitest tests |

## Deployment

StreamLine is deployed on Render. See the [render.yaml](../../render.yaml) for the full deployment configuration.

- **Server**: Node.js service (`streamline-server/`)
- **Client**: Static site (`streamline-client/dist/`)
- **Cron**: Emergency recording expiration (every 10 minutes)

For details, see the [Deployment documentation](../../deployment/README.md).
