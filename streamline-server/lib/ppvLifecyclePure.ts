/**
 * Pay-per-view event lifecycle + broadcast/ticket rules (pure; unit-tested).
 *
 * Statuses (stored value → meaning):
 *   draft  → "scheduled": created, tickets on presale, NOT paywalling the room
 *   live   → "started":   the room's current paid show; paywalls the room and
 *                         is assigned to the next protected broadcast
 *   ended  → closed: no checkout, no live playback; tickets + payments kept
 *
 * Legacy events (no lifecycleVersion) predate explicit Start: any non-ended
 * paid event paywalled its room. They are treated as "live" until the creator
 * ends them, so no room that is protected today becomes public.
 *
 * A broadcast (one HLS run) is bound to exactly one event when it starts
 * (rooms/{id}.hls.ppvEventId). Paid playback requires the requested event,
 * the broadcast's event and the viewer's ticket event to be the same.
 */

export const PPV_LIFECYCLE_VERSION = 2;

export type StoredEventStatus = "draft" | "live" | "ended";
export type EffectiveEventStatus = "scheduled" | "live" | "ended";

export interface LifecycleEvent {
  id: string;
  roomId: string;
  monetizationMode: "off" | "fixed" | "pwyw" | "donation" | string;
  status: StoredEventStatus | string;
  lifecycleVersion?: number | null;
}

export function isPaidMode(mode: unknown): boolean {
  return mode === "fixed" || mode === "pwyw";
}

export function isLegacyEvent(e: Pick<LifecycleEvent, "lifecycleVersion">): boolean {
  return !(typeof e.lifecycleVersion === "number" && e.lifecycleVersion >= PPV_LIFECYCLE_VERSION);
}

export function effectiveEventStatus(e: LifecycleEvent): EffectiveEventStatus {
  if (e.status === "ended") return "ended";
  if (e.status === "live") return "live";
  // draft: legacy drafts were already paywalling → live; v2 drafts are scheduled.
  return isLegacyEvent(e) ? "live" : "scheduled";
}

/** Paid event that currently paywalls its room (started, or legacy non-ended). */
export function isLivePaidEvent(e: LifecycleEvent | null | undefined): boolean {
  return !!e && isPaidMode(e.monetizationMode) && effectiveEventStatus(e) === "live";
}

/** Checkout accepts new payments: scheduled (presale) or live, never ended/off. */
export function isCheckoutOpen(e: LifecycleEvent | null | undefined): boolean {
  if (!e || e.monetizationMode === "off") return false;
  return effectiveEventStatus(e) !== "ended";
}

export type TransitionResult =
  | { ok: true; noop: boolean; to: StoredEventStatus }
  | { ok: false; error: "invalid_transition"; from: EffectiveEventStatus; to: "start" | "end" };

/** Server-side transition rules (idempotent: repeating an action is a no-op). */
export function planTransition(e: LifecycleEvent, action: "start" | "end"): TransitionResult {
  const from = effectiveEventStatus(e);
  if (action === "end") {
    if (from === "ended") return { ok: true, noop: true, to: "ended" };
    return { ok: true, noop: false, to: "ended" };
  }
  // start
  if (from === "ended") return { ok: false, error: "invalid_transition", from, to: "start" };
  if (from === "live") return { ok: true, noop: e.status === "live", to: "live" };
  return { ok: true, noop: false, to: "live" };
}

/** Fields that change what a ticket costs; locked after the first sale. */
export const PRICE_FIELDS = ["monetizationMode", "currency", "fixedAmountCents", "pwywMinCents"] as const;

