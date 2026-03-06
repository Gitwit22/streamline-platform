# StreamLine EDU — Real School Testing Guide

> **Goal:** Stop relying on fake demo behaviour for core EDU testing.
> Use a real internal school tenant to test onboarding, login, rooms, teachers, students, and permissions.

---

## Quick Start

### 1. Sign up a test admin account

If you don't already have one:

```bash
curl -X POST http://localhost:5137/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{ "email": "admin@streamline-test.edu", "password": "TestAdmin1!", "displayName": "Principal Johnson", "timeZone": "America/Detroit", "tosAccepted": true }'
```

### 2. Seed the test school

**Option A — CLI (recommended for local dev):**

```bash
cd streamline-server
npx tsx scripts/seed-edu-test-school.ts --adminEmail admin@streamline-test.edu
```

**Option B — API (for remote / CI):**

```bash
curl -X POST http://localhost:5137/api/maintenance/edu/seed-test-school \
  -H "Content-Type: application/json" \
  -H "x-maintenance-key: YOUR_MAINTENANCE_KEY" \
  -d '{ "adminEmail": "admin@streamline-test.edu" }'
```

### 3. Access the school

| What | URL |
|------|-----|
| School portal (public) | `/streamline/edu/portal/streamline-test-school` |
| Staff login | Use the portal → Faculty/Staff tab |
| Student login | Use the portal → Student tab |
| Faculty admin dashboard | `/streamline/edu/dashboard` (after login) |

---

## What Gets Seeded

| Entity | Details |
|--------|---------|
| **Org** | "StreamLine EDU Test School" — `edu-test-school-001` |
| **Slug** | `streamline-test-school` |
| **Admin** | The `--adminEmail` account gets `faculty_admin` role |
| **Rooms** | Morning Announcements, Teacher Meeting Room, Football Broadcast, Media Club Studio |
| **Pending Staff** | Mr. Carter (code: `CARTER-2026`), Ms. Brooks (code: `BROOKS-2026`) |
| **Students** | jake.t, emily.c, marcus.j, sofia.p, liam.o (password: `Changeme1!`) |
| **Events** | Morning Announcements (tomorrow), Friday Night Football, Media Club Show |
| **Recordings** | 3 metadata entries (Announcements, Media Club, Football) |

---

## Testing Flows

### School Portal Routing
1. Navigate to `/streamline/edu/portal/streamline-test-school`
2. Verify school name, district, and logo load
3. Test tab switching: Faculty/Staff, Student, Activate Account

### Teacher Activation Codes
1. On the portal, choose "Activate Account"
2. Enter code: `CARTER-2026`, fill in name/password
3. Verify successful account creation and login

### Student Account Creation
1. Log in as faculty admin
2. Navigate to People → Students tab
3. Create a new student account
4. Verify temp password generation

### Student First-Password-Change
1. On the portal, choose "Student" tab
2. Log in with username `jake.t` / password `Changeme1!`
3. You should be redirected to change-password flow
4. Complete password change and verify login works with new password

### Room Entry via PreJoin
1. Navigate to Rooms page
2. Click a room (e.g., "Morning Announcements")
3. Verify PreJoin page loads with device selection
4. Join room and verify RoomView loads

### Studio Permissions / Behavior
1. Log in as different roles (admin, student_producer, viewer)
2. Verify room access controls match `allowedRoles`
3. Verify broadcast/recording toggles are role-gated

### People Management
1. Navigate to People page
2. Verify staff list shows real members
3. Verify student list shows seeded students
4. Test add/edit/status-toggle for staff and students

---

## Demo Mode vs. Real School

| Scenario | Use |
|----------|-----|
| **Core EDU development & QA** | Real test school (this guide) |
| **Sales demos / marketing previews** | Demo mode (bypass) |
| **Public landing page exploration** | Public routes (`/streamline/edu`) |

### Demo mode is preserved for:
- Lightweight quick preview without sign-up
- Marketing screenshots / walkthroughs  
- Role switching demo (admin / teacher / student_producer)

### Demo mode should NOT be used for:
- Testing login/auth flows
- Testing room/studio real-time features
- Validating permissions and role gating
- Testing student password flows
- Testing school portal routing
- Verifying real database writes

---

## Architecture

### Server endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/edu/portal/:slug` | Public | Lookup school info by slug |
| POST | `/api/edu/portal/:slug/login` | Public | Staff or student login |
| POST | `/api/edu/portal/:slug/change-password` | Public | Password change flow |
| POST | `/api/edu/portal/:slug/activate-staff` | Public | Staff onboarding code activation |
| POST | `/api/maintenance/edu/seed-test-school` | Admin/Key | Seed the test school |

### Client flow

```
SchoolPortal (/:schoolSlug)
  ├── Staff Login → JWT cookie → EduProtectedRoute → EduShell → Dashboard
  ├── Student Login → JWT cookie → redirect to change-password (if needed)
  └── Activate Account → creates user + membership → JWT cookie → Dashboard
```

### Data Model

```
tenantCol("orgs")/{orgId}
  ├── slug, shortCode, status, branding, defaults, accessPolicy
  └── isTestSchool: true

globalCol("users")/{uid}
  ├── orgId, orgType: "edu", orgRole

tenantCol("orgMembers")/{orgId}_{uid}
  ├── role: "faculty_admin" | "student_producer" | ...

tenantCol("rooms")/{roomId}
  ├── orgId, roomType, allowedRoles

tenantCol("pendingStaff")/{id}
  ├── orgId, onboardingCode, status: "pending" | "active"

tenantCol("students")/{id}
  ├── orgId, username, password (hashed), mustChangePassword

tenantCol("events")/{id}
tenantCol("recordings")/{id}
```

---

## Re-seeding / Reset

The seed script is idempotent. Re-running it will update existing records (merge), not duplicate them. To fully reset:

1. Delete the org and related docs from Firestore
2. Re-run the seed script

---

## Environment Variables

No new env vars required. The seed uses existing:
- `MAINTENANCE_KEY` — for API-based seeding
- `JWT_SECRET` — for portal login token minting
- `APP_ENV` — determines Firestore path prefix (`local`, `test`, `prod`)
