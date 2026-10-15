/**
 * Live room graphics (pure, no I/O): lower thirds (name + title) and text
 * banners (static or scrolling), saved per room at rooms/{roomId}.graphics
 * and shown/hidden live by the host or a co-host with canLayout. At most one
 * lower third and one banner are on screen at a time. The visible ones are
 * added to the room's `programOverlay` (lib/programOverlayPure.ts), so every
 * output and the in-room stage draw them. Plan gate: features.roomBranding.
 */

export const GRAPHICS_LIMITS = {
  items: 10,
  idLength: 40,
  name: 60,
  title: 80,
  bannerText: 200,
} as const;

export type LowerThirdItem = { id: string; name: string; title: string };
export type BannerItem = { id: string; text: string; scroll: boolean };

export type RoomGraphics = {
  lowerThirds: LowerThirdItem[];
  banners: BannerItem[];
  activeLowerThirdId: string | null;
  activeBannerId: string | null;
};

export const EMPTY_ROOM_GRAPHICS: RoomGraphics = {
  lowerThirds: [],
  banners: [],
  activeLowerThirdId: null,
  activeBannerId: null,
};

const ID_RE = /^[A-Za-z0-9_-]+$/;

// Flat shape (no strictNullChecks on the server).
export type GraphicsParse = { ok: boolean; value?: RoomGraphics; field?: string; details?: string };

function fail(field: string, details: string): GraphicsParse {
  return { ok: false, field, details };
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v.trim() : null;
}

/** Validates a full graphics state (the PUT body). Text is trimmed; ids must be unique. */
export function parseRoomGraphicsInput(body: unknown): GraphicsParse {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("body", "body must be an object");
  const b = body as Record<string, unknown>;
  const lowerThirdsIn = b.lowerThirds === undefined ? [] : b.lowerThirds;
  const bannersIn = b.banners === undefined ? [] : b.banners;
  if (!Array.isArray(lowerThirdsIn)) return fail("lowerThirds", "lowerThirds must be an array");
  if (!Array.isArray(bannersIn)) return fail("banners", "banners must be an array");
  if (lowerThirdsIn.length > GRAPHICS_LIMITS.items) return fail("lowerThirds", `at most ${GRAPHICS_LIMITS.items} lower thirds`);
  if (bannersIn.length > GRAPHICS_LIMITS.items) return fail("banners", `at most ${GRAPHICS_LIMITS.items} banners`);

  const ids = new Set<string>();
  const checkId = (raw: unknown, field: string): string | GraphicsParse => {
    const id = str(raw);
    if (!id || id.length > GRAPHICS_LIMITS.idLength || !ID_RE.test(id)) return fail(field, "invalid id");
    if (ids.has(id)) return fail(field, "duplicate id");
    ids.add(id);
    return id;
  };

  const lowerThirds: LowerThirdItem[] = [];
  for (let i = 0; i < lowerThirdsIn.length; i++) {
    const it = lowerThirdsIn[i] as Record<string, unknown>;
    const field = `lowerThirds[${i}]`;
    if (!it || typeof it !== "object") return fail(field, "must be an object");
    const id = checkId(it.id, `${field}.id`);
    if (typeof id !== "string") return id;
    const name = str(it.name);
    const title = it.title === undefined ? "" : str(it.title);
    if (!name) return fail(`${field}.name`, "name is required");
    if (name.length > GRAPHICS_LIMITS.name) return fail(`${field}.name`, `name must be ${GRAPHICS_LIMITS.name} characters or less`);
    if (title === null) return fail(`${field}.title`, "title must be a string");
    if (title.length > GRAPHICS_LIMITS.title) return fail(`${field}.title`, `title must be ${GRAPHICS_LIMITS.title} characters or less`);
    lowerThirds.push({ id, name, title });
  }

  const banners: BannerItem[] = [];
  for (let i = 0; i < bannersIn.length; i++) {
    const it = bannersIn[i] as Record<string, unknown>;
    const field = `banners[${i}]`;
    if (!it || typeof it !== "object") return fail(field, "must be an object");
    const id = checkId(it.id, `${field}.id`);
    if (typeof id !== "string") return id;
    const text = str(it.text);
    if (!text) return fail(`${field}.text`, "text is required");
    if (text.length > GRAPHICS_LIMITS.bannerText) {
      return fail(`${field}.text`, `text must be ${GRAPHICS_LIMITS.bannerText} characters or less`);
    }
    if (it.scroll !== undefined && typeof it.scroll !== "boolean") return fail(`${field}.scroll`, "scroll must be a boolean");
    banners.push({ id, text, scroll: it.scroll === true });
  }

  const active = (raw: unknown, list: Array<{ id: string }>, field: string): string | null | GraphicsParse => {
    if (raw === undefined || raw === null || raw === "") return null;
    if (typeof raw !== "string" || !list.some((x) => x.id === raw)) return fail(field, "must be the id of a saved item");
    return raw;
  };
  // (Casts: no strictNullChecks, so `string | null | GraphicsParse` doesn't narrow.)
  const lt = active(b.activeLowerThirdId, lowerThirds, "activeLowerThirdId");
  if (lt !== null && typeof lt === "object") return lt as GraphicsParse;
  const bn = active(b.activeBannerId, banners, "activeBannerId");
  if (bn !== null && typeof bn === "object") return bn as GraphicsParse;

  return {
    ok: true,
    value: { lowerThirds, banners, activeLowerThirdId: lt as string | null, activeBannerId: bn as string | null },
  };
}

/** Stored rooms/{id}.graphics, tolerating missing/old/invalid data (never throws). */
export function normalizeRoomGraphics(stored: unknown): RoomGraphics {
  const parsed = parseRoomGraphicsInput(stored);
  return parsed.ok ? parsed.value! : EMPTY_ROOM_GRAPHICS;
}

/** The lower third / banner currently shown, if any. */
export function activeGraphics(g: RoomGraphics): { lowerThird: LowerThirdItem | null; banner: BannerItem | null } {
  return {
    lowerThird: g.lowerThirds.find((x) => x.id === g.activeLowerThirdId) || null,
    banner: g.banners.find((x) => x.id === g.activeBannerId) || null,
  };
}

export function hasActiveGraphics(stored: unknown): boolean {
  const a = activeGraphics(normalizeRoomGraphics(stored));
  return !!(a.lowerThird || a.banner);
}

/**
 * Whether a change needs the roomBranding plan feature: anything that adds,
 * edits or shows an item does; hiding and deleting (cleanup) never do.
 */
export function graphicsChangeNeedsFeature(prev: RoomGraphics, next: RoomGraphics): boolean {
  const sameLt = (a: LowerThirdItem) => prev.lowerThirds.some((p) => p.id === a.id && p.name === a.name && p.title === a.title);
  const sameBn = (a: BannerItem) => prev.banners.some((p) => p.id === a.id && p.text === a.text && p.scroll === a.scroll);
  if (!next.lowerThirds.every(sameLt) || !next.banners.every(sameBn)) return true;
  if (next.activeLowerThirdId && next.activeLowerThirdId !== prev.activeLowerThirdId) return true;
  if (next.activeBannerId && next.activeBannerId !== prev.activeBannerId) return true;
  return false;
}
