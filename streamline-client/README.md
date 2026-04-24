# StreamLine Client

React + TypeScript + Vite frontend for the StreamLine platform.

## Multi-Lane Deployment

This repository produces **two distinct frontend deployments** from the same codebase and the same branch, controlled entirely by environment variables. There is no need to split the repo or maintain long-lived product branches.

### VITE_STREAMLINE_PROGRAM

Set this environment variable at build time to target a specific StreamLine lane:

| Value | Deployment |
|---|---|
| `edu` (default) | StreamLine EDU — school learning & broadcast platform |
| `corporate` | StreamLine Corporate — organization communication platform |

If the variable is not set, the app defaults to `edu` and keeps both lanes accessible (local development mode).

### Building for each lane

```bash
# EDU frontend build
VITE_STREAMLINE_PROGRAM=edu npm run build

# Corporate frontend build
VITE_STREAMLINE_PROGRAM=corporate npm run build
```

### Example env files

| File | Purpose |
|---|---|
| `.env.example` | Full reference of all supported env vars |
| `.env.edu.example` | Production template for the EDU deployment |
| `.env.corporate.example` | Production template for the Corporate deployment |

Copy the appropriate template to `.env` (or set vars via your hosting provider) before building.

### Deployment model

```
Frontend Deployments (separate hosting projects):
  streamline-edu-frontend        VITE_STREAMLINE_PROGRAM=edu
  streamline-corporate-frontend  VITE_STREAMLINE_PROGRAM=corporate

Shared Backend (single API service):
  streamline-api                 handles both lanes via x-program-domain header
                                 and auth/org scoping
```

Both frontend deployments point to the same backend API (`VITE_API_BASE_URL`). The backend distinguishes lanes using the `x-program-domain` request header that the frontend automatically includes on every API request.

> **Security note:** Frontend env vars are public and compiled into the JS bundle. Do not store secrets in `VITE_*` variables.

### How it works

The program config system lives in `src/config/programs/`:

- `types.ts` — typed `ProgramConfig` interface
- `edu.ts` — EDU config (routes, features, branding, domain)
- `corporate.ts` — Corporate config
- `index.ts` — resolver (`getProgramConfig()`, `getCurrentProgramKey()`, `isFeatureEnabled()`)

React hooks are in `src/hooks/useProgramConfig.ts`:
- `useProgramConfig()` — returns the full config
- `useCurrentProgramKey()` — returns `"edu"` or `"corporate"`
- `useFeatureFlag(key)` — returns a single feature flag boolean

The active program config controls:
- Which route tree is accessible (opposite-lane routes show a "Not available" page)
- Navigation sidebar app name / branding
- `x-program-domain` header on all API requests

---

## Development

```bash
npm install
npm run dev
```

## Testing

```bash
npm run test
```

## Original Vite template notes

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

