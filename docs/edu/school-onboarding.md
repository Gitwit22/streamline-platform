# School Onboarding — EDU Guide

This guide covers how educational institutions can get started with StreamLine EDU.

## Overview

StreamLine EDU is designed for schools and educational institutions that need:

- Virtual classrooms and lecture broadcasting
- Student collaboration rooms
- Institutional user management
- Faculty admin controls

## Creating an EDU Organization

### Step 1: Organization Setup

Create a new EDU organization via the onboarding endpoint:

```
POST /api/onboarding/create-edu-org
Body: {
  "orgName": "Springfield School District",
  "orgType": "edu",
  "email": "admin@springfield.edu",
  "password": "securePassword"
}
```

This creates:
- A new organization document with `orgType: edu`
- The first **Faculty Admin** user account
- Association between the user and the organization

### Step 2: Faculty Admin Account

The first user created during onboarding becomes the Faculty Admin:

- Full administrative control over the EDU organization
- Can create additional staff accounts
- Can manage organization settings
- Can create rooms and broadcasts for the institution

### Step 3: Configure the Organization

After creation, the Faculty Admin can:

1. **Set organization details** — Name, description, branding
2. **Configure default room settings** — Default visibility, access policies
3. **Manage feature access** — Based on the organization's subscription plan

## User Management

### Account Types

| Type | Description |
|---|---|
| **Faculty Admin** | Full org management, room creation, broadcasting |
| **Teacher/Staff** | Room creation, class management, moderation |
| **Student** | Room participation, limited creation |

### Adding Users

Faculty admins manage user accounts for their organization:

1. Create accounts for teachers and staff
2. Set appropriate roles and permissions
3. Organize users by department or class

### Account Association

Each user in an EDU organization has:

```typescript
{
  orgId: "org-document-id",
  orgName: "Springfield School District",
  orgType: "edu"
}
```

This metadata enables:
- Organization-scoped features in the UI
- EDU-specific routing and navigation
- Institution-level analytics and reporting

## Classroom Broadcasting

### Setting Up a Virtual Classroom

1. **Create a room** with appropriate visibility (Private recommended for classes)
2. **Invite students** via invite links with the **Participant** role
3. **Start the session** — Enable HLS if needed for larger audiences
4. **Record** — Recordings can be made available for students who missed the class

### Room Recommendations for Education

| Setting | Recommended Value | Reason |
|---|---|---|
| Visibility | Private | Only invited students can join |
| Auth Required | Yes | Ensures only authenticated users access |
| Room Type | RTC | Interactive participation |
| Layout | Speaker | Teacher-focused with student sidebar |

## Audit Logging

EDU organizations have built-in audit logging for compliance and administration:

- All significant actions are logged via `writeEduAudit()`
- Audit logs include metadata about the action, actor, and context
- Logs are stored in Firestore for administrative review

## Integration with StreamLine Platform

EDU organizations share the same underlying infrastructure as the Creator platform:

- **Rooms** — Same LiveKit-based video infrastructure
- **Recordings** — Cloud storage on R2
- **Billing** — Plan-based feature gating
- **Security** — Same authentication and authorization systems

The EDU vertical adds:
- Organization-level user management
- Faculty admin role
- EDU-specific onboarding flow
- Audit logging for institutional compliance
