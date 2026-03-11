/**
 * HMAC-SHA256 signature utilities for Horizon bot webhook integration.
 *
 * - signPayload()  → creates the `X-Horizon-Signature` header value
 * - verifySignature() → constant-time comparison of an incoming signature
 */

import crypto from "crypto";

const ALGORITHM = "sha256";
const SIGNATURE_PREFIX = "sha256=";

/**
 * Produce an HMAC-SHA256 hex signature prefixed with "sha256=".
 */
export function signPayload(secret: string, payload: string | Buffer): string {
  const hmac = crypto.createHmac(ALGORITHM, secret);
  hmac.update(typeof payload === "string" ? payload : payload);
  return SIGNATURE_PREFIX + hmac.digest("hex");
}

/**
 * Verify an incoming `X-Horizon-Signature` header value against the raw body.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifySignature(
  secret: string,
  payload: string | Buffer,
  signature: string
): boolean {
  if (!secret || !payload || !signature) return false;

  const expected = signPayload(secret, payload);

  // Both values must have equal length for timingSafeEqual
  if (expected.length !== signature.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}
