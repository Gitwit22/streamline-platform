# Terms of Service Gate

This document describes how the Terms of Service (ToS) acceptance gate is implemented across the Streamline platform.

## Overview

The ToS gate ensures that:

- New accounts cannot be created without explicitly accepting the current Terms of Service.
- Plan changes / billing checkout cannot proceed unless the current Terms of Service has been accepted.
- ToS acceptance is logged with version and metadata (timestamp, IP, user agent) for auditability.
- The last accepted version and timestamp are visible in account settings.

The current ToS version is centralized in the backend and exposed to the client so flows remain consistent.

---

## Data Model

User documents (collection: `users`) contain the following ToS-related fields:

- `tosVersion: string` – version identifier for the Terms of Service accepted by this user.
- `tosAcceptedAt: number` – epoch milliseconds when this version was accepted.
- `tosAcceptedIp?: string` – IP address observed when ToS was accepted.
- `tosUserAgent?: string` – User-Agent header from the accepting client.

These fields are set on signup and can be updated when the platform rolls out a new ToS version and the user re-accepts.

The canonical current ToS version is defined in the server:

- File: `streamline-server/lib/tos.ts`
  - `CURRENT_TOS_VERSION` – string constant for the current ToS version (e.g., `"2025-01-01"`).
  - `hasAcceptedCurrentTos(user)` – helper that checks whether a user has accepted the current version.

---

## Backend Surfaces

### 1. Signup – `/api/auth/signup`

File: `streamline-server/routes/auth.ts`

Behavior:

- Expects `tosAccepted: true` in the request body.
- If `tosAccepted !== true`, returns:
  - `400 { error: "tos_required" }`
- On success, writes ToS metadata on the user document:
  - `tosVersion: CURRENT_TOS_VERSION`
  - `tosAcceptedAt: <now>`
  - `tosAcceptedIp: req.ip`
  - `tosUserAgent: req.get("user-agent")`

This guarantees that all newly created accounts have an associated ToS acceptance record.

### 2. Account Snapshot – `/api/account/me`

File: `streamline-server/routes/account.ts`

Response includes ToS metadata:

- `tosVersion` – the user’s stored version string or `null`.
- `tosAcceptedAt` – acceptance timestamp (ms) or `null`.
- `currentTosVersion` – the backend’s `CURRENT_TOS_VERSION`.

This is consumed by the client to show “last accepted” and to drive gating on the billing page.

### 3. Billing Checkout – `/api/billing/checkout`

File: `streamline-server/routes/billing.ts`

Request body (relevant fields):

- `plan: CheckoutPlanVariant` – target plan/variant.
- `requestId: string` – idempotency + lock coordination token.
- `tosAccepted?: boolean` – optional flag indicating that the user explicitly accepted the current ToS just before checkout.

Behavior:

1. After loading/locking the user (`userAtLock`), the route checks:
   - `hasAcceptedCurrentTos(userAtLock)`.
2. If the current ToS is already accepted:
   - Proceed with Stripe checkout as normal.
3. If **not** accepted:
   - If `tosAccepted === true` in the request body:
     - Write ToS metadata to the user document (merge):
       - `tosVersion: CURRENT_TOS_VERSION`
       - `tosAcceptedAt: <now>`
       - `tosAcceptedIp: req.ip`
       - `tosUserAgent: req.get("user-agent")`
     - Continue to Stripe checkout.
   - Else (no explicit acceptance provided):
     - Return `403` with a structured error payload:
       ```json
       {
         "success": false,
         "error": "tos_not_accepted",
         "tosVersion": <existing or null>,
         "currentTosVersion": "<CURRENT_TOS_VERSION>"
       }
       ```

This ensures billing/plan changes cannot proceed without the latest ToS acceptance.

---

## Frontend Surfaces

### 1. Signup Page

File: `streamline-client/src/pages/SignupPage.tsx`

Key behaviors:

- The UI has a required checkbox: “I agree to the Terms of Service”.
- If the checkbox is not ticked, the form shows an inline error and does **not** submit.
- When submitting the signup request, the client includes:
  - `tosAccepted: true` in the JSON body.

This aligns with the server’s `tos_required` enforcement.

### 2. Billing / Plan Settings

File: `streamline-client/src/pages/SettingsBilling.tsx`

ToS metadata:

- The page calls `/api/account/me` and hydrates the local user state with:
  - `tosVersion`
  - `tosAcceptedAt`
  - `currentTosVersion`

UI elements:

- In the “Your Plan” card, there is a **Legal** section that:
  - Shows the last accepted ToS:
    - If `tosVersion` and `tosAcceptedAt` are set:
      - `Last accepted Terms of Service: v{tosVersion} on {formatDate(tosAcceptedAt)}`
    - Otherwise:
      - `You have not yet accepted the latest Terms of Service.`
  - Includes a checkbox:
    - Label: “I agree to the Terms of Service” with a link to `/terms`.
    - Controlled by local state `checkoutTosAccepted`.

Checkout gating:

- Before calling `/api/billing/checkout`, the client computes:
  - `hasAcceptedCurrentTos` by comparing `user.tosVersion` and `user.currentTosVersion` and ensuring `tosAcceptedAt` is set.
- If the user has **not** accepted the current version and the billing-page checkbox `checkoutTosAccepted` is not checked:
  - The client blocks the call and shows:
    - `"You must agree to the Terms of Service before changing plans."`
- When starting checkout, the client sends:
  - `tosAccepted: true` in the request body.
- If the server responds with `403` / `error: "tos_not_accepted"` (e.g., due to stale state), the client surfaces the same message near the checkbox.

---

## Operational Notes

- **Version bumps:**
  - When the Terms of Service text changes in a legally meaningful way, bump `CURRENT_TOS_VERSION` in `lib/tos.ts`.
  - Existing users will be treated as **not** having accepted the new version until they:
    - Re-accept via a gated flow (e.g., billing), or
    - A future flow is added to prompt acceptance on login.

- **Extensibility:**
  - The same ToS metadata fields and helpers can be reused to gate other high-risk actions (e.g., enabling advanced features) by calling `hasAcceptedCurrentTos(user)` where needed.

This implementation provides a single, auditable path for Terms of Service acceptance that is enforced on both account creation and plan/billing changes.
