/**
 * Pure helpers for the persisted room chat (types, file limits, local cache,
 * wire normalization). UI + state live in creator/components/RoomChat.tsx.
 */

/* ── Types ──────────────────────────────────────────────────────────── */

export type ChatAttachment = { name: string; size: number; contentType: string };

export type ChatMsg = {
  id: string;
  text: string;
  createdAtMs: number | null;
  sender?: { name?: string | null; role?: string | null; identity?: string | null };
  attachment?: ChatAttachment;
  /** Session the message belongs to (needed to fetch its attachment). */
  sessionId?: string;
};

/* ── Attachment limits (mirror server lib/chatAttachmentsPure.ts) ───── */

export const CHAT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const CHAT_ATTACHMENT_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf",
  "txt", "csv", "md", "png", "jpg", "jpeg", "gif", "webp", "zip",
];
export const CHAT_ATTACHMENT_ACCEPT = CHAT_ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(",");

export function validateChatFile(file: { name: string; size: number }): string | null {
  const name = String(file?.name || "");
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!ext || !CHAT_ATTACHMENT_EXTENSIONS.includes(ext)) {
    return "That file type can't be shared. Use PDF, Office docs, text/CSV, images or ZIP.";
  }
  if (!(file.size > 0)) return "That file is empty.";
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) return "Files can be up to 25 MB.";
  return null;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const ERROR_MESSAGES: Record<string, string> = {
  file_too_large: "Files can be up to 25 MB.",
  file_type_not_allowed: "That file type can't be shared.",
  storage_unavailable: "File sharing is unavailable right now.",
  rate_limited: "You're sharing files too quickly. Try again in a few minutes.",
  not_allowed: "You don't have permission to do that.",
  no_active_session: "Chat hasn't started yet. A host or guest needs to start it.",
  attachment_not_found: "That file is no longer available.",
  text_required: "Type a message first.",
};

export function friendlyError(code: unknown, fallback: string): string {
  const key = typeof code === "string" ? code : "";
  return ERROR_MESSAGES[key] || fallback;
}

/* ── localStorage cache (key/shape unchanged from the original panel) ─ */

const CHAT_CACHE_PREFIX = "sl_chat_";
const CHAT_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // matches server session TTL
const CHAT_CACHE_MAX_MESSAGES = 200;

function chatCacheKey(roomId: string): string {
  return `${CHAT_CACHE_PREFIX}${roomId}`;
}

export function readChatCache(roomId: string): { sessionId: string; messages: ChatMsg[] } | null {
  try {
    const raw = localStorage.getItem(chatCacheKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.ts === "number" && Date.now() - parsed.ts > CHAT_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(chatCacheKey(roomId));
      return null;
    }
    if (!parsed?.sessionId || !Array.isArray(parsed?.messages)) return null;
    const messages = (parsed.messages as unknown[])
      .map((m) => normalizeMessage(m, parsed.sessionId))
      .filter((m): m is ChatMsg => !!m);
    return { sessionId: parsed.sessionId, messages };
  } catch {
    return null;
  }
}

export function writeChatCache(roomId: string, sessionId: string, messages: ChatMsg[]): void {
  try {
    localStorage.setItem(
      chatCacheKey(roomId),
      JSON.stringify({ sessionId, messages: messages.slice(-CHAT_CACHE_MAX_MESSAGES), ts: Date.now() }),
    );
  } catch {
    // storage full / unavailable — the server remains the source of truth
  }
}

export function clearChatCache(roomId: string): void {
  try {
    localStorage.removeItem(chatCacheKey(roomId));
  } catch {
    // ignore
  }
}

/* ── Helpers ────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted wire/cache JSON
export function normalizeMessage(m: any, sessionId?: string | null): ChatMsg | null {
  const id = typeof m?.id === "string" ? m.id : String(m?.id || "");
  if (!id) return null;
  const att = m?.attachment;
  const attachment: ChatAttachment | undefined =
    att && typeof att === "object" && typeof att.name === "string"
      ? {
          name: att.name,
          size: typeof att.size === "number" ? att.size : 0,
          contentType: typeof att.contentType === "string" ? att.contentType : "",
        }
      : undefined;
  const sid = typeof m?.sessionId === "string" && m.sessionId ? m.sessionId : sessionId || undefined;
  return {
    id,
    text: typeof m?.text === "string" ? m.text : "",
    createdAtMs: typeof m?.createdAtMs === "number" ? m.createdAtMs : null,
    sender: m?.sender || undefined,
    ...(attachment ? { attachment } : {}),
    ...(sid ? { sessionId: sid } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untrusted JSON body
export async function readJson(res: Response): Promise<any> {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export function roomHeaders(roomAccessToken: string): Record<string, string> {
  return roomAccessToken ? { "x-room-access-token": roomAccessToken } : {};
}

