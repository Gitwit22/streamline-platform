# Admin Dashboard

The Admin Dashboard provides platform-wide management capabilities for StreamLine administrators.

## Overview

The Admin Dashboard is accessible at `/admin/dashboard` and requires the `isAdmin` flag on the user's Firestore document. It provides visibility into platform health, user activity, and system operations.

## Accessing the Dashboard

1. Navigate to `/admin/dashboard` (or click **Admin** in the sidebar)
2. Requires authenticated user with `isAdmin: true` on their user document
3. Admin status is checked on both client and server for every request

## Dashboard Sections

### Platform Overview

- **Active Rooms** — Count of currently live rooms
- **Active Users** — Currently connected users across all rooms
- **Total Users** — Platform-wide user count
- **System Health** — Service status indicators

### Usage Analytics

Accessible at `/admin/usage`:

- **Recording minutes** — Total platform recording usage
- **Streaming hours** — Aggregate streaming time
- **Storage consumption** — R2 storage usage across all users
- **Monthly trends** — Usage trends over time

### Support Management

Accessible at `/admin/support`:

- **Ticket Queue** — View and manage support tickets from users
- **Ticket Actions** — Respond to, escalate, or resolve tickets
- **User Context** — View user account details alongside ticket

### System Diagnostics

Available via API:

- **Health Check** — `GET /api/platformHealth` for service status
- **Diagnostics** — `GET /api/diagnostics` for system information
- **Alert Management** — `GET /api/alerts` for platform alerts

## Administrative Actions

### User Management

- View user accounts and profiles
- Check user subscription status and plan
- Review user usage statistics

### Platform Maintenance

- **Maintenance Mode** — Enable/disable via `POST /api/maintenance`
- **Emergency Recording Cleanup** — Automatic via cron job (every 10 minutes)
- **Duplicate Email Audit** — Run via `npm run auth:audit-duplicate-emails`

### Alert Configuration

- Create and manage platform-wide alerts
- Configure alert thresholds and notification rules

## Monitoring

### Horizon WebSocket

Admin users can connect to the Horizon WebSocket (`/ws/horizon`) for real-time platform observability:

- Authenticated via JWT token (query parameter or cookie)
- Provides real-time event stream
- Keepalive via ping/pong messages

### Health Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `/api/health` | None | Basic liveness check |
| `/api/platformHealth` | None | Detailed health status |
| `/api/diagnostics` | Admin | System diagnostic information |
| `/api/admin/status` | Admin | Admin platform status |

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/admin` | GET | Dashboard overview data |
| `/api/admin/status` | GET | Platform status |
| `/api/diagnostics` | GET | System diagnostics |
| `/api/platformHealth` | GET | Health check |
| `/api/alerts` | GET | List platform alerts |
| `/api/alerts` | POST | Create/manage alerts |
| `/api/support` | GET | List support tickets |
| `/api/supportActions` | POST | Execute support actions |
| `/api/maintenance` | POST | Maintenance mode control |
