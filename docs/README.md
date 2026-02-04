# StreamLine Docs (Canonical Index)

This folder is the single place for platform documentation. The goal is: **few files, high signal, current reality**.

## Start Here

- Dev setup + env + local runbook: [DEVELOPMENT.md](DEVELOPMENT.md)
- Startup guide (quick orientation): [STARTUP_GUIDE.md](STARTUP_GUIDE.md)
- Streaming contract (API surface): [STREAMING_API_CONTRACT.md](STREAMING_API_CONTRACT.md)
- Permissions / roles / invites (room security model): [PERMISSIONS_AND_INVITES.md](PERMISSIONS_AND_INVITES.md)
- Usage limits + billing flags + enforcement contract: [USAGE_BILLING_LIMITS.md](USAGE_BILLING_LIMITS.md)
- Storage (R2) + operational notes: [OPS_STORAGE.md](OPS_STORAGE.md)
- Editing suite docs: [Editor/README.md](Editor/README.md)
- Roadmap / what's next: [ROADMAP.md](ROADMAP.md)

## Current UX / Routing (Important)

- **Post-stream / post-recording is** `/room-exit/:recordingId` (canonical).
- `/stream-summary/:recordingId` is a **legacy alias** that redirects to `/room-exit/:recordingId`.
- Editing entry points:
  - `/content` (asset library)
  - `/projects` (projects dashboard)
  - `/editing/editor/:projectId` (timeline editor; use `new` to create from query params)

## Docs Principles

- Prefer linking to code entry points over duplicating long implementation logs.
- If a doc becomes stale, fold the relevant parts into a canonical doc and delete the stale file.
