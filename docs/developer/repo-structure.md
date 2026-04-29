# Repository Structure

This document describes the layout of the StreamLine platform monorepo.

## Top-Level Structure

```
streamline-platform/
├── streamline-client/      # React frontend application
├── streamline-server/      # Express.js API server
├── deployment/             # Deployment configurations
├── docs/                   # Platform documentation
├── scripts/                # Shared build and maintenance scripts
├── test/                   # Root-level integration tests
├── .github/                # GitHub Actions CI/CD workflows
├── .githooks/              # Custom git hooks
├── render.yaml             # Render deployment configuration
├── package.json            # Root monorepo package (shared scripts)
└── package-lock.json       # Dependency lockfile
```

## Server (`streamline-server/`)

The backend is an Express.js 5 application written in TypeScript.

```
streamline-server/
├── index.ts                # Application entry point — middleware + route registration
├── livekitClient.ts        # LiveKit server SDK client initialization
├── routes/                 # API route handlers (42+ files)
│   ├── auth.ts             # Login, signup, password reset
│   ├── account.ts          # User profile and account settings
│   ├── admin.ts            # Admin dashboard endpoints
│   ├── adminStatus.ts      # Platform status API
│   ├── alertRoutes.ts      # Alert management
│   ├── billing.ts          # Stripe billing integration
│   ├── destinations.ts     # RTMP stream destinations
│   ├── diagnostics.ts      # System diagnostics
│   ├── editing.ts          # Video editing (projects, assets, exports)
│   ├── featureAccess.ts    # Feature flag checking
│   ├── hls.ts              # HLS streaming endpoints
│   ├── horizonApi.ts       # Horizon AI API
│   ├── horizonWs.ts        # Horizon WebSocket endpoint
│   ├── invites.ts          # Invite token redeem flow
│   ├── live.ts             # Live broadcast endpoints
│   ├── maintenance.ts      # Admin maintenance tools
│   ├── multistream.ts      # Multi-destination RTMP streaming
│   ├── onboarding.ts       # Onboarding workflows (EDU, Corporate)
│   ├── plans.ts            # Pricing plans API
│   ├── platformHealth.ts   # Health check endpoints
│   ├── publicHls.ts        # Public HLS (no auth)
│   ├── recordings.ts       # Recording CRUD
│   ├── roomChat.ts         # In-room chat API
│   ├── roomControls.ts     # Room start/stop controls
│   ├── roomGuestAccess.ts  # Guest access token minting
│   ├── roomInvites.ts      # Room invite management
│   ├── roomsActiveEmbed.ts # Active embed state
│   ├── roomsCreate.ts      # Room creation
│   ├── roomsHlsConfig.ts   # HLS configuration per room
│   ├── roomsLayout.ts      # Room layout management
│   ├── roomsPolicy.ts      # Room access policies
│   ├── roomsRecordings.ts  # Room recording status
│   ├── roomsResolve.ts     # Room info resolution
│   ├── savedEmbeds.ts      # Saved viewer embed configs
│   ├── skillsIntegration.ts# Skills API integration
│   ├── stats.ts            # Analytics and statistics
│   ├── supportActions.ts   # Support action endpoints
│   ├── supportTickets.ts   # Support ticket management
│   ├── telemetry.ts        # Telemetry event tracking
│   ├── usageRoutes.ts      # Usage tracking
│   ├── webhook.ts          # Stripe webhook receiver
│   └── horizon/
│       └── roomHooks.ts    # Horizon room event hooks
├── middleware/             # Express middleware
│   ├── requireAuth.ts      # JWT/Firebase authentication
│   ├── requireAuthOrInvite.ts  # Auth OR invite token
│   ├── requestId.ts        # Request ID generation
│   └── errorHandler.ts     # Global error handler
├── lib/                    # Shared utilities and services
│   ├── logger.ts           # Pino structured logger
│   ├── safeError.ts        # Safe error response utility
│   ├── livekit.ts          # LiveKit SDK import utility
│   ├── livekitPermissions.ts  # Role → permission mapping
│   ├── presenceMode.ts     # Presence mode logic
│   ├── exportTypes.ts      # Export job types + validation
│   ├── exportQueue.ts      # Firestore-backed export queue
│   ├── renderWorker.ts     # FFmpeg background render worker
│   ├── eduAudit.ts         # EDU audit logging utility
│   └── *.test.ts           # Unit tests (node:test)
├── services/               # External service integrations
│   └── livekitEgress.ts    # LiveKit HLS/recording egress
├── scripts/                # Admin and maintenance scripts
│   ├── expireEmergencyCron.js  # Cron: expire stale recordings
│   ├── auditDuplicateEmails.ts # Audit: duplicate email detection
│   ├── security-probes.ts     # Security probe tests
│   └── deploy-smoke.ts        # Deploy smoke tests
├── types/                  # TypeScript type definitions
├── tsconfig.json           # TypeScript configuration
├── package.json            # Server dependencies and scripts
└── dist/                   # Compiled JavaScript output (gitignored)
```

## Client (`streamline-client/`)

The frontend is a React 19 SPA built with Vite.

