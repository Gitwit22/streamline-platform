# Plan, Feature, and Admin Implementation

This document explains how plans, features, billing flags, and admin controls work together in the platform. It is intended for anyone wiring new features to plans, adjusting billing behavior, or using the admin tools.

---

## High-Level Overview

- **Plans** live in Firestore (`plans` collection) and define:
  - **Features** (boolean flags like `recording`, `rtmp`, `multistream`, `advancedPermissions`).
  - **Limits** (numeric caps like `maxGuests`, `maxDestinations`, `participantMinutes`, etc.).
- **Users** live in `users` collection and carry:
  - `planId` (e.g. `free`, `starter`, `pro`, `basic`, `internal_unlimited`).
  - Billing flags (`billingEnabled`, `billingStatus`, `billingActive`, etc.).
  - Optional overrides (e.g. `adminOverride`, `adminOverridePlanId`).
- **Effective entitlements** are computed server-side using normalized plan data so all features/limits are consistent.
- **Admin routes** control:
  - Plan definitions and visibility.
  - The global billing system flag (`billingSystemEnabled`), which feeds into `platformBillingEnabled` and `effectiveBillingEnabled`.
- **Feature gating** uses `canAccessFeature(uid, featureKey)` to decide if a user can use multistream, recording, etc., combining plan features, optional admin overrides, and (when enabled) billing status.

---

## Data Model

### Plans (`plans` collection)

Each document in `plans` describes a plan. The shape is normalized by `normalizePlan` so downstream code can rely on canonical fields.

Key parts:

- **ID**: document ID is the plan ID (`PlanId`), e.g. `free`, `starter`, `pro`, `basic`, `enterprise`, `internal_unlimited`.
- **Features** (boolean flags), e.g.:
  - `features.recording`
  - `features.rtmp`
  - `features.multistream`
  - `features.advancedPermissions`
  - Additional internal aliases may exist (e.g. `dualRecording`, `dual_recording`, etc.), but normalized features expose a consistent shape.
- **Limits** (numeric caps), e.g.:
  - `limits.maxGuests`
  - `limits.maxDestinations` (or legacy `rtmpDestinationsMax`, `rtmpDestinations`)
  - `limits.participantMinutes`
  - `limits.transcodeMinutes`
  - Recording-specific limits, like `limits.maxRecordingMinutesPerClip`.

The module [streamline-server/lib/normalizePlan.ts](streamline-server/lib/normalizePlan.ts) reads raw plan docs and produces a `CanonicalPlan` with:

- `id`: canonical plan id.
- `features`: normalized boolean feature flags.
- `limits`: normalized numeric limits.

`normalizePlan` is the single source of truth for how raw plan documents are interpreted.

### Users (`users` collection)

User documents contain:

- **Plan + billing**
  - `planId`: current plan ID (string; default `free`).
  - `billingEnabled`: user-level gate for whether billing is active for this account.
  - `billingStatus`, `billingActive`, `billing.subscriptionId`, etc.
- **Overrides and flags**
  - `adminOverride`: when true, bypasses many gating checks.
  - `adminOverridePlanId`: optional override plan ID used when computing effective entitlements.

The helper [streamline-server/lib/userAccount.ts](streamline-server/lib/userAccount.ts) is responsible for:

- Loading the user doc.
- Computing:
  - `platformBillingEnabled` from the global config.
  - `effectiveBillingEnabled = platformBillingEnabled && billingEnabled`.
- Returning a `UserAccount` object used throughout the server (billing routes, account APIs, feature checks).

### Global Billing Flag (`billingSystemEnabled`)

The global billing flag is stored in Firestore under `config/features`:

- Field: `billingSystemEnabled` (boolean).
- When false, the platform is considered in **Test Mode** for billing, even if individual users have `billingEnabled: true`.

`userAccount` exposes this as:

- `platformBillingEnabled`: true/false.
- `effectiveBillingEnabled`: true only if both the platform and the user have billing enabled.

