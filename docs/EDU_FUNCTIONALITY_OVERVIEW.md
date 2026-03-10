# StreamLine EDU — Functionality Overview

> **Purpose:** Non-code audit of every feature surface in the EDU module.
> Last updated: 2026-03-10

---

## 1. Module Summary

StreamLine EDU is a school broadcasting and communication platform. It lets faculty
manage live broadcasts, schedule events, host virtual rooms, and communicate with
staff and students — all scoped to a single school organization.

| Metric | Count |
|--------|-------|
| Server route files | 16 |
| API endpoints | ~90 |
| Client pages | ~25 |
| Client API modules | 22 |
| Firestore collections | ~14 |

---

## 2. Roles

| Role | Scope |
|------|-------|
| `faculty_admin` | Full org management — settings, people, audit, embeds |
| `faculty_teacher` | Broadcasts, events, rooms, chat, calls |
| `student_producer` | Broadcast studio, rooms, media library |
| `student_producer_assigned` | Assigned variant of student producer |
| `talent` | Guest/on-camera talent |
| `viewer` | Read-only stream and recording access |

---

## 3. Feature Inventory

### 3.1 Live Broadcasting (`eduBroadcasts.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/broadcasts/go-live` | POST | faculty, student_producer |
| `/broadcasts/:id/stop` | POST | faculty, student_producer |
| `/broadcasts/:id` | DELETE | faculty_admin |
| `/broadcasts/:id/watch` | GET | any member |
| `/broadcasts` | GET | any member |

**Capabilities:**
- Multi-camera, screen-share, pre-recorded media
- LiveKit HLS egress with optional MP4 recording
- Layout options: grid, speaker, single, custom
- Viewer count tracking
- Automatic audit logging of go-live / stop events

---

### 3.2 Events & Scheduling (`eduEvents.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/events` | GET | any member |
| `/events/:eventId` | GET | any member |
| `/events` | POST | faculty |
| `/events/:eventId` | PATCH | faculty |
| `/events/:eventId/cancel` | POST | faculty |
| `/events/:eventId/set-live` | POST | faculty |
| `/events/:eventId/duplicate` | POST | faculty |

**Capabilities:**
- Scheduled event creation with date/time
- Countdown timers, password protection, auto-publish
- Event cancellation and duplication
- Link to broadcast go-live

---

### 3.3 Room Management (`eduRooms.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/rooms` | GET | any member |
| `/rooms/shareable` | GET | any member |
| `/rooms/:roomId` | GET | any member |
| `/rooms/:roomId/connect` | POST | any member |
| `/rooms` | POST | faculty_admin |
| `/rooms/:roomId` | PATCH | faculty_admin |
| `/rooms/:roomId` | DELETE | faculty_admin |

**Capabilities:**
- Room types: meeting, broadcast, hybrid
- Staff assignment and access control
- LiveKit room creation with scoped tokens
- Shareable external room links
- Broadcast layout configuration

---

### 3.4 Media Library / Recordings (`eduRecordings.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/recordings` | GET | any member |

**Capabilities:**
- Auto-archived broadcast recordings
- Status, URL, and duration metadata
- Searchable archive with date sorting
- Client pages: MediaLibrary (merged from legacy Archive, Recordings pages)

---

### 3.5 Student Management (`eduStudents.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/students` | GET | faculty |
| `/students` | POST | faculty_admin |
| `/students/:id/reset-password` | POST | faculty_admin |
| `/students/:id/status` | PATCH | faculty_admin |

**Capabilities:**
- Auto-generated temporary passwords
- Forced password change on first login
- Media club membership tracking
- Grade and homeroom fields
- Active / inactive toggle

---

### 3.6 Staff Management (`eduStaff.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/staff` | GET | faculty |
| `/staff` | POST | faculty_admin |
| `/staff/:id/regenerate-code` | POST | faculty_admin |
| `/staff/:id/status` | PATCH | faculty_admin |

