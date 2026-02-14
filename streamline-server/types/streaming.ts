// Centralized streaming-centric types and enums
// Destination status and reasons
import type { LimitErrorCode } from "../lib/limitErrors";
import type { PermissionErrorCode } from "../lib/permissionErrors";

export type DestinationStatus = "connected" | "needs_attention" | "disconnected";

export type DestinationStatusReason =
  | "missing_key"
  | "invalid_format"
  | "egress_auth"
  | "egress_failed"
  | "unknown";

// Stable API error codes used across streaming endpoints
export type ApiErrorCode =
  | "invalid_query"
  | "invalid_body"
  | "missing_required_fields"
  | LimitErrorCode
  | PermissionErrorCode
  | "not_found"
  | "destination_not_found"
  | "duplicate_name"
  | "duplicate_stream_key"
  | "duplicate_target"
  | "validation_failed"
  | "rate_limited"
  | "server_error";

// Optional request/response shapes (kept minimal for flexibility)
export interface DestinationItem {
  id: string;
  targetId: string; // stable identifier; defaults to doc id
  platform: string; // e.g., youtube|facebook|twitch|custom
  name?: string;
  enabled: boolean;
  mode?: "manual" | "connected"; // manual = RTMP key; connected = OAuth-backed (gated)
  persistent?: boolean; // true = save/reuse key; false = session-only key provided at start
  oauthRef?: string | null; // placeholder for connected targets
  rtmpUrlBase: string; // normalized: no trailing slash
  status: DestinationStatus;
  statusReason?: DestinationStatusReason | null;
  hasKey: boolean;
  keyPreview?: string | null; // last 4 chars if decrypt succeeds
  updatedAt?: number;
}

export interface DestinationsGetResponse {
  ok: boolean;
  items: DestinationItem[];
  usedCount?: number; // for UI convenience
  limit?: number; // plan limit
}

export interface DestinationPostResponse {
  ok: boolean;
  destination: DestinationItem;
  validation?: {
    status: DestinationStatus;
    statusReason?: DestinationStatusReason | null;
  };
  usedCount?: number;
  limit?: number;
}

export interface ValidateRequestBody {
  platform: string;
  rtmpUrlBase: string; // can be raw; server normalizes
  // Optional encrypted payload (ciphertext/iv/tag/alg/kid) for callers that
  // encrypt client-side. Browser UI can instead send plain text via
  // streamKeyPlain so the server handles encryption.
  streamKeyEnc?: any;
  streamKeyPlain?: string;
}

export interface ValidateResponse {
  ok: boolean;
  status: DestinationStatus;
  statusReason?: DestinationStatusReason | null;
}
