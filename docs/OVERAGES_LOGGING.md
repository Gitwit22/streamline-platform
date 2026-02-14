# Pro Overages Logging (Minutes)

## Goal
When a **Pro** account exceeds its included monthly usage limits, the server continues to allow actions and records **overage totals** on the monthly usage document. This is **logging only** (not billing).

## Plan Flag
- `features.allowsOverages: boolean`
  - Default behavior: `true` for plan id `pro`, `false` otherwise.
  - Can be overridden by setting `features.allowsOverages` (or legacy `features.overagesAllowed`) on the plan document.

## Firestore Fields
Monthly usage docs live at:
- `usageMonthly/{uid}_{YYYY-MM}`

When over the limit, the server sets:
- `overages.participantMinutes: number`
- `overages.transcodeMinutes: number`
- `overages.updatedAt: Timestamp|Date`

These values are **totals** for the month (idempotent), computed as:
- $\max(0, used - included)$ per metric

## Where It Runs
- `POST /api/usage/streamEnded` updates `usageMonthly.usage.{participantMinutes,transcodeMinutes}` and then (best-effort) writes `overages.*` for Pro when totals are > 0.
- Transcode entry points (e.g. recording/multistream start) evaluate current monthly usage:
  - Non-overage plans: blocked with `usage_exhausted`
  - Pro: allowed; if already exceeded, `overages.*` is written best-effort

## Notes
- Overages logging is **best-effort** and should never cause the user action to fail.
- Billing/charging is intentionally out of scope for this feature.
