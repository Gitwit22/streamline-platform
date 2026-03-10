# Support Hub Console — API Integration Contract

Everything the **support-hub.pages.dev** console needs to connect to the Streamline backend.

---

## 1. Base URL (Production API)

```
https://streamline-backend2test.onrender.com
```

---

## 2. Authentication

The `requireAuth` middleware accepts tokens in this priority order:

| Method | How to send | Details |
|---|---|---|
| **Firebase ID Token** (preferred) | `Authorization: Bearer <firebase-id-token>` | Verified via `firebaseAuth.verifyIdToken()`. The console needs the same **Firebase project config** (apiKey, authDomain, projectId) to sign users in and obtain an ID token. |
| **Legacy Server JWT** | `Authorization: Bearer <jwt>` **or** `token` cookie | Signed with `JWT_SECRET`. Payload must include `uid` (or `id`). Cookie is sent automatically with `credentials: "include"`. |

**Key requirement:** All requests must include `credentials: "include"` (for cookie-based auth) or an `Authorization` header. The CORS config already allows `credentials: true` and the origin `https://support-hub.pages.dev` is whitelisted.

### Firebase Config (if using Firebase Auth)

The console needs the **same Firebase project credentials** so it can call `signInWithEmailAndPassword` (or similar) and get an ID token to send as a Bearer token:

- `apiKey`
- `authDomain`
- `projectId`

---

## 3. Required Headers

```
Content-Type: application/json
Authorization: Bearer <token>
```

CORS is configured with `credentials: true` and `support-hub.pages.dev` in the allowlist.

---

## 4. API Endpoints

All routes are mounted at **`/api/edu/tickets`** and require an authenticated user with a non-denied role (`student_producer`, `student_producer_assigned`, `talent`, `viewer` are blocked).

### 4.1 `POST /api/edu/tickets` — Create ticket

**Body (JSON):**

```json
{
  "title": "string (required)",
  "description": "string (required)",
  "category": "technical | account | broadcast | room_access | event_issue | student_issue | other",
  "priority": "low | medium | high | urgent",
  "schoolId": "string (optional, defaults to orgId)",
  "tags": ["string"]
}
```

**Response (201):**

```json
{ "ticket": EduSupportTicket }
```

### 4.2 `GET /api/edu/tickets` — List tickets

**Query params (all optional):**

| Param | Type | Notes |
|---|---|---|
| `status` | string | `open`, `in_progress`, `waiting_on_user`, `resolved`, `closed` |
| `priority` | string | `low`, `medium`, `high`, `urgent` |
| `category` | string | See categories above |
| `schoolId` | string | Filter by school |
| `createdByUserId` | string | Elevated roles only |
| `assignedToUserId` | string | Elevated roles only |
| `limit` | number | Max 500, default 100 |

> Non-elevated users only see their own tickets. School admins see their school. District/support staff see everything.

**Response:**

```json
{ "tickets": EduSupportTicket[], "count": number }
```

### 4.3 `GET /api/edu/tickets/:ticketId` — Get ticket + messages

**Response:**

```json
{ "ticket": EduSupportTicket, "messages": EduSupportTicketMessage[] }
```

> `internal_note` messages are hidden from non-elevated users.

### 4.4 `PATCH /api/edu/tickets/:ticketId` — Update ticket (elevated roles only)

**Body (JSON, all optional):**

```json
{
  "status": "open | in_progress | waiting_on_user | resolved | closed",
  "priority": "low | medium | high | urgent",
  "category": "...",
  "assignedToUserId": "string | null",
  "assignedToName": "string | null",
  "tags": ["string"]
}
```

**Response:**

```json
{ "ticket": EduSupportTicket }
```

### 4.5 `POST /api/edu/tickets/:ticketId/messages` — Add reply / note

**Body (JSON):**

```json
{
  "type": "reply | internal_note | status_change",
  "message": "string (required)"
}
```

> Only elevated roles can post `internal_note`.

**Response (201):**

```json
{ "message": EduSupportTicketMessage }
```

### 4.6 `POST /api/edu/tickets/:ticketId/close` — Close ticket

**Body (JSON):**

```json
{ "resolutionNote": "string (optional)" }
```

**Response:**

```json
{ "ticket": EduSupportTicket }
```

---

## 5. Data Shapes

### `EduSupportTicket`

```ts
{
  id: string;
  tenantId: string;
  schoolId: string;
  createdByUserId: string;
  createdByName: string;
  createdByRole: string;
  title: string;
  description: string;
  category: "technical" | "account" | "broadcast" | "room_access" | "event_issue" | "student_issue" | "other";
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting_on_user" | "resolved" | "closed";
  assignedToUserId: string | null;
  assignedToName: string | null;
  tags: string[];
  createdAt: number | null;   // epoch ms
  updatedAt: number | null;   // epoch ms
  closedAt: number | null;    // epoch ms
}
```

### `EduSupportTicketMessage`

```ts
{
  id: string;
  authorUserId: string;
  authorName: string;
  authorRole: string;
  type: "reply" | "internal_note" | "status_change";
  message: string;
  createdAt: number | null;   // epoch ms
}
```

---

## 6. Role-Based Access Matrix

| Role | Create | View | Update / Assign | Internal Notes | Close |
|---|---|---|---|---|---|
| `faculty_teacher` | Own | Own only | No | No | Own only |
| `faculty_admin` / `principal` / `school_admin` | Yes | School-wide | Yes | Yes | Any in school |
| `district_staff` / `support_staff` | Yes | Tenant-wide | Yes | Yes | Any in tenant |
| `student_*` / `talent` / `viewer` | **Blocked** | **Blocked** | **Blocked** | **Blocked** | **Blocked** |

---

## 7. Enums Reference

### Ticket Status

`open` · `in_progress` · `waiting_on_user` · `resolved` · `closed`

### Ticket Priority

`low` · `medium` · `high` · `urgent`

### Ticket Category

`technical` · `account` · `broadcast` · `room_access` · `event_issue` · `student_issue` · `other`

### Message Type

`reply` · `internal_note` · `status_change`

---

## TL;DR — What the console needs

1. **Firebase project config** (apiKey, authDomain, projectId) — so it can authenticate users and obtain a Bearer token
2. **Base API URL** — `https://streamline-backend2test.onrender.com`
3. The **6-endpoint contract** above with the exact request/response shapes
