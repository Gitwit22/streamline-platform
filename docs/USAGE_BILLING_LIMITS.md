# Usage, Billing, Limits, and Enforcement (Canonical)

This doc consolidates plan limits, usage tracking, billing flags, and server-side enforcement rules.

## Core principles

- **Server-side enforcement**: UI gating is informational only.
- **Canonical mapping**: plan docs are normalized so downstream code reads consistent fields.
- **Atomic usage updates**: usage checks + increments should be race-safe.
- **Consistent error semantics**: use stable error codes/messages for client handling.

## Where the truth lives (code entry points)

- Plan normalization: `streamline-server/lib/normalizePlan.ts`
- Effective entitlements: `streamline-server/lib/effectiveEntitlements.ts`
- Feature gating helper: `streamline-server/routes/featureAccess.ts` (`canAccessFeature`)
- Usage tracking + enforcement: `streamline-server/lib/usageTracker.ts`
- Account/billing state: `streamline-server/lib/userAccount.ts`

## Platform billing system flag

Two-tier gating:

- Platform-wide flag: `config/features.billingSystemEnabled` (boolean)
- Per-user flag: `users/{uid}.billingEnabled` (defaults to true when missing)

Effective state:

- `effectiveBillingEnabled = platformBillingEnabled && billingEnabled`

Implications:

- When `effectiveBillingEnabled === false`, the platform runs in **billing test mode**:
  - Stripe checkout/portal endpoints are blocked.
  - Feature access should not be denied due to missing Stripe subscription state.

## Overage logging (Pro)

When a Pro account exceeds monthly included usage, actions continue and the server logs overages totals (logging only; not charging).

Monthly usage docs:

- `usageMonthly/{uid}_{YYYY-MM}`

Overage fields:

- `overages.participantMinutes`
- `overages.transcodeMinutes`
- `overages.updatedAt`

Rule:

- `features.allowsOverages` controls whether overages are allowed/logged.

## Enforcement hotspots

Keep these surfaces aligned with entitlements and usage:

- Recording start
- Multistream / destinations start
- HLS start
- Any transcode/export initiation

Each should:

1. Load effective entitlements
2. Check plan feature availability
3. Check usage limits (atomic)
4. Proceed or return a canonical 4xx

## Adding new plan detail items

When you add a customer-facing plan detail (e.g. “Advanced Permissions Mode”):

- Keep plan-copy labels separate from internal enforcement notes.
- Update all plan surfaces consistently (cards, comparisons, upgrade/checkout messaging).

## Quick validation checklist

- Server blocks non-entitled features regardless of UI state.
- Limits are enforced under concurrency.
- Billing can be disabled globally without breaking development/testing.
- Overage logging never fails the primary user action.
