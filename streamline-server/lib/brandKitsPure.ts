/**
 * Brand kits (pure, no I/O).
 *
 * A brand kit is an account-owned, reusable set of viewer-page branding
 * (title / subtitle / logo / offline message / theme). Stored in the
 * top-level `brandKits` collection ({ ownerId, name, ...branding }); the
 * owner's default kit id is users/{uid}.brandKitDefaultId. A room points at
 * one kit through rooms/{roomId}.brandKitId (picked when the room is created,
 * changeable by the owner later), so editing a kit updates every room that
 * uses it.
 *
 * Rooms without a kit keep the legacy per-room hlsConfig branding unchanged.
 */
import { publicBranding, validateBrandingInput } from "./hlsBrandingPure";

export const BRAND_KIT_LIMITS = {
  name: 60,
  /** Kits per account; keeps the list (and the create-room picker) small. */
  maxKitsPerOwner: 20,
} as const;

export type BrandKitTheme = "light" | "dark";

export type BrandKitFields = {
  name: string;
  title: string;
  subtitle: string;
  logoUrl: string;
  offlineMessage: string;
  theme: BrandKitTheme;
};

export type PublicKitBranding = NonNullable<ReturnType<typeof publicBranding>>;

// Flat shape: the server compiles without strictNullChecks (see hlsBrandingPure).
export type BrandKitParse = {
  ok: boolean;
  value?: Partial<BrandKitFields>;
  field?: string;
  details?: string;
};

const TEXT_FIELDS = ["title", "subtitle", "logoUrl", "offlineMessage"] as const;

/**
 * Validates a create (partial=false: name required) or update (partial=true:
 * only provided fields) body. Strings are trimmed before the length checks so
 * stored values match what the editor shows.
 */
export function parseBrandKitInput(body: any, opts: { partial: boolean }): BrandKitParse {
  if (!body || typeof body !== "object") return { ok: false, field: "body", details: "body must be an object" };
  const out: Partial<BrandKitFields> = {};

  if (body.name !== undefined || !opts.partial) {
    if (typeof body.name !== "string") return { ok: false, field: "name", details: "name must be a string" };
    const name = body.name.trim();
    if (!name) return { ok: false, field: "name", details: "name is required" };
    if (name.length > BRAND_KIT_LIMITS.name) {
      return { ok: false, field: "name", details: `name must be ${BRAND_KIT_LIMITS.name} characters or less` };
    }
    out.name = name;
  }

  const trimmed: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) {
    const v = body[f];
    if (v === undefined) continue;
    if (typeof v !== "string") return { ok: false, field: f, details: `${f} must be a string` };
    trimmed[f] = v.trim();
  }
  const branding = validateBrandingInput(trimmed);
  if (!branding.ok) return { ok: false, field: branding.field, details: branding.details };
  for (const f of TEXT_FIELDS) {
    if (typeof trimmed[f] === "string") out[f] = trimmed[f] as string;
  }

  if (body.theme !== undefined) {
    if (body.theme !== "light" && body.theme !== "dark") {
      return { ok: false, field: "theme", details: 'theme must be "light" or "dark"' };
    }
    out.theme = body.theme;
  }

  if (!opts.partial) {
    return {
      ok: true,
      value: {
        name: out.name,
        title: out.title ?? "",
        subtitle: out.subtitle ?? "",
        logoUrl: out.logoUrl ?? "",
        offlineMessage: out.offlineMessage ?? "",
        theme: out.theme ?? "dark",
      },
    };
  }
  return { ok: true, value: out };
}

/** Kit document as returned to its owner (no ownerId echo needed, but harmless). */
export function serializeBrandKit(id: string, data: any) {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id,
    name: s(data?.name) || "Untitled kit",
    title: s(data?.title),
    subtitle: s(data?.subtitle),
    logoUrl: s(data?.logoUrl),
    offlineMessage: s(data?.offlineMessage),
    theme: (data?.theme === "light" ? "light" : "dark") as BrandKitTheme,
    updatedAt: toIso(data?.updatedAt),
  };
}

function toIso(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v?.toDate === "function") return v.toDate().toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  return null;
}

/**
 * A kit only brands a room owned by the kit's owner. Rooms can only be
 * pointed at the owner's own kits, so this is defense in depth for stale or
 * hand-edited data.
 */
export function kitBrandingForRoom(kit: any, room: any): PublicKitBranding | null {
  if (!kit || typeof kit !== "object" || !room || typeof room !== "object") return null;
  const kitOwner = String(kit.ownerId || "").trim();
  const roomOwner = String(room.ownerId || "").trim();
  if (!kitOwner || kitOwner !== roomOwner) return null;
  return publicBranding(kit);
}

/** rooms/{id}.brandKitId when it looks like a Firestore doc id, else "". */
export function roomBrandKitId(room: any): string {
  const v = room?.brandKitId;
  if (typeof v !== "string") return "";
  const id = v.trim();
  return isValidKitId(id) ? id : "";
}

export function isValidKitId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 128 && !id.includes("/");
}

/**
 * Channel branding precedence for the public viewer (/live/:savedEmbedId):
 *   1. the kit of the room currently live on the channel,
 *   2. the kit of the channel's home room,
 *   3. the home room's legacy hlsConfig branding (pre-kit behavior).
 */
export function chooseChannelBranding(params: {
  activeRoomKit: PublicKitBranding | null;
  homeRoomKit: PublicKitBranding | null;
  homeLegacy: PublicKitBranding | null;
}): PublicKitBranding | null {
  return params.activeRoomKit || params.homeRoomKit || params.homeLegacy || null;
}

/** Public room hlsConfig with the room's kit branding laid over it (enabled etc. kept). */
export function overlayKitOnHlsConfig<T extends Record<string, any>>(hlsConfig: T, kit: PublicKitBranding | null): T {
  if (!kit) return hlsConfig;
  return { ...hlsConfig, ...kit };
}

/**
 * Which kit a new room gets.
 *   requested === undefined -> the owner's default kit (if any)
 *   requested === null / "" -> no kit
 *   requested string        -> that kit (must be the owner's; checked by the caller)
 */
export function pickCreateBrandKit(
  requested: unknown,
  defaultKitId: unknown
): { source: "none" | "default" | "explicit"; kitId: string } | { source: "invalid"; kitId: "" } {
  if (requested === undefined) {
    return isValidKitId(defaultKitId) ? { source: "default", kitId: defaultKitId } : { source: "none", kitId: "" };
  }
  if (requested === null || requested === "") return { source: "none", kitId: "" };
  if (typeof requested === "string" && isValidKitId(requested.trim())) {
    return { source: "explicit", kitId: requested.trim() };
  }
  return { source: "invalid", kitId: "" };
}