**Capabilities:**
- 6-character onboarding codes for self-activation
- Pending → Active workflow
- Position title tracking
- Code regeneration

---

### 3.7 People & Directory (`eduPeople.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/directory` | GET | any member |
| `/people` | GET | faculty |
| `/people/invite` | POST | faculty_admin |
| `/people/:memberId/role` | PATCH | faculty_admin |
| `/people/:memberId/disable` | POST | faculty_admin |
| `/people/:memberId/resend` | POST | faculty_admin |
| `/people/:memberId/permissions` | GET | faculty_admin |
| `/people/:memberId/permissions` | PATCH | faculty_admin |

**Capabilities:**
- Unified member directory
- Email invitations
- Role reassignment
- Account disable/enable
- Granular permission overrides per member

---

### 3.8 Faculty Chat (`eduChat.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/chat/rooms` | GET | staff |
| `/chat/rooms` | POST | faculty |
| `/chat/rooms/direct` | POST | staff |
| `/chat/rooms/:id/messages` | GET | staff |
| `/chat/rooms/:id/messages` | POST | staff |
| `/chat/staff` | GET | staff |
| `/chat/staff/online` | GET | staff |
| `/chat/heartbeat` | POST | staff |

**Capabilities:**
- Group chat rooms and direct messages
- Deterministic DM room IDs (sorted user pair)
- Online presence tracking (heartbeat < 2 min)
- Message pagination with `before` cursor
- Composite-index fallback queries

---

### 3.9 Conversations / Unified Messaging (`eduConversations.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/conversations/stream` | GET | staff |
| `/conversations` | GET | staff |
| `/conversations/dm` | POST | staff |
| `/conversations/room` | POST | staff |
| `/conversations/:id` | GET | staff |
| `/conversations/:id/messages` | GET | staff |
| `/conversations/:id/messages` | POST | staff |
| `/conversations/:id/typing` | POST | staff |
| `/conversations/:id/read` | POST | staff |
| `/conversations/:id/members` | GET | staff |
| `/conversations/:id/members` | POST | staff |
| `/conversations/:id/members/:memberUid` | DELETE | staff |

**Capabilities:**
- Server-Sent Events (SSE) streaming
- Typing indicators
- Read receipts / mark-as-read
- Room member management (add/remove)

---

### 3.10 Video Calls (`eduCalls.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/calls` | GET | any member |
| `/calls` | POST | faculty, student_producer |
| `/calls/:id` | PATCH | any member |
| `/calls/pending` | GET | any member |
| `/calls/:id/dismiss` | PATCH | any member |
| `/calls/token` | POST | any member |

**Capabilities:**
- DM video calls with LiveKit WebRTC tokens
- Scheduled and ad-hoc calls
- Pending/incoming call detection
- Call dismissal
- Deterministic room names from sorted user IDs

---

### 3.11 Support Tickets (`eduTickets.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/tickets` | POST | staff |
| `/tickets` | GET | staff |
| `/tickets/:ticketId` | GET | staff |
| `/tickets/:ticketId` | PATCH | staff |
| `/tickets/:ticketId/messages` | POST | staff |
| `/tickets/:ticketId/close` | POST | staff |

**Statuses:** open, in_progress, waiting_on_user, resolved, closed
**Priorities:** low, medium, high, urgent
**Categories:** technical, account, broadcast, room_access, event_issue, student_issue, other

---

### 3.12 Website Embeds (`eduEmbeds.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/embeds/event` | POST | faculty_admin |

**Capabilities:**
- Secure HLS embed for school websites
- Access modes: public, unlisted, password-protected
- Org-level embed policy enforcement
- Deterministic embed IDs per event

---

### 3.13 Notifications (`notifications.ts` + `notificationService.ts`)

**Notification types:**
- Communication: missed calls, new chat messages, room invites
- Broadcast: starting soon, started, ended, mentions
- Events: reminders, cancellations, updates
- System: org invites, role changes, system messages

**Capabilities:**
- Firestore-backed (`notifications` collection)
- Polling (30 s interval)
- Mark read / mark all read
- Unread count badge

