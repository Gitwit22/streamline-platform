# StreamLine Corporate — Functionality Overview

> **Purpose:** Non-code audit of every feature surface in the Corporate module.
> Last updated: 2026-03-10

---

## 1. Module Summary

StreamLine Corporate is an enterprise communication platform. It provides internal
broadcasts, secure video meetings, team chat, document management, training modules,
and an employee directory — all scoped to a corporate organization.

| Metric | Count |
|--------|-------|
| Server route files | 8 |
| API endpoints | ~40 |
| Client pages | ~17 |
| Client API modules | 10 |
| Firestore collections | ~10 |

---

## 2. Roles

| Role | Scope |
|------|-------|
| `owner` | Full control — billing, compliance, settings, user management |
| `admin` | User management, broadcasts, training, documents, settings |
| `employee` | Chat, calls, directory, training (assigned), document acknowledgment |

Legacy roles automatically migrate: `leader` → `owner`; `manager` / `member` / `viewer` / `external` → `employee`.

---

## 3. Feature Inventory

### 3.1 Organization Management (`corpOrgs.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/orgs/create` | POST | any authenticated |
| `/orgs/join` | POST | any authenticated |
| `/orgs/lookup` | GET | public |
| `/orgs/info` | GET | any member |
| `/orgs/members` | GET | owner, admin |
| `/orgs/regenerate-code` | POST | owner, admin |
| `/orgs/remove-member` | POST | owner, admin |
| `/orgs/change-role` | POST | owner, admin |
| `/orgs/directory` | GET | any member |
| `/orgs/profile` | PATCH | any member |
| `/orgs/set-manager` | POST | owner, admin |

**Capabilities:**
- Org creation with unique slug
- Join code generation (format: `PREFIX-DIGITS`, e.g. `ACME-4829`)
- Public org lookup by slug
- Member directory with department tracking
- Profile customization (job title, department, location, bio, photo)
- Manager assignment for org chart hierarchy
- Role changes with owner-protection rules

---

### 3.2 User Profile (`corpMe.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/me` | GET | any member |
| `/me/profile` | PATCH | any member |
| `/me/self-promote` | POST | any member |

**Capabilities:**
- Authenticated member context (org, role, profile)
- Display name and profile field updates
- Self-promote flow (for pending members)

---

### 3.3 Internal Broadcasts (`corpBroadcasts.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/broadcasts` | GET | any member |
| `/broadcasts` | POST | owner, admin |
| `/broadcasts/:id` | PATCH | owner, admin |
| `/broadcasts/:id` | DELETE | owner, admin |
| `/broadcasts/:id/go-live` | POST | owner, admin |
| `/broadcasts/:id/stop` | POST | owner, admin |
| `/broadcasts/:id/watch` | GET | any member |

**Capabilities:**
- All-hands, town halls, corporate announcements
- LiveKit HLS streaming with token-gated access
- Scheduled and ad-hoc broadcasts
- Required vs. optional broadcast designation
- Scope control (public / internal)
- Viewer count and participant tracking
- Idempotent go-live (returns existing tokens if already live)
- Automatic audit logging

---

### 3.4 Video Calls (`corpCalls.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/calls` | GET | any member |
| `/calls` | POST | any member |
| `/calls/:id` | PATCH | any member |
| `/calls/:id/transcript` | GET | any member |
| `/calls/token` | POST | any member |

**Capabilities:**
- Scheduled and ad-hoc video calls
- 1-on-1 DM calls and channel calls
- LiveKit WebRTC token minting
- Deterministic DM room naming (sorted user IDs)
- Recording and transcript retrieval
- Call duration tracking
- Department-level call organization

---

### 3.5 Team Chat (`corpChat.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/chat/rooms` | GET | any member |
| `/chat/rooms/:id/messages` | GET | any member |
| `/chat/rooms/:id/messages` | POST | any member |
| `/chat/rooms` | POST | any member |

**Capabilities:**
- Group chat rooms
- Message pagination with `before` cursor
- Section/department-based organization
- Org-scoped message isolation

---

### 3.6 Documents (`corpDocuments.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/documents` | GET | any member |
| `/documents` | POST | owner, admin |
| `/documents/:id` | DELETE | owner, admin |
| `/documents/:id/acknowledge` | POST | any member |

**Capabilities:**
- Policy and document distribution
- Category filtering and pagination
- File metadata: URL, size, MIME type
- Acknowledgment tracking (confirmed / required counts)
- Version tracking
- Audit logging on create/delete

