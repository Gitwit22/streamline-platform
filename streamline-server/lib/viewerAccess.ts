/**
 * Viewer access model (pure — no Firestore imports; unit-tested).
 *
 * A creator channel decides who may watch its HLS output:
 *
 *   public        – anyone (direct public playlist URL, no extra cost)
 *   registered    – any signed-in StreamLine account
 *   subscriber    – paying channel subscribers (no subscription product yet:
 *                   rejected with subscriber_not_available)
 *   pay_per_view  – viewers holding a ViewerEntitlement for the PPV event
 *   private       – owner / cohosts / admins / explicit email allowlist
 *
 * Storage: rooms/{roomId}.viewerAccess on the channel's HOME room (the same
 * doc that holds the channel branding, rooms/{embed.roomId}.hlsConfig) and
 * optionally on any other room. The effective mode for a live room is the
 * STRICTEST of: its own setting, its channel's (home room) setting, and the
 * legacy rule "an active paid event paywalls the room" (pre-Stage-7
 * behaviour, kept so existing PPV events stay protected).
 *
 * Enforcement happens server-side when a playback token is issued
 * (routes/publicPlayback.ts) and again on every playlist fetch
 * (routes/hlsPlayback.ts).
 */

export const VIEWER_ACCESS_MODES = ["public", "registered", "subscriber", "pay_per_view", "private"] as const;
export type ViewerAccessMode = (typeof VIEWER_ACCESS_MODES)[number];

export interface ViewerAccess {
  mode: ViewerAccessMode;
  /** PPV event (monetizedEvents/{id}) that sells access; pay_per_view only. */
  ppvEventId?: string | null;
  /** private only: lower-cased emails allowed in addition to owner/cohosts. */
  allowEmails?: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_VIEWER_ACCESS: ViewerAccess = Object.freeze({ mode: "public" }) as ViewerAccess;

/** Strictness rank; the higher rank wins when several settings apply. */
const RANK: Record<ViewerAccessMode, number> = {
  public: 0,
  registered: 1,
  subscriber: 2,
  pay_per_view: 3,
  private: 4,
};

export function isViewerAccessMode(v: unknown): v is ViewerAccessMode {
  return typeof v === "string" && (VIEWER_ACCESS_MODES as readonly string[]).includes(v);
}

const MAX_ALLOW_EMAILS = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAllowEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const e = v.trim().toLowerCase();
    if (e && e.length <= 254 && EMAIL_RE.test(e)) out.add(e);
    if (out.size >= MAX_ALLOW_EMAILS) break;
  }
  return [...out];
}

/** Stored value → ViewerAccess. Missing / malformed → public (no behaviour change). */
export function normalizeViewerAccess(raw: unknown): ViewerAccess {
  if (!raw || typeof raw !== "object") return { mode: "public" };
  const r = raw as Record<string, unknown>;
  const mode = isViewerAccessMode(r.mode) ? r.mode : "public";
  const out: ViewerAccess = { mode };
  if (mode === "pay_per_view" && typeof r.ppvEventId === "string" && r.ppvEventId.trim()) {
    out.ppvEventId = r.ppvEventId.trim();
  }
  if (mode === "private") out.allowEmails = normalizeAllowEmails(r.allowEmails);
  return out;
}

/** True when a viewerAccess value was explicitly stored (vs. defaulted). */
export function hasExplicitViewerAccess(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && isViewerAccessMode((raw as any).mode);
}

/**
 * Pre-Stage-7 rooms: the per-room toggles (payPerViewEnabled /
 * monetizationEnabled) were never enforced; the only real paywall was "room
 * has an active (non-ended) paid event". Map that onto the new model:
 *   active paid event                → pay_per_view (that event)
 *   otherwise                        → public
 * payPerViewEnabled alone (no event) cannot be enforced (nothing to buy), so
 * it stays public; the settings UI shows a hint to create an event.
 */
