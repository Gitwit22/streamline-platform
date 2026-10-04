/**
 * Anonymous viewer id used only for counting unique HLS viewers.
 * Random, not derived from anything about the user. Persisted in
 * localStorage (falls back to sessionStorage, then memory) so one browser
 * counts once per live session.
 */
export const VIEWER_ID_STORAGE_KEY = "sl_viewer_id";

const VIEWER_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

let memoryId: string | null = null;

export function isValidViewerId(value: unknown): value is string {
  return typeof value === "string" && VIEWER_ID_RE.test(value);
}

export function generateViewerId(): string {
  const bytes = new Uint8Array(16);
  const c: Crypto | undefined = typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `v_${hex}`;
}

function tryStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    const s = (globalThis as any)[kind] as Storage | undefined;
    return s || null;
  } catch {
    return null;
  }
}

function readFrom(storage: Storage | null): string | null {
  if (!storage) return null;
  try {
    const v = storage.getItem(VIEWER_ID_STORAGE_KEY);
    return isValidViewerId(v) ? v : null;
  } catch {
    return null;
  }
}

function writeTo(storage: Storage | null, id: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(VIEWER_ID_STORAGE_KEY, id);
    return storage.getItem(VIEWER_ID_STORAGE_KEY) === id;
  } catch {
    return false;
  }
}

/** Returns this browser's viewer id, creating and persisting it on first use. */
export function getViewerId(): string {
  const local = tryStorage("localStorage");
  const session = tryStorage("sessionStorage");
  const existing = readFrom(local) || readFrom(session) || (isValidViewerId(memoryId) ? memoryId : null);
  if (existing) {
    memoryId = existing;
    return existing;
  }
  const id = generateViewerId();
  memoryId = id;
  if (!writeTo(local, id)) writeTo(session, id);
  return id;
}

/** Test helper: forget the in-memory id. */
export function __resetViewerIdForTests() {
  memoryId = null;
}
