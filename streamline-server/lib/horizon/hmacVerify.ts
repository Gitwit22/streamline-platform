/**
 * HMAC-SHA256 signature utilities for Horizon webhook verification.
 *
 * Outbound:  StreamLine signs payloads before POSTing to Horizon.
 * Inbound:   Horizon signs payloads before POSTing to StreamLine.
 *
 * Signature header format:  X-Horizon-Signature: sha256=<hex-digest>
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

/**
 * Compute HMAC-SHA256 of `payload` using `secret`.
 * Returns the full header value: `sha256=<hex>`.
 */
export function signPayload(secret: string, payload: string | Buffer): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(payload);
  return SIGNATURE_PREFIX + hmac.digest("hex");
}

/**
 * Verify an `X-Horizon-Signature` header value against the expected HMAC.
 *
 * Uses constant-time comparison to prevent timing attacks.
 * Returns `true` when the signature is valid.
 */
export function verifySignature(
  secret: string,
  payload: string | Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!secret || !signatureHeader) return false;

  const expected = signPayload(secret, payload);

  // Both values are hex strings of the same algorithm, so lengths should match.
  if (expected.length !== signatureHeader.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
