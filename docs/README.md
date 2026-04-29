# StreamLine Docs (Canonical Index)

This folder is the single place for platform documentation. The goal is: **few files, high signal, current reality**.

---

## 📘 Platform Documentation

### Overview (Wave 1 — Core Platform)

- [**Platform Introduction**](overview/platform-introduction.md) — What StreamLine is, who it's for, philosophy, core capabilities
- [**Platform Architecture**](overview/platform-architecture.md) — Technical architecture, system layers, infrastructure
- [**System Modules**](overview/system-modules.md) — All major modules (rooms, broadcast, editing, billing, admin, etc.)

### Features (Wave 2 — Feature Documentation)

- [**Broadcast Studio**](features/broadcast-studio.md) — HLS broadcasting, RTMP multi-streaming, layouts, recording
- [**Events**](features/events.md) — Event creation, scheduling, streaming
- [**Rooms**](features/rooms.md) — Room types, roles, visibility, presence modes, policies
- [**Messaging**](features/messaging.md) — In-room chat, moderation, permissions
- [**Media Library & Editor**](features/media-library.md) — Content library, timeline editor, projects, export pipeline

### Developer (Wave 3 — Developer Documentation)

- [**Repository Structure**](developer/repo-structure.md) — Monorepo layout, server and client structure
- [**Environment Setup**](developer/environment-setup.md) — Clone, install, env vars, start dev server, run tests
- [**API Reference**](developer/api-reference.md) — All API endpoints with examples
- [**Webhooks**](developer/webhooks.md) — Stripe webhooks, Horizon event webhooks, LiveKit hooks

### Admin (Wave 4 — Admin/Operator Documentation)

- [**Admin Dashboard**](admin/admin-dashboard.md) — Platform monitoring, support, diagnostics
- [**Permissions & Roles**](admin/permissions.md) — Role system, feature gating, room access policies

### User Guides (Wave 5)

- [**Going Live**](creator/going-live.md) — Creator guide: starting a broadcast
- [**Hosting Shows**](creator/hosting-shows.md) — Multi-participant shows, inviting guests
- [**School Onboarding**](edu/school-onboarding.md) — EDU guide: setting up a school
- [**Organization Setup**](corporate/organization-setup.md) — Corporate guide: enterprise onboarding

### Infrastructure (Wave 6 — Advanced Systems)

- [**LiveKit Integration**](infrastructure/livekit.md) — Room lifecycle, token generation, egress, permissions
- [**Video Pipeline**](infrastructure/video-pipeline.md) — Full pipeline: capture → HLS → editing → export
- [**Recording System**](infrastructure/recording.md) — Recording architecture, storage, playback
- [**Export Rendering**](infrastructure/export-rendering.md) — FFmpeg render worker, job queue, output formats

---

## Quick Reference

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
