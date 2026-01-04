// Centralized streaming-centric types and enums
// Destination status and reasons
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
  | "limit_exceeded"
  | "not_found"
  | "destination_not_found"
  | "duplicate_target"
  | "validation_failed"
  | "rate_limited"
  | "server_error";

// Optional request/response shapes (kept minimal for flexibility)
export interface DestinationItem {
  id: string;
  platform: string; // e.g., youtube|facebook|twitch|custom
  name?: string;
  enabled: boolean;
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
  streamKeyEnc?: any; // encrypted payload (ciphertext/iv/tag/alg/kid)
}

export interface ValidateResponse {
  ok: boolean;
  status: DestinationStatus;
  statusReason?: DestinationStatusReason | null;
}