---

### 3.14 Organization Settings & Audit (`eduSettings.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/org` | GET | any member |
| `/org` | PATCH | faculty_admin |
| `/storage-summary` | GET | faculty_admin |
| `/audit` | GET | faculty_admin |
| `/audit` | POST | faculty, student_producer |

**Capabilities:**
- Org name, branding, and slug management
- Storage quota summary
- Audit log viewing (last 50 entries, filterable)
- Audit event creation for broadcast / event actions

---

### 3.15 School Portal (`eduPortal.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/:slug` | GET | public |
| `/:slug/login` | POST | public |
| `/:slug/change-password` | POST | public |
| `/:slug/activate-staff` | POST | public |
| `/:slug/validate-student` | POST | public |
| `/:slug/activate-student` | POST | public |

**Capabilities:**
- Public school portal accessed via slug URL
- Student login with school code
- Staff self-activation with onboarding code
- Forced password change flow

---

### 3.16 Public / Unauthenticated (`eduPublic.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/events/:eventId` | GET | public |
| `/embed/meta` | GET | public |
| `/embed/auth` | POST | public |
| `/embed` | GET | public |
| `/branding/:orgId` | GET | public |
| `/branding/slug/:slug` | GET | public |

---

### 3.17 Bootstrap & Maintenance (`eduBootstrap.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/bootstrap` | POST | authenticated |
| `/members/promote` | POST | authenticated |
| `/seed-test-school` | POST | authenticated |

---

## 4. Client Navigation (Sidebar)

### Faculty Admin / Teacher
1. Dashboard
2. Broadcast Studio
3. Events
4. Website Embed *(admin only)*
5. Rooms
6. People
7. Faculty Chat *(staff only)*
8. Video Calls *(staff only)*
9. Media Library
10. Support *(staff only)*
11. School Settings *(admin only)*

### Student Producer
1. Dashboard
2. Broadcast Studio
3. Rooms
4. Recordings
5. Students

---

## 5. Firestore Collections

| Collection | Purpose |
|------------|---------|
| `orgs` | Organization metadata |
| `orgMembers` | Membership + role |
| `events` | Scheduled events |
| `eduBroadcasts` | Broadcast records |
| `eduCalls` | Call records |
| `eduChatRooms` | Chat room metadata |
| `eduChatMessages` | Chat messages |
| `eduChatPresence` | Online heartbeats |
| `eduAudit` | Audit trail (separated from corp) |
| `students` | Student accounts |
| `pendingStaff` | Onboarding staff |
| `recordings` | Archived recordings |
| `embeds` / `savedEmbeds` | Website embed configs |
| `notifications` | In-app notifications |
| `eduSupportTickets` | Support tickets |

---

## 6. Key Integrations

| System | Usage |
|--------|-------|
| **LiveKit** | WebRTC rooms, HLS egress, recording |
| **Firebase Auth** | User authentication |
| **Firestore** | Primary data store |
| **bcrypt** | Embed password hashing |

---

## 7. Client Route Map

```
/streamline/edu/                    → Landing (public)
/streamline/edu/login               → Login
/streamline/edu/learn-more          → Marketing
/streamline/edu/get-started         → Sign-up flow
/streamline/edu/onboarding          → Org onboarding
/streamline/edu/embed/event         → Public embed player
/:schoolSlug                        → School portal (public)

Protected (/streamline/edu/protected/):
  dashboard                         → Dashboard
  broadcast                         → Broadcast studio
  rooms                             → Room list
  rooms/:roomId/prejoin             → Pre-join screen
  rooms/:roomId                     → Room view
  events                            → Event list
  media-library                     → Recordings archive
  people                            → People hub
  embed                             → Embed manager (admin)
  chat                              → Faculty chat (staff)
  calls                             → Video calls (staff)
  support                           → Ticket system (staff)
  settings                          → Org settings (admin)
  change-password                   → Password change
  roles-permissions                 → Permission manager (admin)
```