export function legacyViewerAccess(room: { payPerViewEnabled?: unknown } | null | undefined, activePaidEventId: string | null): ViewerAccess {
  void room;
  if (activePaidEventId) return { mode: "pay_per_view", ppvEventId: activePaidEventId };
  return { mode: "public" };
}

/** Strictest of several settings; PPV event ids carry over from the PPV source. */
export function strictestViewerAccess(...items: Array<ViewerAccess | null | undefined>): ViewerAccess {
  let best: ViewerAccess = { mode: "public" };
  let ppvEventId: string | null = null;
  const allow = new Set<string>();
  for (const it of items) {
    if (!it) continue;
    if (it.mode === "pay_per_view" && it.ppvEventId && !ppvEventId) ppvEventId = it.ppvEventId;
    if (it.mode === "private") for (const e of it.allowEmails || []) allow.add(e);
    if (RANK[it.mode] > RANK[best.mode]) best = it;
  }
  const out: ViewerAccess = { mode: best.mode };
  if (out.mode === "pay_per_view") out.ppvEventId = best.ppvEventId || ppvEventId || null;
  if (out.mode === "private") out.allowEmails = [...allow];
  return out;
}

// ---------------------------------------------------------------------------
// Access decision
// ---------------------------------------------------------------------------

export interface ViewerState {
  /** Signed-in account uid (null for anonymous viewers). */
  uid: string | null;
  /** Verified email of the signed-in account (lower-cased), if known. */
  email?: string | null;
  /** Owner, cohost or platform admin of the room/channel. */
  isHost: boolean;
}

export interface PpvEventSummary {
  id: string;
  name: string;
  monetizationMode: "off" | "fixed" | "pwyw" | "donation";
  currency: string;
  fixedAmountCents: number | null;
  pwywMinCents: number | null;
  status: string;
}

export interface AccessDecisionInput {
  access: ViewerAccess;
  viewer: ViewerState;
  /** Viewer holds a live (not revoked/expired) entitlement for the PPV event. */
  hasEntitlement: boolean;
  /** The event that sells access (null when none is configured / active). */
  ppvEvent: PpvEventSummary | null;
  /** Owner's plan + platform flags still allow selling PPV (monetization + payPerView). */
  ppvSalesOpen: boolean;
  /** A subscription product exists for this channel (always false today). */
  subscriberProductAvailable?: boolean;
  /** Viewer holds an active subscriber entitlement (future). */
  hasSubscriberEntitlement?: boolean;
}

export type AccessGrantVia = "public" | "host" | "registered" | "entitlement" | "allowlist" | "subscriber";

export type AccessDecision =
  | { allow: true; via: AccessGrantVia }
  | {
      allow: false;
      status: 401 | 402 | 403;
      error:
        | "login_required"
        | "checkout_required"
        | "private"
        | "subscriber_not_available"
        | "ppv_unavailable";
      message: string;
      checkout?: {
        eventId: string;
        eventName: string;
        monetizationMode: PpvEventSummary["monetizationMode"];
        currency: string;
        fixedAmountCents: number | null;
        pwywMinCents: number | null;
      };
    };

function isPaidEvent(e: PpvEventSummary | null): e is PpvEventSummary {
  return !!e && (e.monetizationMode === "fixed" || e.monetizationMode === "pwyw") && e.status !== "ended";
}

/**
 * The access matrix (mode × viewer state × entitlement). Hosts (owner,
 * cohost, admin) can always watch their own output.
 */
