# LIMITS AND ENFORCEMENT: Living Contract

## Purpose

This document serves as the canonical reference for all plan-limited features, enforcement points, and error semantics in the Streamline platform. It is a living contract to prevent accidental bypasses, guide code reviews, and support future features such as notifications, overages, and enterprise custom plans.

---

## 1. Plan-Limited Features: Enforcement Matrix

| Feature                | Enforcement Location(s)                | Bypass Checks | Error Semantics         | Concurrency Handling | UI Gating? | Notes |
|------------------------|----------------------------------------|---------------|------------------------|---------------------|------------|-------|
| Recording              | `usageTracker.ts`, `livekitPermissions.ts` | Yes           | Canonical error codes  | Atomic usage check  | Yes        | Platform-wide flag respected in UI and backend |
| HLS                    | `usageTracker.ts`, `livekitPermissions.ts` | Yes           | Canonical error codes  | Atomic usage check  | Yes        | Platform-wide flag respected in UI and backend |
| Streaming Minutes      | `usageTracker.ts`, `normalizePlan.ts`      | Yes           | Canonical error codes  | Atomic usage check  | Yes        | Always mapped from admin field to `transcodeMinutes` |
| Plan Price             | `routes/plans.ts`, `normalizePlan.ts`     | N/A           | N/A                    | N/A                 | Yes        | UI uses `priceMonthly` from backend |
| Entitlements           | `routes/account.ts`, `usageTracker.ts`    | Yes           | Canonical error codes  | Atomic usage check  | Yes        | All entitlements checked server-side |

---

## 2. Enforcement Principles

- **Server-Side Enforcement:** All plan limits are enforced on the backend. The UI must never be the sole gatekeeper.
- **Canonical Mapping:** All plan-limited features are mapped to canonical fields (e.g., `transcodeMinutes`) in both backend and frontend.
- **Error Semantics:** All enforcement failures return canonical error codes/messages for consistent client handling.
- **Concurrency:** Usage checks and updates are atomic to prevent race conditions and overages.
- **UI Gating:** The UI reflects backend state but does not enforce limits; it only provides user feedback.

---

## 3. File/Function Reference

- **Frontend (UI):**
  - `streamline-client/src/pages/SettingsBilling.tsx` (plan card logic, UI gating, pricing link)
  - `streamline-client/src/pages/PricingExplainerPage.tsx` (explainer content)
- **Backend (API/Logic):**
  - `streamline-server/routes/plans.ts` (API for plans, exposes canonical fields)
  - `streamline-server/lib/normalizePlan.ts` (plan normalization, mapping of limits)
  - `streamline-server/lib/usageTracker.ts` (usage/entitlement enforcement)
  - `streamline-server/routes/account.ts` (entitlements API)
  - `streamline-server/lib/livekitPermissions.ts`, `rolePermissions.ts` (role/feature gating)

---

## 4. Bypass and Error Handling

- **Bypass Checks:** All critical enforcement points are server-side. UI-only gating is never sufficient.
- **Error Semantics:** All errors use canonical codes/messages. Clients must not assume success based on UI state alone.
- **Concurrency:** All usage tracking and entitlement checks are atomic and race-condition safe.

---

## 5. Future-Proofing

- **Notifications:** Reference this contract when adding user/admin notifications for approaching or exceeded limits.
- **Overages:** All overage logic must be implemented server-side, with reference to canonical enforcement points.
- **Enterprise Custom Plans:** All custom plan logic must extend canonical mapping and enforcement, not bypass it.

---

## 6. Summary Table

| Feature            | Canonical Field      | Enforcement File(s)                | UI Gating | Notes |
|--------------------|---------------------|------------------------------------|-----------|-------|
| Recording          | `recording`         | `usageTracker.ts`, `livekitPermissions.ts` | Yes       | Platform-wide flag respected |
| HLS                | `hls`               | `usageTracker.ts`, `livekitPermissions.ts` | Yes       | Platform-wide flag respected |
| Streaming Minutes  | `transcodeMinutes`  | `usageTracker.ts`, `normalizePlan.ts`      | Yes       | Always mapped from admin field |
| Plan Price         | `priceMonthly`      | `routes/plans.ts`, `normalizePlan.ts`     | Yes       | UI uses backend value |
| Entitlements       | `entitlements`      | `routes/account.ts`, `usageTracker.ts`    | Yes       | All checked server-side |

---

## 7. Review Checklist

- [x] All plan-limited features enforced server-side
- [x] No UI-only gating for critical features
- [x] Canonical mapping for all plan fields
- [x] Atomic usage/concurrency handling
- [x] Canonical error codes/messages
- [x] UI reflects backend state only

---

## 8. References

- See `/docs/PHASE_4_QUICK_START.md`, `/docs/PHASE_6_COMPLETION.md`, `/docs/PHASE_7_API_INTEGRATION.md` for implementation details and historical context.

---

**This document is a living contract. Update it with every change to plan-limited features, enforcement logic, or error semantics.**