The admin routes can toggle this flag (see below).

---

## Effective Entitlements

Effective entitlements are computed in [streamline-server/lib/effectiveEntitlements.ts](streamline-server/lib/effectiveEntitlements.ts):

```ts
export async function getEffectiveEntitlements(accountOrUid: UserAccount | string): Promise<EffectiveEntitlements & { plan: CanonicalPlan }> {
  const account = typeof accountOrUid === "string" ? await getUserAccount(accountOrUid) : accountOrUid;
  const effectivePlanId = resolveEffectivePlanId(account);
  const plan = await loadPlan(effectivePlanId);

  return {
    planId: plan.id,
    limits: plan.limits,
    features: plan.features,
    plan,
  };
}
```

Key points:

- **Input** can be a `UserAccount` or a UID.
- `resolveEffectivePlanId` chooses:
  - `adminOverridePlanId` from the user doc if present, otherwise
  - `account.planId`.
- The selected plan is loaded from Firestore, then normalized to a `CanonicalPlan`.
- Callers get:
  - `planId`: effective plan id.
  - `features`: normalized features.
  - `limits`: normalized limits.
  - `plan`: full canonical plan object for more detailed inspection.

Usage examples:

- [streamline-server/routes/recordings.ts](streamline-server/routes/recordings.ts#L550-L612) uses `getEffectiveEntitlements(uid)` to:
  - Enforce dual recording only when the plan’s features allow it.
  - Clamp recording presets to plan limits.
  - Choose appropriate usage types and caps.

- Other parts of the system can rely on `effectiveEntitlements` instead of re-reading raw plan docs.

Supporting helper:

- [streamline-server/lib/planLimits.ts](streamline-server/lib/planLimits.ts) provides utilities like `resolveMaxDestinations(limits)` to interpret numeric limits consistently (e.g. `> 0` = hard cap; `0` or missing = “no hard cap from limits”).

---

## Feature Gating (`canAccessFeature`)

Feature-level access is centralized in [streamline-server/routes/featureAccess.ts](streamline-server/routes/featureAccess.ts).

### API

```ts
export async function canAccessFeature(uid: string, featureKey: string): Promise<{ allowed: boolean; reason?: string }>;
```

- `uid`: user id.
- `featureKey`: logical key such as `"multistream"` or `"recording"`.
- Returns:
  - `{ allowed: true }` when access is granted.
  - `{ allowed: false, reason: string }` when blocked.

### Inputs and shortcuts

`canAccessFeature` performs the following steps:

1. **Load user** from `users/{uid}`.
2. **Admin overrides**:
   - If `user.adminOverride` is true, access is granted.
   - If the user is in the `admins` collection with `isAdmin === true`, access is granted.
3. **Internal unlimited plan**:
   - If `planId === "internal_unlimited"`, access is granted.

### Billing-based gating (respecting the platform billing flag)

Billing checks are handled via the internal `billingBlocks(user)` helper plus the global billing state from `getUserAccount`:

- `billingBlocks(user)` returns a string reason when there is a billing problem for **paid plans**, e.g.:
  - Missing subscription for a paid plan.
  - `billingActive === false`.
  - `billingStatus` in a bad state (`past_due`, `unpaid`, `canceled`, etc.).

The key behavior is:

- `canAccessFeature` calls `getUserAccount(uid)` to inspect `effectiveBillingEnabled`.
- If `account.effectiveBillingEnabled === false` (Test Mode / billing disabled):
  - **Billing blocks are skipped.**
  - This means test-mode users on paid plans can still access streaming/recording features even without an active Stripe subscription.
- If `account.effectiveBillingEnabled !== false` (billing active):
  - `billingBlocks(user)` is evaluated.
  - If it returns a reason, access is denied with `reason: "Billing issue: <reason>"`.
- If `getUserAccount` fails (rare), `canAccessFeature` falls back to evaluating `billingBlocks(user)` directly.

This integration ensures that the **admin billing flag** (see below) cleanly disables billing-based enforcement for feature access when the platform is in Test Mode, while still allowing billing to gate paid features in live mode.

### Plan feature checks

If billing does not block access, `canAccessFeature` then loads the plan document:

1. Fetches `plans/{planId}`.
2. Checks `plan.features[featureKey]` (boolean).
3. Special case for `multistream` for backward compatibility:
   - If `features.multistream` is not explicitly true, it also considers:
     - `features.rtmp`
     - `features.rtmpMultistream`
     - `plan.multistreamEnabled`
4. If no feature flag grants access, it returns:

   - `{ allowed: false, reason: "Feature not available on your plan" }`.

When adding new features, you can:

- Add a new boolean in `plan.features` (and update `normalizePlan` to surface it if necessary).
- Gate route access by calling `canAccessFeature(uid, "yourFeatureKey")`.

### Where `canAccessFeature` is used

Examples:

- [streamline-server/routes/live.ts](streamline-server/routes/live.ts)
  - `POST /api/live/preflight` uses `canAccessFeature(uid, "multistream")` to authorize live preflight checks.
- [streamline-server/routes/multistream.ts](streamline-server/routes/multistream.ts)
  - `POST /api/multistream/:roomName/start-multistream` calls `canAccessFeature(uid, "multistream")` before starting LiveKit RTMP egress.
- [streamline-server/routes/recordings.ts](streamline-server/routes/recordings.ts#L550-L612)
  - `POST /api/recordings/start` calls `canAccessFeature(uid, "recording")` before starting a recording egress.

---

## Admin Controls

### Global Billing Flag (Billing System Toggle)

The billing system can be globally enabled/disabled via an admin endpoint in [streamline-server/routes/admin.ts](streamline-server/routes/admin.ts):

- **Endpoint** (conceptual): `POST /api/admin/feature-flags/billing`.
- Behavior:
  - Writes `billingSystemEnabled` into `config/features`.
  - Calls `invalidatePlatformBillingCache()` so subsequent `getUserAccount` calls see the new value immediately.

Effects when `billingSystemEnabled` is **false**:

- `platformBillingEnabled` becomes false.
- `effectiveBillingEnabled` becomes false for all users.
- Downstream behavior:
  - `GET /api/auth/me` reports `billingMode: "test"` and `effectiveBillingEnabled: false`.
  - Billing endpoints in [streamline-server/routes/billing.ts](streamline-server/routes/billing.ts) either:
    - Short-circuit with `billing: { mode: "disabled" }` (for checkout), or
    - Return `403` with `error: "billing_disabled"` (for portal).
  - Client code (e.g. [streamline-client/src/hooks/useAuthMe.ts](streamline-client/src/hooks/useAuthMe.ts) and [streamline-client/src/pages/SettingsBilling.tsx](streamline-client/src/pages/SettingsBilling.tsx)) detects Test Mode and:
    - Shows a **Test Mode** banner.
    - Prevents opening live Stripe checkout/portal.
    - Surfaces a clear message: billing is disabled, use test-mode plan switching instead.
  - `canAccessFeature` skips billing-based blocks, so paid features (e.g. multistream, recording) remain usable for test-mode pro accounts.

### Plan Editing and Visibility

Plan definitions (features, limits, pricing, visibility) are managed via admin tools and stored in `plans`.

Key concepts:

- **Visibility**: plans can have `visibility: "public"` or other values.
  - The client billing page (see [streamline-client/src/pages/SettingsBilling.tsx](streamline-client/src/pages/SettingsBilling.tsx)) fetches `GET /api/plans`, then filters to `visibility === "public"` to show users only public/commercial plans.
- **Price IDs and Stripe wiring** live alongside plans, but actual Stripe operations are gated by the billing system flag and `effectiveBillingEnabled`.

Admin endpoints for creating/updating plans are defined in [streamline-server/routes/admin.ts](streamline-server/routes/admin.ts) (not reproduced here), and should:

- Update `plans/{planId}` docs.
- Ensure features and limits conform to what `normalizePlan` expects.

---

## Client Behavior (Billing and Plans)

The billing/settings UI is implemented in [streamline-client/src/pages/SettingsBilling.tsx](streamline-client/src/pages/SettingsBilling.tsx):

- Loads current user data via `GET /api/auth/me` (includes `planId`, `billingEnabled`, `platformBillingEnabled`, `effectiveBillingEnabled`, `billingMode`).
- Uses `isAuthUserInTestMode` (see [streamline-client/src/hooks/useAuthMe.ts](streamline-client/src/hooks/useAuthMe.ts)) to determine if Test Mode is active:
  - Test Mode is true when any of the following are true:
    - `effectiveBillingEnabled === false`,
    - `billingEnabled === false`,
    - `billingMode === "test"`.
- When in Test Mode:
  - The billing page shows a clear Test Mode explanation.
  - Live Stripe actions (checkout/portal) are disabled and replaced by messages instructing users to use test-mode plan switching.
- Effective entitlements (features and limits) are pulled from `GET /api/account/me` (preferred) or legacy usage endpoints.
  - The UI uses `effectiveEntitlements` to display allowed features (recording, multistream, etc.) and limits (minutes, destinations).

Helper of note in this file:

- `getCanonicalPlanId(user)` (referenced in `checkoutPlanForResubscribe`) normalizes plan variants (e.g. `starter_paid`, `starter_trial`) back to canonical ids like `starter` for UI and resubscribe logic.

---

## How to Add a New Feature Gated by Plan/Admin

When introducing a new feature that should be controlled by plan and admin settings:

1. **Decide the feature key**
   - Example: `"analytics"`, `"dualRecording"`, `"advancedScenes"`.

2. **Update plan schema**
   - Add a boolean under `plan.features[featureKey]` in plan docs.
   - Update `normalizePlan` (if necessary) to ensure this flag is present on the canonical `features` object.

3. **Wire server-side gating**
   - In the relevant route handler, after auth, call:

     ```ts
     const access = await canAccessFeature(uid, "yourFeatureKey");
     if (!access.allowed) {
       return res.status(403).json({ error: "feature_not_allowed", details: access.reason });
     }
     ```

4. **Respect billing/Test Mode semantics**
   - `canAccessFeature` already respects the global billing flag and `effectiveBillingEnabled`, so you do **not** need to duplicate billing logic.
   - In live mode, billing issues can still block access for paid plans.
   - In Test Mode, billing blocks are bypassed while plan flags and admin overrides continue to apply.

5. **Expose entitlements to the client (optional)**
   - If the client should show this feature in a UI (e.g. toggles, badges), update the effective entitlements payload (via `normalizePlan` and `getEffectiveEntitlements`) so the feature is visible.

---

## Summary

- Plans + features + limits are defined in Firestore and normalized by `normalizePlan`.
- `getUserAccount` combines user docs with the global billing flag to produce `platformBillingEnabled` and `effectiveBillingEnabled`.
- `getEffectiveEntitlements` is the canonical way to get normalized features and limits for a user’s effective plan.
- `canAccessFeature` centralizes feature gating, combining:
  - Admin overrides,
  - Internal unlimited plan,
  - (When enabled) strict billing status for paid plans,
  - Plan features, including special handling for multistream.
- The admin billing flag (`billingSystemEnabled`) controls whether billing enforcement is live or Test Mode, affecting:
  - Billing routes (checkout/portal),
  - The `auth/me` payload and client Test Mode UI,
  - Billing-based blocks inside `canAccessFeature`.

Use this document as the guide when:

- Adding new plans or changing limits/features.
- Wiring new feature routes to plan/admin/billing semantics.
- Debugging why a user can or cannot access a plan-gated feature under different billing modes.
