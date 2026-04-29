# StreamLine Platform Overview

## What StreamLine Is

StreamLine is a real-time communication, broadcasting, and media production platform designed for creators, organizations, schools, and enterprises. The platform combines live streaming, video conferencing, media production, messaging, and event management into a single integrated system.

Built on modern real-time media infrastructure, StreamLine leverages WebRTC technology (via LiveKit) to deliver low-latency video and audio communication while supporting professional broadcast workflows such as multi-camera production, live switching, and automated recording.

The system is modular, allowing different platform verticals — such as **StreamLine EDU**, **StreamLine Corporate**, and the **Creator** platform — to share the same underlying infrastructure while delivering tailored user experiences.

## Who It Is For

StreamLine serves several distinct audiences:

- **Creators** — Independent streamers and content producers who need professional-grade broadcasting tools without the complexity of traditional broadcast software.
- **Educators** — Schools and institutions that need virtual classrooms, lecture broadcasting, and student collaboration tools.
- **Enterprises** — Companies requiring internal broadcasting, town halls, team collaboration, and corporate communication infrastructure.
- **Developers** — Engineers building on or extending the StreamLine platform through its API and modular architecture.

## Platform Philosophy

StreamLine is built on several core principles:

1. **Unified Infrastructure** — One platform handles live streaming, recording, video editing, and distribution rather than stitching together multiple third-party services.
2. **Real-Time First** — WebRTC-based communication ensures sub-second latency for interactive experiences, with HLS fallback for large-audience broadcasts.
3. **Modular Verticals** — The same core systems (rooms, streaming, recording, billing) power different verticals (Creator, EDU, Corporate) with vertical-specific UI and permissions.
4. **Plan-Gated Features** — Functionality scales with subscription tier (Free, Starter, Pro, Basic), enforced at both the API and UI layer.
5. **Privacy and Security** — Session-based authentication with httpOnly cookies, encrypted stream keys, role-based permissions, and invite-scoped room access.

## Core Capabilities

| Capability | Description |
|---|---|
| **Live Streaming** | WebRTC rooms via LiveKit with support for multiple participants, screen sharing, and real-time layout switching |
| **HLS Broadcasting** | Server-side composite recording and HLS segment delivery for large audiences via CDN |
| **Multi-Destination Streaming** | RTMP restreaming to YouTube, Twitch, Facebook, Instagram, and custom destinations simultaneously |
| **Recording** | Automatic room composite recording with cloud storage (Cloudflare R2) |
| **Video Editing** | Timeline-based editor with multi-track support, clip trimming, drag-and-drop, and FFmpeg-powered export |
| **Content Library** | Asset management for uploaded media files with organized storage |
| **Guest Access** | Invite-based room entry with role-scoped permissions (host, co-host, participant, guest, viewer) |
| **Chat & Messaging** | In-room real-time messaging with moderation controls |
| **Billing & Plans** | Stripe-integrated subscription management with usage tracking and plan-gated feature access |
| **Admin Dashboard** | Platform-wide analytics, user management, support tickets, and system diagnostics |
| **AI Integration** | Horizon agent framework for automated room assistance (chat and voice event processing) |

## Platform Verticals

### StreamLine Creator

The default experience for independent creators and content producers. Includes the broadcast studio, content library, video editor, multi-destination streaming, and audience management tools.

### StreamLine EDU

Tailored for educational institutions. Organizations can onboard as EDU entities with faculty admin roles, classroom-oriented room configurations, and institution-level user management.

### StreamLine Corporate

Designed for enterprise use cases including company-wide broadcasts, internal town halls, employee onboarding sessions, and team collaboration rooms.

## Platform Architecture Overview

StreamLine is structured as a full-stack TypeScript monorepo:

```
streamline-platform/
├── streamline-client/    # React 19 + Vite frontend (SPA)
├── streamline-server/    # Express.js 5 API server (Node.js)
├── deployment/           # Render deployment configs
├── docs/                 # Platform documentation
└── scripts/              # Shared build and maintenance scripts
```

- **Frontend**: React 19 with Vite, using React Router v6 for SPA routing. LiveKit React components handle real-time video UI.
- **Backend**: Express.js 5 with TypeScript. 42+ route modules covering rooms, streaming, editing, billing, admin, and more.
- **Real-Time**: LiveKit WebRTC server with server-side SDK for room management, token generation, and egress control.
- **Storage**: Cloudflare R2 (S3-compatible) for recordings, HLS segments, exported videos, and user-uploaded assets.
- **Database**: Google Firestore for user accounts, room state, billing records, usage tracking, and platform configuration.
- **Payments**: Stripe for subscription management, checkout sessions, and webhook-driven billing lifecycle.
- **Monitoring**: Pino structured logging, request ID tracing, Horizon WebSocket observability, and platform health endpoints.

For detailed technical architecture, see [Platform Architecture](./platform-architecture.md).