```
streamline-client/
├── src/
│   ├── App.tsx             # Main router — all route definitions
│   ├── main.tsx            # React entry point (StrictMode, ErrorBoundary, BrowserRouter)
│   ├── pages/              # Public and authentication pages
│   │   ├── LoginPage.tsx   # Login form
│   │   ├── SignupPage.tsx  # Registration form
│   │   ├── Privacy.tsx     # Privacy policy
│   │   ├── Terms.tsx       # Terms of service
│   │   ├── Support.tsx     # Support page
│   │   ├── BillingSuccess.tsx  # Post-checkout success
│   │   └── BillingCanceled.tsx # Post-checkout cancel
│   ├── creator/            # Authenticated creator features
│   │   ├── pages/          # Creator page components
│   │   │   ├── Room.tsx        # Main live room (170KB — video grid, chat, controls)
│   │   │   ├── Live.tsx        # Live broadcast viewer (HLS player)
│   │   │   ├── Join.tsx        # Room join flow
│   │   │   ├── Welcome.tsx     # Post-login landing
│   │   │   ├── RoomExitPage.tsx # Post-stream recording summary
│   │   │   ├── AdminDashboard.tsx  # Admin panel (82KB)
│   │   │   ├── AdminUsage.tsx      # Usage analytics
│   │   │   ├── SettingsBilling.tsx  # Billing portal (160KB)
│   │   │   ├── SettingsDestinations.tsx  # Stream destinations
│   │   │   ├── Checkout.tsx         # Checkout flow
│   │   │   ├── LearnMore.tsx        # Marketing page
│   │   │   ├── PricingExplainerPage.tsx # Pricing details
│   │   │   ├── InviteLanding.tsx    # Invite landing
│   │   │   ├── InviteRedeem.tsx     # Invite redeem
│   │   │   └── SupportDashboard.tsx # Support dashboard
│   │   ├── features/       # Feature modules
│   │   │   └── editing/    # Video editing
│   │   │       ├── EditorPage.tsx       # Timeline editor
│   │   │       ├── AssetLibrary.tsx     # Content library
│   │   │       ├── ProjectsDashboard.tsx # Project management
│   │   │       └── pages/
│   │   │           └── RenderAndUploadPage.tsx
│   │   ├── components/     # Creator-specific components
│   │   ├── hooks/          # Creator-specific hooks
│   │   └── routes.tsx      # Creator route registry
│   ├── components/         # Reusable UI components
│   │   ├── ui/             # Base UI primitives (buttons, modals, etc.)
│   │   └── dashboard/      # Dashboard widgets
│   ├── services/           # API client services
│   ├── lib/                # Shared utilities
│   │   ├── api.ts          # Core REST API client
│   │   ├── editingApi.ts   # Editing API client
│   │   ├── auth.ts         # Auth utilities
│   │   ├── roles.ts        # Role utilities + presence metadata
│   │   ├── meCache.ts      # User data cache
│   │   └── platformFlagsCache.ts  # Feature flags cache
│   ├── hooks/              # Global React hooks
│   │   ├── useFeatureAccess.ts     # Feature access hook
│   │   └── useEffectiveEntitlements.ts  # Plan entitlement hook
│   └── assets/             # Static assets (images, icons)
├── public/                 # Static public files
├── index.html              # HTML shell
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
├── package.json            # Client dependencies and scripts
└── dist/                   # Built output (gitignored)
```

## Documentation (`docs/`)

```
docs/
├── README.md               # Documentation index
├── overview/               # Wave 1: Core platform docs
│   ├── platform-introduction.md
│   ├── platform-architecture.md
│   └── system-modules.md
├── features/               # Wave 2: Feature documentation
│   ├── broadcast-studio.md
│   ├── events.md
│   ├── rooms.md
│   ├── messaging.md
│   └── media-library.md
├── developer/              # Wave 3: Developer documentation
│   ├── repo-structure.md
│   ├── environment-setup.md
│   ├── api-reference.md
│   └── webhooks.md
├── admin/                  # Wave 4: Admin documentation
│   ├── admin-dashboard.md
│   └── permissions.md
├── creator/                # Wave 5: Creator user guide
│   ├── going-live.md
│   └── hosting-shows.md
├── edu/                    # Wave 5: EDU user guide
│   └── school-onboarding.md
├── corporate/              # Wave 5: Corporate user guide
│   └── organization-setup.md
├── infrastructure/         # Wave 6: Infrastructure docs
│   ├── livekit.md
│   ├── video-pipeline.md
│   ├── recording.md
│   └── export-rendering.md
├── DEVELOPMENT.md          # Dev setup guide (existing)
├── STARTUP_GUIDE.md        # Quick orientation (existing)
└── ...                     # Other existing docs
```

## Deployment (`deployment/`)

```
deployment/
├── README.md               # Deployment notes
├── HLS_TESTING.md          # HLS testing guide
├── get-ngrok-urls.ps1      # Ngrok URL retrieval (Windows)
├── start-dev.ps1           # Dev startup script (Windows)
└── update-env-ngrok.ps1    # Env var update for tunnels (Windows)
```

## Key Configuration Files

| File | Purpose |
|---|---|
| `render.yaml` | Render deployment configuration (server, client, cron jobs) |
| `package.json` (root) | Monorepo scripts, shared dependencies |
| `streamline-server/tsconfig.json` | Server TypeScript configuration |
| `streamline-client/vite.config.ts` | Client Vite build configuration |
| `.gitignore` | Excluded files (node_modules, dist, .env, credentials) |
