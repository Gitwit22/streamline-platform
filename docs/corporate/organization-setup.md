# Organization Setup — Corporate Guide

This guide covers how enterprises can set up StreamLine for internal communications and broadcasting.

## Overview

StreamLine Corporate is designed for enterprises that need:

- Company-wide live broadcasts (town halls, all-hands meetings)
- Internal team collaboration rooms
- Employee communication infrastructure
- Organizational user management

## Getting Started

### Organization Onboarding

Enterprises can set up a StreamLine organization through the platform onboarding flow:

1. **Create Organization** — Set up company identity and initial admin
2. **Configure Settings** — Customize visibility defaults, access policies, and branding
3. **Add Team Members** — Create accounts for employees with appropriate roles
4. **Choose a Plan** — Select a subscription tier that matches your usage needs

### Admin Account

The first user becomes the organization administrator:

- Full control over organization settings
- User management (create, modify, deactivate accounts)
- Room and broadcast management
- Analytics and usage visibility

## Employee Management

### Account Provisioning

Create employee accounts with organization association:

- Each employee is linked to the organization via `orgId`
- Roles determine what employees can do within the platform
- Organization metadata enables corporate-specific features

### Role Structure

| Role | Description | Capabilities |
|---|---|---|
| **Org Admin** | Organization administrator | Full management, billing, settings |
| **Manager** | Department or team lead | Room creation, team management |
| **Employee** | Standard team member | Join rooms, participate in broadcasts |
| **Viewer** | View-only access | Watch broadcasts, no interaction |

## Internal Broadcasts

### Town Halls and All-Hands

For company-wide broadcasts:

1. **Create a room** — Set visibility to Private with auth required
2. **Configure for HLS** — Use HLS room type for large audiences
3. **Invite the organization** — Share the room link internally
4. **Go live** — Start the HLS broadcast
5. **Record** — Save the recording for employees who couldn't attend

### Team Meetings

For smaller team sessions:

1. **Create an RTC room** — Interactive format with audio/video for all
2. **Set visibility** — Unlisted or Private
3. **Invite team members** — Share invite links with participant roles
4. **Collaborate** — All participants can share audio, video, and screens

### Training Sessions

For employee training:

1. **Create a room** — Host presents, attendees watch
2. **Use Speaker layout** — Trainer is highlighted, attendees in sidebar
3. **Enable recording** — Save for future reference
4. **Share recording** — Make available via Content Library

## Multi-Destination Broadcasting

For external-facing corporate events:

1. **Configure destinations** — Set up YouTube, LinkedIn, or custom RTMP endpoints
2. **Start multistream** — Broadcast to internal and external audiences simultaneously
3. **Monitor** — Track destination health during the broadcast

## Analytics

Organization admins have access to:

- **Usage Statistics** — Recording minutes, streaming hours, storage consumption
- **Activity Tracking** — Room creation, active users, session history
- **Billing Overview** — Subscription status, usage against plan limits

## Security Considerations

For corporate environments:

| Feature | Recommendation |
|---|---|
| Room Visibility | Private (default) |
| Auth Required | Always enabled |
| Invite Expiry | Short (1-24 hours) |
| Max Invite Uses | Limited per invite |
| Presence Mode | Normal for participants, invisible for observers |

## Plan Selection

Choose a plan based on your organization's needs:

| Need | Recommended Plan |
|---|---|
| Small team meetings | Starter |
| Company broadcasts + recording | Pro |
| Multi-destination streaming | Pro |
| Video editing and production | Pro |
| Basic room access only | Free / Basic |

See [Pricing Plans](../developer/api-reference.md#list-plans) for current plan details and feature comparisons.
