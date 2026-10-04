/**
 * Monetization secrets — pure helpers (no Firebase imports, unit-testable).
 *
 *  - getCodeSalt(): HMAC key for access-code hashes; required in prod/staging.
 *  - sealPendingCode/openPendingCode: AES-256-GCM wrapping of the raw access
 *    code while it waits in Firestore for the buyer's success-page poll.
 *    Reuses the stream-key cipher in lib/crypto.ts (STREAM_KEY_SECRET_V1).
 */

import { encryptStreamKey, decryptStreamKey, EncPayload } from "./crypto";

export const PENDING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const DEV_CODE_SALT = "streamline-monetization-salt";

function isProdLikeEnv(): boolean {
  const env = String(process.env.NODE_ENV || "development").toLowerCase();
  return env === "production" || env === "staging";
}

export function getCodeSalt(): string {
  const raw = String(process.env.MONETIZATION_CODE_SALT || "").trim();
  if (isProdLikeEnv() && (!raw || raw === DEV_CODE_SALT)) {
    throw new Error("Missing MONETIZATION_CODE_SALT (no dev salt in production)");
  }
  return raw || DEV_CODE_SALT;
}

export type SealedPendingCode =
  | EncPayload
  // Dev-only fallback when STREAM_KEY_SECRET_V1 is not configured.
  | { alg: "none"; plaintext: string };

export function sealPendingCode(rawCode: string): SealedPendingCode {
  const enc = encryptStreamKey(rawCode);
  if (enc) return enc;
  if (isProdLikeEnv()) {
    throw new Error("Missing STREAM_KEY_SECRET_V1 (cannot encrypt pending access code)");
  }
  return { alg: "none", plaintext: rawCode };
}

export function openPendingCode(sealed: any): string | null {
  if (!sealed || typeof sealed !== "object") return null;
  if (sealed.alg === "none") {
    if (isProdLikeEnv()) return null;
    return typeof sealed.plaintext === "string" ? sealed.plaintext : null;
  }
  return decryptStreamKey(sealed);
}

export function isPendingCodeExpired(expiresAtMs: unknown, now: number = Date.now()): boolean {
  const t = Number(expiresAtMs);
  return !Number.isFinite(t) || now > t;
}
