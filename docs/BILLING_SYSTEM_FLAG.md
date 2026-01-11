# Platform Billing System Flag

This document describes the platform-wide billing/Stripe feature flag used to enable or disable billing across the Streamline platform.

## Overview

The platform billing flag controls whether **Stripe checkout** and the **billing portal** are available. When the flag is disabled, users operate in a **Test Mode** where they can still switch plans for testing, but no live Stripe operations are allowed.

The effective billing state for a user is computed from both the **platform flag** and the **per-user billing toggle**.

- `platformBillingEnabled`: global flag, defaults to `true`.
- `billingEnabled`: per-user flag (tri-state, defaults to `true` when missing).
- `effectiveBillingEnabled = platformBillingEnabled && billingEnabled`.

## Storage

The platform flag is stored in Firestore in a config document:

- Collection: `config`
- Document: `features`
- Field: `billingSystemEnabled: boolean` (default `true` when missing)

Example document:

```json
{
  "billingSystemEnabled": false,
  "updatedAt": "2025-01-10T18:00:00.000Z",
  "updatedBy": "adminUid123",
  "reason": "Temporarily pausing live billing for migration."
}
```

## Server Behavior

### Normalized User Account

The core normalization lives in `streamline-server/lib/userAccount.ts` and exposes:

- `billingEnabled`: per-user toggle.
- `platformBillingEnabled`: read from `config/features.billingSystemEnabled`.
- `effectiveBillingEnabled`: logical AND of the above.

### Auth Payload

`GET /api/auth/me` returns these fields:

- `billingEnabled`
- `platformBillingEnabled`
- `effectiveBillingEnabled`
- `billingMode`: `"test"` when `effectiveBillingEnabled === false`, otherwise `"live"`.

### Billing Routes

- `POST /api/billing/checkout`
  - Rejects with `403 { success: false, error: "billing_disabled" }` when `effectiveBillingEnabled === false`.
- `POST /api/billing/portal`
  - Same guard: blocks when `effectiveBillingEnabled === false`.
- `GET /api/billing/me`
  - Returns `billingEnabled`, `platformBillingEnabled`, and `effectiveBillingEnabled` alongside other billing fields.

### Test Mode Plan Switching

- `POST /api/billing/test/change-plan`
  - Allowed **only** when `effectiveBillingEnabled === false`.
  - In production, still requires the existing tester flag (`tester` / `isTester`) to be set on the user.
  - Updates `planId` and related plan fields **without** touching Stripe data.

## Admin Controls

### Per-User Billing Toggle

Existing endpoint (unchanged):

- `POST /api/admin/users/:userId/toggle-billing`
  - Body: `{ enabled: boolean, reason?: string }`
  - Writes `billingEnabled` on the user document and logs an admin action.

### Platform-Wide Billing Flag

New endpoint:

- `POST /api/admin/feature-flags/billing`
  - Guarded by `requireAdmin`.
  - Body:
    - `enabled: boolean` — new platform billing state.
    - `reason?: string` — optional human-readable reason.
  - Writes to `config/features`:
    - `billingSystemEnabled: enabled`
    - `updatedAt`, `updatedBy`, `reason`.
  - Logs `toggle_billing_system` in `adminLogs`.

## Admin UI

The **Admin Dashboard** surfaces this flag in the Features tab:

- Location: `streamline-client/src/pages/AdminDashboard.tsx`.
- A "Platform Billing System" card shows:
  - Current status: `Enabled (Stripe live)` / `Disabled (Test Mode only)` / `Loading...`.
  - A toggle that calls `POST /api/admin/feature-flags/billing`.

When platform billing is disabled:

- The Billing page shows a **Test Mode** banner.
- Stripe checkout and the billing portal are blocked.
- Test-mode plan switching (`/api/billing/test/change-plan`) remains available (subject to tester checks in production).

## Migration Notes

- If `config/features.billingSystemEnabled` does **not** exist, the system behaves as if it were `true`.
- Existing per-user `billingEnabled` behavior is preserved; the platform flag simply gates it.
- Client code falls back to `billingMode === "test"` or `billingEnabled === false` for environments that may not yet include `effectiveBillingEnabled`.
