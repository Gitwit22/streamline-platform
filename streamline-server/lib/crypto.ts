import crypto from "crypto";

export interface EncPayload {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  alg: string; // e.g., AES-256-GCM
  kid: string; // key id
}

function getActiveKey(): { key: Buffer; kid: string } | null {
  const b64 = process.env.STREAM_KEY_SECRET_V1;
  const kid = process.env.STREAM_KEY_SECRET_ACTIVE_KID || "v1";
  if (!b64) return null;
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) return null; // AES-256 requires 32 bytes
  return { key: raw, kid };
}

export function encryptStreamKey(plainKey: string): EncPayload | null {
  const active = getActiveKey();
  if (!active) return null;
  const iv = crypto.randomBytes(12); // GCM nonce
  const cipher = crypto.createCipheriv("aes-256-gcm", active.key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plainKey, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    alg: "AES-256-GCM",
    kid: active.kid,
  };
}

export function decryptStreamKey(enc: EncPayload | any): string | null {
  try {
    if (!enc || typeof enc !== "object") return null;
    const active = getActiveKey();
    if (!active) return null;
    if (!enc.ciphertext || !enc.iv || !enc.tag) return null;
    const ciphertext = Buffer.from(String(enc.ciphertext), "base64");
    const iv = Buffer.from(String(enc.iv), "base64");
    const tag = Buffer.from(String(enc.tag), "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", active.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

export function normalizeRtmpBase(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return s;
  // Remove trailing slash for storage; concat adds one slash later
  return s.replace(/\/+$/, "");
}