export function priceChangeRequested(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>
): string[] {
  const changed: string[] = [];
  for (const f of PRICE_FIELDS) {
    if (!(f in patch)) continue;
    const a = existing[f] ?? null;
    const b = patch[f] ?? null;
    const norm = (v: unknown) => (f === "currency" && typeof v === "string" ? v.toLowerCase() : v);
    if (norm(a) !== norm(b)) changed.push(f);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Broadcast ↔ event
// ---------------------------------------------------------------------------

export interface BroadcastState {
  /** HLS run is live (or starting). */
  live: boolean;
  /** Run writes to an unguessable prefix (hls/<room>/p-…/). */
  protected: boolean;
  /** Event the run was bound to at start (null: none / legacy). */
  eventId: string | null;
}

export function broadcastStateFromHls(hls: any): BroadcastState {
  const status = String(hls?.status || "idle");
  const live = status === "live" || status === "starting";
  const prefix = String(hls?.prefix || "");
  const eventId = typeof hls?.ppvEventId === "string" && hls.ppvEventId.trim() ? hls.ppvEventId.trim() : null;
  return { live, protected: prefix.includes("/p-"), eventId };
}

/**
 * Event a NEW broadcast gets bound to. Exactly one live paid event on the
 * room/channel → that event. An explicit room setting that names one of the
 * live events wins. Several live events with no explicit pick (legacy data)
 * → null: paid playback then fails closed and the host is told to end the
 * extra events.
 */
export function pickBroadcastEventId(liveEventIds: string[], explicitEventId: string | null): string | null {
  const ids = [...new Set(liveEventIds.filter(Boolean))];
  if (explicitEventId && ids.includes(explicitEventId)) return explicitEventId;
  return ids.length === 1 ? ids[0] : null;
}

/** Can the host start a paid event while this broadcast is running? */
export type StartBroadcastCheck =
  | { ok: true; restartRequired: boolean }
  | { ok: false; error: "broadcast_public_restart_required" };

export function checkStartAgainstBroadcast(b: BroadcastState, eventId: string): StartBroadcastCheck {
  if (!b.live) return { ok: true, restartRequired: false };
  // A public run can't be sold: its playlist path is guessable and was
  // already handed out publicly.
  if (!b.protected) return { ok: false, error: "broadcast_public_restart_required" };
  return { ok: true, restartRequired: b.eventId !== eventId };
}

// ---------------------------------------------------------------------------
// Paid playback decision (PPV branch)
// ---------------------------------------------------------------------------

export interface PpvPlaybackInput {
  isHost: boolean;
  /** Event the viewer is asking about (page event, or the broadcast's). */
  event: (LifecycleEvent & { name?: string }) | null;
  /** Event belongs to this room or its channel's home room. */
  eventInRoom: boolean;
  broadcast: BroadcastState;
  /** Viewer holds a live entitlement for `event`. */
  hasTicket: boolean;
  /** Owner's plan + platform flags allow selling. */
  salesOpen: boolean;
}

export type PpvPlaybackDecision =
  | { kind: "play" }
  | { kind: "wait"; reason: "offline" | "other_event" }
  | { kind: "checkout" }
  | {
      kind: "deny";
      status: 403 | 404;
      error: "ppv_unavailable" | "ppv_event_ended" | "ppv_broadcast_unassigned" | "event_not_found";
    };

export function decidePpvPlayback(input: PpvPlaybackInput): PpvPlaybackDecision {
  const { event, broadcast } = input;

  if (input.isHost) return broadcast.live ? { kind: "play" } : { kind: "wait", reason: "offline" };

  if (!event || !input.eventInRoom) {
    // Live paid broadcast that was never bound to an event (legacy run, or
    // several live events): fail closed.
    if (broadcast.live && !broadcast.eventId) return { kind: "deny", status: 403, error: "ppv_broadcast_unassigned" };
    return { kind: "deny", status: event ? 404 : 403, error: event ? "event_not_found" : "ppv_unavailable" };
  }

  const status = effectiveEventStatus(event);
  if (status === "ended") return { kind: "deny", status: 403, error: "ppv_event_ended" };

  if (!input.hasTicket) {
    if (isPaidMode(event.monetizationMode) && input.salesOpen && isCheckoutOpen(event)) return { kind: "checkout" };
    return { kind: "deny", status: 403, error: "ppv_unavailable" };
  }

  if (!broadcast.live) return { kind: "wait", reason: "offline" };
  if (!broadcast.eventId) return { kind: "deny", status: 403, error: "ppv_broadcast_unassigned" };
  if (broadcast.eventId !== event.id) return { kind: "wait", reason: "other_event" };
  return { kind: "play" };
}
