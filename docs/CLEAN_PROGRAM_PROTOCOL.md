# Clean Program Protocol (EDU)

This protocol chronicles every demo/bypass/mock/local-only data path in the EDU lane so it can be removed cleanly later.

This doc groups findings into:
- **Dev/demo bypass** (lets you use EDU UI without real auth)
- **Local-only persistence** (localStorage/sessionStorage state that stands in for a backend)
- **Hard-coded placeholder UI** (numbers/lists that aren’t real data)

---

## 1) Dev/demo bypass (auth + roles)

### A) EDU bypass flag
- **Key**: `localStorage["sl_edu_bypass"] = "1"`
- **Files**:
  - `streamline-client/src/edu/state/eduMode.ts` (reads/writes the bypass flag; only allowed on localhost or Vite dev)
  - `streamline-client/src/edu/entry/EduLogin.tsx` (shows “Bypass login (demo admin)” button)

### B) Demo “me” user object
- **Behavior**: when bypass is enabled, the app pretends you are a faculty admin.
- **Files**:
  - `streamline-client/src/edu/layout/EduProtectedRoute.tsx`
    - Sets `me = { uid: "edu-demo", orgName: "EDU Demo", role/orgRole: "faculty_admin" }`

**Removal plan**
1. Delete the bypass flag logic in `eduMode.ts`.
2. Remove the bypass button from `EduLogin.tsx`.
3. Remove the bypass branch in `EduProtectedRoute.tsx` so EDU always requires real auth.

---

## 2) Settings demo persistence (bypass-mode only)

### A) Local demo settings snapshot
- **Key**: `localStorage["sl_edu_demo_settings_v1"]`
- **File**: `streamline-client/src/edu/pages/Settings.tsx`
- **What it does**:
  - In bypass mode, Settings loads from localStorage instead of calling `/api/edu/*`.
  - Saving updates the local snapshot and prepends a fake audit entry (`org.settings_updated`).

**Removal plan**
- Delete `DEMO_STATE_KEY`, `readDemoState()`, `writeDemoState()`, plus the `if (isBypass)` branches.
- Keep only the real API flow (`fetchEduOrg`, `fetchEduStorageSummary`, `fetchEduAudit`, `patchEduOrg`).

---

## 3) Events: localStorage-backed event store (major “mock-ish” dependency)

### A) Local events DB
- **Key**: `localStorage["sl_edu_events_v1"]`
- **File**: `streamline-client/src/edu/state/eduEvents.ts`
- **Used by**:
  - `streamline-client/src/edu/pages/Events.tsx` (full schedule/edit/cancel/duplicate UX)
  - `streamline-client/src/edu/pages/Dashboard.tsx` (upcoming events)
  - `streamline-client/src/edu/pages/People.tsx` (used to populate assignment dropdown/options)

**Why this matters**
- Server currently has authenticated read endpoint: `GET /api/edu/events` (see `streamline-server/routes/eduEvents.ts`).
- The client UX currently depends on local create/update/cancel/duplicate, which the server does **not** yet provide.

**Removal plan (recommended)**
1. Implement server endpoints for event create/update/cancel/duplicate (or a single PATCH endpoint), storing the same fields in Firestore.
2. Replace `eduEvents.ts` usage in `Events.tsx`, `Dashboard.tsx`, `People.tsx` with API calls.
3. Delete `eduEvents.ts` and remove the `sl_edu_events_v1` key.

---

## 4) Archive: local-only metadata (title/notes overlays)

### A) Archive metadata cache
- **Key**: `localStorage["sl_edu_archive_meta_v1"]`
- **File**: `streamline-client/src/edu/pages/Archive.tsx`
- **What it does**:
  - Stores per-recording `title` and `notes` client-side only.
  - The underlying recordings list comes from `editingApi.getRecordings()`.

**Removal plan (choose one)**
- Option 1 (production): add backend persistence for recording metadata and replace localStorage with API.
- Option 2 (simplest): remove rename/notes features and delete the meta store.

---

## 5) Embed: local-only “school network” embed id

### A) Stable channel embed id
- **Key**: `localStorage["sl_edu_school_network_embed_id_v1"]`
- **File**: `streamline-client/src/edu/pages/Embed.tsx`
- **What it does**:
  - Caches a generated “School Network (Current Live)” embed id so it persists across reloads.

**Removal plan**
- Persist the channel embed id server-side (e.g., in EDU org settings / a Firestore doc keyed by org), and fetch it on load.
- Remove the localStorage read/write.

---

## 6) Public EDU embed player: sessionStorage grant (not mock, but local state)

### A) Password grant caching
- **Key pattern**: `sessionStorage["sl_edu_embed_grant_<embedId>"]`
- **File**: `streamline-client/src/edu/pages/EmbedEventPlayer.tsx`
- **What it does**:
  - After a user enters the embed password, caches a short-lived grant so the page can refresh without re-entering the password.

**Recommendation**
- Treat as legitimate UX state (not “mock data”). Remove only if you want password re-entry every refresh.

---

## 7) EDU lane markers (not mock)

### A) Lane selection + cookie
- **Keys**: `localStorage["sl_entry_lane"]`, `localStorage["sl_mode"]`, cookie `edu_mode=1`
- **File**: `streamline-client/src/edu/state/eduMode.ts`
- **Why it exists**:
  - Keeps the app in the EDU lane and applies EDU styling.

Recommendation: keep.

---

## 8) Hard-coded placeholder UI (Dashboard)

### A) Fake recordings list + fixed stats
- **File**: `streamline-client/src/edu/pages/Dashboard.tsx`
- **What it does**:
  - `recentRecordings` is a hard-coded array.
  - Several cards show fixed numbers/text (“Recordings This Month: 24”, “You’ve used 78%…”, etc.)

**Removal plan**
- Wire the Dashboard to real data sources (recordings list + EDU storage summary + real counters), or remove these panels until those endpoints exist.

---

## Quick “purge” list (browser storage)

To wipe demo/local EDU state in a browser profile:
- `sl_edu_bypass`
- `sl_edu_demo_settings_v1`
- `sl_edu_events_v1`
- `sl_edu_archive_meta_v1`
- `sl_edu_school_network_embed_id_v1`
- `sl_entry_lane`
- `sl_mode`
- `sl_edu_embed_grant_<embedId>` (sessionStorage)