export function decideViewerAccess(input: AccessDecisionInput): AccessDecision {
  const { access, viewer } = input;
  if (viewer.isHost) return { allow: true, via: "host" };

  switch (access.mode) {
    case "public":
      return { allow: true, via: "public" };

    case "registered":
      if (viewer.uid) return { allow: true, via: "registered" };
      return { allow: false, status: 401, error: "login_required", message: "Sign in to watch this stream." };

    case "subscriber":
      if (input.subscriberProductAvailable && input.hasSubscriberEntitlement) return { allow: true, via: "subscriber" };
      return {
        allow: false,
        status: 403,
        error: "subscriber_not_available",
        message: "This stream is for subscribers only. Subscriptions are coming soon.",
      };

    case "pay_per_view": {
      // Purchased access keeps working even if the event later ended or the
      // creator lost the PPV feature: viewers who paid are not locked out.
      if (input.hasEntitlement) return { allow: true, via: "entitlement" };
      const ev = input.ppvEvent;
      if (!isPaidEvent(ev) || !input.ppvSalesOpen) {
        return {
          allow: false,
          status: 403,
          error: "ppv_unavailable",
          message: "Tickets for this stream are not on sale right now.",
        };
      }
      return {
        allow: false,
        status: 402,
        error: "checkout_required",
        message: "Buy a ticket to watch this stream.",
        checkout: {
          eventId: ev.id,
          eventName: ev.name,
          monetizationMode: ev.monetizationMode,
          currency: ev.currency,
          fixedAmountCents: ev.fixedAmountCents,
          pwywMinCents: ev.pwywMinCents,
        },
      };
    }

    case "private":
    default: {
      const email = String(viewer.email || "").trim().toLowerCase();
      if (viewer.uid && email && (access.allowEmails || []).includes(email)) return { allow: true, via: "allowlist" };
      return { allow: false, status: 403, error: "private", message: "This stream is private." };
    }
  }
}

// ---------------------------------------------------------------------------
// Settings validation (PUT /api/rooms/:roomId/viewer-access)
// ---------------------------------------------------------------------------

export interface AccessModeGate {
  monetization: boolean;
  payPerView: boolean;
  hls: boolean;
}

export type ViewerAccessValidation =
  | { ok: true; value: ViewerAccess }
  | { ok: false; status: 400 | 403; error: string; reason: string };

/**
 * Validates a requested mode against the owner's entitlements. Turning a
 * channel back to public is always allowed (cleanup never needs a plan).
 */
export function validateViewerAccessRequest(
  body: any,
  gate: AccessModeGate,
  ctx: { activePaidEventIds: string[] }
): ViewerAccessValidation {
  const mode = body?.mode;
  if (!isViewerAccessMode(mode)) {
    return { ok: false, status: 400, error: "invalid_mode", reason: `mode must be one of ${VIEWER_ACCESS_MODES.join(", ")}` };
  }
  if (mode === "public") return { ok: true, value: { mode } };
  if (!gate.hls) {
    return { ok: false, status: 403, error: "hls_not_in_plan", reason: "Viewer access control requires HLS on your plan." };
  }
  if (mode === "subscriber") {
    return {
      ok: false,
      status: 403,
      error: "subscriber_not_available",
      reason: "Subscriber-only channels are coming soon.",
    };
  }
  if (mode === "registered") return { ok: true, value: { mode } };
  if (mode === "private") return { ok: true, value: { mode, allowEmails: normalizeAllowEmails(body?.allowEmails) } };

  // pay_per_view
  if (!gate.monetization) {
    return { ok: false, status: 403, error: "monetization_not_enabled", reason: "Monetization is not available on your plan." };
  }
  if (!gate.payPerView) {
    return { ok: false, status: 403, error: "ppv_not_entitled", reason: "Your plan does not include pay-per-view." };
  }
  const requested = typeof body?.ppvEventId === "string" ? body.ppvEventId.trim() : "";
  if (requested) {
    if (!ctx.activePaidEventIds.includes(requested)) {
      return {
        ok: false,
        status: 400,
        error: "ppv_event_invalid",
        reason: "Pick an active paid event for this room.",
      };
    }
    return { ok: true, value: { mode, ppvEventId: requested } };
  }
  if (ctx.activePaidEventIds.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "ppv_event_required",
      reason: "Create a paid event for this room first (Monetization page).",
    };
  }
  return { ok: true, value: { mode, ppvEventId: ctx.activePaidEventIds[0] } };
}