---

### 3.7 Training Modules (`corpTraining.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/training` | GET | any member |
| `/training` | POST | owner, admin |
| `/training/:id/progress` | PATCH | any member |
| `/training/:id/assign` | POST | owner, admin |

**Capabilities:**
- Required vs. optional training modules
- Department and user-level assignment
- Progress tracking (0–100 %)
- Status: not_started → in_progress → completed
- Completion timestamps and rates
- Duration and deadline fields
- Audit logging

---

### 3.8 Admin Panel (`corpAdmin.ts`)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/admin/users` | GET | owner, admin |
| `/admin/users/:id/role` | PATCH | owner, admin |
| `/admin/users/invite` | POST | owner, admin |
| `/admin/audit` | GET | owner, admin |
| `/admin/settings` | GET | owner, admin |
| `/admin/settings` | PATCH | owner, admin |
| `/admin/analytics` | GET | any member |

**Capabilities:**
- User listing with search, role, and status filters
- Role changes with audit logging
- Email-based invitations
- Audit log retrieval (up to 500 entries, action filter)
- Organization settings:
  - Timezone, branding, default role
  - Retention policies
  - SSO and MFA configuration
- Aggregated analytics:
  - Total broadcasts, calls, training modules
  - Active members count
  - Messages sent
  - Department-level compliance rates

---

## 4. Client Navigation (Sidebar)

### All Members
1. Dashboard
2. Chat
3. Calls
4. Broadcasts
5. Training
6. Documents
7. Directory
8. Org Chart
9. Settings

### Owner / Admin Only
10. Analytics
11. Members
12. Company

---

## 5. Firestore Collections

| Collection | Purpose |
|------------|---------|
| `orgs` (type: corporate) | Organization metadata |
| `orgMembers` (type: corporate) | Membership + role |
| `corpBroadcasts` | Broadcast records |
| `corpCalls` | Call records |
| `corpChatRooms` | Chat room metadata |
| `corpChatMessages` | Chat messages |
| `corpDocuments` | Document records |
| `corpDocumentAcks` | Acknowledgment records |
| `corpTraining` | Training module records |
| `corpTrainingProgress` | Per-user progress |
| `corpAudit` | Audit trail (separated from edu) |
| `rooms` | Shared LiveKit room registry |

---

## 6. Key Integrations

| System | Usage |
|--------|-------|
| **LiveKit** | WebRTC calls, HLS broadcast egress |
| **Firebase Auth** | User authentication |
| **Firestore** | Primary data store |

---

## 7. Client Route Map

```
/streamline/corporate                       → Landing (public)
/streamline/corporate/landing               → Landing (alias)
/streamline/corporate/login                 → Login
/streamline/corporate/join                  → Join org

Protected (/streamline/corporate/):
  dashboard                                 → Dashboard
  calls                                     → Video calls
  broadcasts                                → Broadcast list
  broadcasts/:id/studio                     → Broadcast studio
  broadcasts/:id/watch                      → Broadcast viewer
  chat                                      → Team chat
  training                                  → Training modules
  documents                                 → Document library
  directory                                 → Employee directory
  org-chart                                 → Organization chart
  settings                                  → Personal settings

Admin only:
  analytics                                 → Analytics dashboard
  admin                                     → Admin panel
  company                                   → Company settings
  members                                   → Member management
```

---

## 8. Comparison with EDU

| Capability | EDU | Corporate |
|------------|-----|-----------|
| Broadcasts | ✅ | ✅ |
| Video Calls | ✅ | ✅ |
| Chat | ✅ Faculty chat + Conversations | ✅ Team chat |
| Events & Scheduling | ✅ | ❌ |
| Rooms (virtual spaces) | ✅ | ❌ |
| Website Embeds | ✅ | ❌ |
| Documents | ❌ | ✅ |
| Training Modules | ❌ | ✅ |
| Student Management | ✅ | ❌ |
| Staff Onboarding Codes | ✅ | ❌ |
| Org Chart / Managers | ❌ | ✅ |
| Support Tickets | ✅ | ❌ |
| Notifications (in-app) | ✅ | ❌ |
| School Portal (public slug) | ✅ | ❌ |
| SSO / MFA Settings | ❌ | ✅ |
| Retention Policies | ❌ | ✅ |
| Analytics Dashboard | ❌ | ✅ |
| Audit Logging | ✅ (`eduAudit`) | ✅ (`corpAudit`) |
| Role Count | 6 | 3 |
