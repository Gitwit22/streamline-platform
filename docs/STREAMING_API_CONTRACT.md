# Streaming API Contract (Destinations, Validation, Preflight)

This document defines the production-grade API contracts for manual RTMP destinations with encrypted keys, destination validation, and live preflight.

## Shared Enums/Types

Defined in `streamline-server/types/streaming.ts`.

- `DestinationStatus`: `connected` | `needs_attention` | `disconnected`
- `DestinationStatusReason`: `missing_key` | `invalid_format` | `egress_auth` | `egress_failed` | `unknown`
- `ApiErrorCode`: `invalid_query` | `invalid_body` | `missing_required_fields` | `limit_exceeded` | `not_found` | `destination_not_found` | `duplicate_target` | `validation_failed` | `rate_limited` | `server_error`

Key Preview + Key Presence are derived server-side:
- `hasKey`: true only if decrypt succeeds
- `keyPreview`: last 4 chars of decrypted key; else `null`
- If decrypt fails → `status = needs_attention`, `statusReason = invalid_format`
- If encrypted payload missing → `status = needs_attention`, `statusReason = missing_key`

## Normalization Rules

- `rtmpUrlBase` is stored normalized with no trailing slash (trim whitespace; remove trailing `/`).
- When building full RTMP URL, concatenate exactly one slash before the key.

## Destinations

Base path: `/api/destinations`

### GET `/api/destinations`
Query params:
- `platform`: single value (e.g., `youtube`) — optional
- `includeDisabled`: default `false`

Behavior:
- If `platform` provided, filter by `platform` (case-insensitive).
- If `includeDisabled=false` (default), only return enabled destinations.
- Response includes derived `status`, `statusReason`, `hasKey`, `keyPreview`.

Response:
```
{
  ok: true,
  items: DestinationItem[],
  usedCount: number,
  limit?: number
}
```

### POST `/api/destinations`
Body:
```
{
  platform: string,
  name?: string,
  rtmpUrlBase: string, // raw; server normalizes
  streamKeyEnc?: {
    ciphertext: string,
    iv: string,
    tag: string,
    alg: "AES-256-GCM",
    kid: string
  },
  enabled?: boolean // default true
}
```

Duplicate rule (deterministic):
- Duplicate if same `platform` + same normalized `rtmpUrlBase` for the same user.
- Returns `409 duplicate_target`.

Response (on success):
```
{
  ok: true,
  destination: DestinationItem,
  validation: {
    status: DestinationStatus,
    statusReason?: DestinationStatusReason | null
  },
  usedCount?: number,
  limit?: number
}
```

### POST `/api/destinations/validate`
Use when validating before create.

Body:
```
{
  platform: string,
  rtmpUrlBase: string,
  streamKeyEnc?: EncPayload
}
```

Response:
```
{
  ok: true,
  status: DestinationStatus,
  statusReason?: DestinationStatusReason | null
}
```

### POST `/api/destinations/:id/validate`
Validate existing destination without updating.

Response:
```
{
  ok: true,
  status: DestinationStatus,
  statusReason?: DestinationStatusReason | null
}
```

## Live Preflight

Base path: `/api/live`

### POST `/api/live/preflight`
Body:
```
{
  destinationIds?: string[],
  video?: { width?: number; height?: number; fps?: number },
  audio?: { bitrateKbps?: number },
  networkProbeMs?: number // ignored in MVP
}
```

Behavior:
- If `destinationIds` omitted or empty → use enabled destinations.
- `video` and `audio` are client hints only; server enforces plan + destination status.
- Returns unified `status`/`statusReason` for each destination.
- Never returns decrypted keys.

Response:
```
{
  ok: true,
  allowed: true,
  destinations: Array<{
    id: string,
    platform: string,
    status: DestinationStatus,
    statusReason?: DestinationStatusReason | null
  }>
}
```

Errors:
- `403 limit_exceeded` when plan gating blocks usage
- `404 destination_not_found` when specific `destinationIds` cannot be found

## Error Codes (Stable)
Use consistently across endpoints:
- `400`: `invalid_query` | `invalid_body` | `missing_required_fields`
- `403`: `limit_exceeded`
- `404`: `not_found` | `destination_not_found`
- `409`: `duplicate_target`
- `422`: `validation_failed`
- `429`: `rate_limited`
- `500`: `server_error`

## Encryption Setup
Server uses AES-256-GCM with rotation-ready `kid`:
- `STREAM_KEY_SECRET_V1`: base64 32 bytes
- `STREAM_KEY_SECRET_ACTIVE_KID`: active key id (e.g., `v1`)

Helpers in `streamline-server/lib/crypto.ts`:
- `encryptStreamKey(plainKey)` returns EncPayload
- `decryptStreamKey(enc)` returns plaintext key or `null`
- `normalizeRtmpBase(raw)` returns normalized base without trailing slash
