# Roadmap (Condensed)

This roadmap intentionally stays short and points to code/doc entry points.

## Current state (high level)

- **Permissions + invites + room enforcement**: implemented across server guards and client gating.
- **Streaming destinations contract**: see [STREAMING_API_CONTRACT.md](STREAMING_API_CONTRACT.md).
- **Editing suite**: see [Editor/README.md](Editor/README.md) for current functionality and backend gaps.

## Next focus areas

### 1) Close editing backend gaps

Client-side API expectations live in `streamline-client/src/lib/editingApi.ts`.

Bring the server to parity by implementing missing endpoints under `streamline-server/routes/editing.ts` (project CRUD, timeline persistence, export jobs/status).

### 2) Permissions model polish

- Keep RTC token minting centralized and stable.
- Ensure all room-scoped actions use `assertRoomPerm` / `assertRoomOwner` consistently.
- Validate invite acceptance flows against current entitlements.

### 3) Usage + billing hardening

- Keep all enforcement server-side.
- Expand canonical error handling for limit-exceeded scenarios.
- Keep overages logging best-effort (never break primary actions).

### 4) Room layout routing & role-aware UI

Where needed, add/extend role-aware layout routing and toolbars.

## Notes

Historical “phase” docs were consolidated into this file plus the canonical references:

- [PERMISSIONS_AND_INVITES.md](PERMISSIONS_AND_INVITES.md)
- [USAGE_BILLING_LIMITS.md](USAGE_BILLING_LIMITS.md)
- [Editor/README.md](Editor/README.md)
