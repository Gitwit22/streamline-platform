# Events

The Events system in StreamLine enables scheduling, promoting, and hosting live events that are built on top of the Rooms and Broadcast infrastructure.

## Overview

Events connect the room/broadcast system with scheduling, audience management, and discoverability. An event represents a planned live session with a defined start time, description, and access controls.

## Event Creation

Events are created by hosts and linked to a room session:

- **Title and Description** — Event name and details for promotion
- **Scheduling** — Set a start date and time for the event
- **Room Configuration** — Events are backed by StreamLine rooms with pre-configured settings
- **Access Controls** — Configure whether the event is public, invite-only, or requires authentication

## Event Scheduling

- Events can be scheduled for future dates
- Hosts receive reminders before the event start time
- Scheduled events can be shared via invite links
- The room is created or activated when the host starts the event

## Event Streaming

When an event goes live:

1. The host opens the event room
2. HLS broadcast is started for audience viewing
3. Multi-destination streaming can be enabled for external platform simulcasting
4. The event page shows the live HLS player for viewers
5. Chat and audience interaction are available during the live event

## Ticketing and Invites

Events support audience management through:

- **Invite Links** — Generate shareable links for attendees
- **Role-Based Access** — Invited users can be assigned roles (viewer, participant, co-host)
- **Access Requirements** — Events can require authentication, specific invite tokens, or payment
- **Guest Access** — External users can join via invite without creating a full account

## Integration with Rooms

Events are built on the Room system:

- Each event is backed by a StreamLine room
- Room policies (visibility, auth requirements) apply to the event
- Broadcasting, recording, and multi-streaming capabilities are inherited from the Broadcast Studio
- Post-event recordings are automatically available if HLS was enabled
