/**
 * Brand kits: account-owned, reusable viewer-page branding.
 *
 * Server: streamline-server/routes/brandKits.ts (rules in lib/brandKitsPure.ts).
 * A room uses one kit (rooms/{id}.brandKitId), chosen when the room is created
 * (default kit pre-selected) or later by the owner. Rooms without a kit keep
 * their own hlsConfig branding (Settings -> HLS -> Channel branding).
 */
import { API_BASE } from "./apiBase";
import { apiFetchAuth } from "./api";
import { brandingFromConfig, type HlsBranding } from "./hlsBranding";

export const BRAND_KIT_NAME_MAX = 60;

export type BrandKit = HlsBranding & {
  id: string;
  name: string;
  updatedAt: string | null;
};

export type BrandKitList = {
  kits: BrandKit[];
  defaultKitId: string | null;
  /** Plan includes viewer branding (hlsCustomization) and the platform switch is on. */
  canEdit: boolean;
  blockedReason: "plan" | "platform" | null;
};

export class BrandKitError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

type RawKit = Partial<Record<"id" | "name" | "title" | "subtitle" | "logoUrl" | "offlineMessage" | "theme" | "updatedAt", unknown>>;

function toKit(raw: RawKit | null | undefined): BrandKit {
  return {
    ...brandingFromConfig(raw as Parameters<typeof brandingFromConfig>[0]),
    id: String(raw?.id || ""),
    name: String(raw?.name || "Untitled kit"),
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : null,
  };
}

/** Human-readable message for a server error code. */
export function brandKitErrorMessage(code: string, details?: string): string {
  switch (code) {
    case "brand_kits_not_in_plan":
    case "feature_not_entitled":
      return "Brand kits are not included in your plan.";
    case "feature_disabled":
      return "Branding is temporarily disabled.";
    case "brand_kit_limit_reached":
      return "You've reached the maximum number of brand kits.";
    case "brand_kit_not_found":
    case "invalid_brand_kit":
      return "That brand kit no longer exists.";
    case "branding_owner_only":
      return "Only the room owner can change its branding.";
    default:
      return details || code || "Request failed.";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped JSON payload, narrowed by each caller
async function call(path: string, init: RequestInit = {}, opts: { quiet?: boolean } = {}): Promise<any> {
  const res = await apiFetchAuth(`${API_BASE}${path}`, init, {
    allowNonOk: true,
    suppressAuthSideEffects: !!opts.quiet,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const code = String(payload?.error || `http_${res.status}`);
    throw new BrandKitError(code, brandKitErrorMessage(code, payload?.details));
  }
  return payload;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** quiet: don't trigger the global sign-out/redirect on 401 (pages that also serve signed-out users). */
export async function listBrandKits(opts: { quiet?: boolean } = {}): Promise<BrandKitList> {
  const p = await call("/api/brand-kits", { cache: "no-store" }, opts);
  return {
    kits: Array.isArray(p?.kits) ? p.kits.map(toKit) : [],
    defaultKitId: typeof p?.defaultKitId === "string" ? p.defaultKitId : null,
    canEdit: p?.canEdit === true,
    blockedReason: p?.blockedReason === "platform" ? "platform" : p?.blockedReason === "plan" ? "plan" : null,
  };
}

export type BrandKitInput = HlsBranding & { name: string };

function inputBody(input: BrandKitInput) {
  return {
    name: input.name.trim(),
    title: input.title.trim(),
    subtitle: input.subtitle.trim(),
    logoUrl: input.logoUrl.trim(),
    offlineMessage: input.offlineMessage.trim(),
    theme: input.theme,
  };
}

export async function createBrandKit(
  input: BrandKitInput,
  makeDefault: boolean
): Promise<{ kit: BrandKit; defaultKitId: string | null }> {
  const p = await call("/api/brand-kits", jsonInit("POST", { ...inputBody(input), makeDefault }));
  return { kit: toKit(p?.kit), defaultKitId: typeof p?.defaultKitId === "string" ? p.defaultKitId : null };
}

export async function updateBrandKit(id: string, input: BrandKitInput): Promise<BrandKit> {
  const p = await call(`/api/brand-kits/${encodeURIComponent(id)}`, jsonInit("PUT", inputBody(input)));
  return toKit(p?.kit);
}

export async function deleteBrandKit(id: string): Promise<void> {
  await call(`/api/brand-kits/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function setDefaultBrandKit(kitId: string | null): Promise<string | null> {
  const p = await call("/api/brand-kits/default", jsonInit("PUT", { kitId }));
  return typeof p?.defaultKitId === "string" ? p.defaultKitId : null;
}

/** Owner only. null = no kit (the room's own hlsConfig branding applies). */
export async function setRoomBrandKit(roomId: string, brandKitId: string | null): Promise<string | null> {
  const p = await call(`/api/rooms/${encodeURIComponent(roomId)}/brand-kit`, jsonInit("PUT", { brandKitId }));
  return typeof p?.brandKitId === "string" ? p.brandKitId : null;
}
