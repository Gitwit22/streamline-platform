/**
 * Pure helpers for room-chat file attachments (no I/O, unit-tested).
 *
 * Files shared in room chat live in R2 under
 *   room-chat/{roomId}/{sessionId}/{messageId}/{safeName}
 * so a room's attachments can be removed with one prefix delete (account
 * purge) and a key can never escape its room/session.
 */

export const CHAT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
export const CHAT_ATTACHMENT_PREFIX = "room-chat";
export const CHAT_ATTACHMENT_URL_TTL_SECONDS = 5 * 60;
const MAX_FILENAME_LEN = 120;

/**
 * Allowed extensions → canonical content type. The stored/served content type
 * comes from this table, never from the client-declared MIME type, so a
 * renamed .html can't be served as text/html from our bucket.
 */
const ALLOWED_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  zip: "application/zip",
};

export const CHAT_ATTACHMENT_ALLOWED_EXTENSIONS = Object.keys(ALLOWED_TYPES);

export function fileExtension(name: string): string {
  const base = String(name || "").trim();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Canonical content type for an allowed file name, or null when not allowed. */
export function resolveAttachmentContentType(name: string): string | null {
  const ext = fileExtension(name);
  return ext && Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, ext) ? ALLOWED_TYPES[ext] : null;
}

/**
 * Display-safe file name: strips any path, control chars and characters that
 * are awkward in object keys / headers, and caps the length while keeping the
 * extension. Returns "" when nothing usable is left.
 */
export function sanitizeAttachmentName(input: string): string {
  let name = String(input || "");
  // Drop any directory component (both separators).
  name = name.split(/[\\/]/).pop() || "";
  name = name
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/["<>:|?*%#{}^~`[\]]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  // No leading dots (hidden files / "..").
  name = name.replace(/^\.+/, "");
  if (!name) return "";
  if (name.length > MAX_FILENAME_LEN) {
    const ext = fileExtension(name);
    const keep = ext ? MAX_FILENAME_LEN - ext.length - 1 : MAX_FILENAME_LEN;
    name = ext ? `${name.slice(0, keep).trimEnd()}.${ext}` : name.slice(0, keep);
  }
  return name;
}

/** ASCII-only variant for the object key (non-ASCII → "_"). */
function keySafeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/ /g, "_").replace(/^\.+/, "");
}

export function buildAttachmentKey(params: {
  roomId: string;
  sessionId: string;
  messageId: string;
  fileName: string;
}): string {
  const roomId = requireKeySegment(params.roomId, "roomId");
  const sessionId = requireKeySegment(params.sessionId, "sessionId");
  const messageId = requireKeySegment(params.messageId, "messageId");
  const file = keySafeName(params.fileName) || "file";
  return `${CHAT_ATTACHMENT_PREFIX}/${roomId}/${sessionId}/${messageId}/${file}`;
}

/** True for ids that can be used verbatim as a key segment (Firestore auto ids). */
export function isKeySafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(String(id || ""));
}

// Reject instead of stripping: stripping could map two different ids onto the
// same prefix (and a prefix delete for one room would hit another).
function requireKeySegment(id: string, label: string): string {
  if (!isKeySafeId(id)) throw new Error(`chat attachment: invalid ${label}`);
  return id;
}

export function roomAttachmentPrefix(roomId: string): string {
  return `${CHAT_ATTACHMENT_PREFIX}/${requireKeySegment(roomId, "roomId")}/`;
}

/**
 * RFC 6266 attachment disposition: forces download (never inline render) and
 * keeps the original name, with an ASCII fallback for old clients.
 */
export function attachmentContentDisposition(name: string): string {
  const safe = sanitizeAttachmentName(name) || "file";
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export type ChatAttachmentMeta = {
  key: string;
  name: string;
  size: number;
  contentType: string;
};

/** Public (client-facing) shape — the storage key is never exposed. */
export function publicAttachment(raw: any): { name: string; size: number; contentType: string } | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.key !== "string" || !raw.key) return null;
  return {
    name: typeof raw.name === "string" && raw.name ? raw.name : "file",
    size: typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : 0,
    contentType: typeof raw.contentType === "string" ? raw.contentType : "application/octet-stream",
  };
}
