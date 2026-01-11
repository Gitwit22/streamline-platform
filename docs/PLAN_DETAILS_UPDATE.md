# Adding Plan Detail Line Items (Advanced Permissions Mode example)

Use this process whenever you add a new customer-facing plan detail so it stays consistent across cards, comparisons, and checkout.

## 1) Define the customer-facing label
- Keep the internal flag as-is (e.g., `features.advancedPermissions`).
- Choose a clear external label: e.g., **Advanced Permissions Mode** ("Custom roles & co-host controls").
- Keep copy short; avoid engineering-only phrasing.

## 2) Add the plan row with an Included/Not Included pill
- Plan comparison/cards (Settings > Compare Plans): add a `FeatureRow` with `pill` for the Included/Not included pill and a short not-included note if needed.
- Keep bullets under 2 items, only when space allows. Example bullets:
  - Create/edit/delete custom roles
  - Edit co-host defaults & room role controls

## 3) Surface in feature pills
- Wherever feature pills render (plan cards, admin views), include the new label with the customer-facing text.

## 4) Keep security/implementation notes out of plan copy
- Do **not** mention internal enforcement (API coercions, route locks, token restrictions). Use docs/releases instead of plan marketing text.

## 5) Touchpoints to update when adding a plan detail
- Plan comparison list and plan cards (customer-facing).
- Checkout/upgrade modals if they show feature pills.
- Admin plan editor toggle label (for clarity, even though admin-facing).
- Any CTA or lock messaging that references the feature name.

## 6) Quick checklist for a new plan detail
- [ ] Customer-facing label chosen and agreed.
- [ ] Plan cards/comparison show an Included/Not included pill.
- [ ] Optional sub-bullets (max 2) added where space allows.
- [ ] Feature pills updated (customer + admin views).
- [ ] CTA/lock messages updated to the new label.
- [ ] Internal enforcement documented separately (not in plan copy).
