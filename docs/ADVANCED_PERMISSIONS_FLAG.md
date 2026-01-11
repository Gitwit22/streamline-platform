# Advanced Permissions Feature Flag

Scope covers the Simple vs Advanced permissions experience. Advanced mode is allowed when either the plan exposes `features.advancedPermissions` **or** the account has `advancedPermissionsOverride: true`. The effective flag is returned on `/api/account/me`.

Global lock: a feature flag `forceSimpleMode` (in `featureFlags/forceSimpleMode`) forces everyone into Simple mode regardless of plan/override. When active, `/api/account/me` reports `advancedPermissionsLockedReason: "global_lock"`, `effectivePermissionsMode: "simple"`, and `permissionsModeLockReason: "global_lock"`.

## How the flag is enforced
- `/api/account/me` returns `advancedPermissions: { enabled, plan, override }` and `permissionsMode`.
- When `forceSimpleMode` is enabled, `/api/account/me` returns `advancedPermissionsLockedReason: "global_lock"`, `effectivePermissionsMode: "simple"`, and `permissionsModeLockReason: "global_lock"`.
- `/api/account/media-prefs` coerces `permissionsMode` to `simple` if the flag is off (returns the coerced prefs).
- `/api/account/roles/*` and `/api/account/cohost-profile` force simple-mode defaults when the flag is off.
- `/api/room/token` always falls back to simple mode when the flag is off, so viewer tokens remain blocked in Simple.

## How to enable
1) **Plan-level**: In Admin → Plans, toggle **Advanced Permissions** (writes `features.advancedPermissions` on the plan doc).
2) **Account override** (widens only): Set `advancedPermissionsOverride: true` on the user doc if you need to unlock Advanced without changing the plan.

## Client behavior
- Settings → Mod/Guest Setup hides Advanced UI when `advancedPermissions.enabled` is false and shows a locked message/button.
- When enabled, the Advanced toggle calls `/api/account/media-prefs` to switch modes; when disabled the UI blocks the action.

## Data model notes
- Plan docs: `features.advancedPermissions: boolean`.
- User docs: optional `advancedPermissionsOverride: boolean`; `mediaPrefs.permissionsMode` is still persisted but coerced to `simple` server-side when disabled.

## Testing checklist
- Plan with flag off: `/account/me` reports `enabled: false`; `/account/media-prefs` forces `permissionsMode: simple`; room tokens behave as simple; Settings UI shows lock.
- Plan with flag on: `/account/me` reports `enabled: true`; can switch to Advanced and edit roles/co-host; room tokens honor Advanced behavior.
- Override only: set override true on a user on a plan without the flag; `enabled: true` and Advanced UI/actions allowed.
