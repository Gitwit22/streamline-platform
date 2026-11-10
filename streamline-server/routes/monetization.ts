/**
 * Monetization v1 — API Routes
 *
 * POST   /api/monetization/events          – create/update MonetizedEvent
 * GET    /api/monetization/events           – list events for authenticated host
 * POST   /api/monetization/events/:id/start – start event (owner; validated transition)
 * POST   /api/monetization/events/:id/end   – end event (owner; idempotent)
 * GET    /api/monetization/events/:eventId  – get single event (public)
 * POST   /api/monetization/checkout         – create Stripe Checkout session
 * GET    /api/monetization/code             – poll for raw access code after success
 * POST   /api/monetization/redeem           – redeem access code
 * POST   /api/monetization/recover          – guest ticket recovery by email (generic reply)
 * POST   /api/monetization/enter            – gate check (can viewer watch?)
 */

import { recordTelemetry } from "../lib/telemetry";
import { Router, type Request, type Response } from "express";
import { stripe } from "../lib/stripe";
import { requireAuth, tryGetAuthUserAny } from "../middleware/requireAuth";
import { getDeviceId } from "../lib/viewerDevice";
import { deviceKeyFor, safeReturnPath } from "../lib/viewerEntitlementsPure";
import {
  findActivePpvEntitlement,
  grantPpvEntitlement,
  revokeOtherDeviceEntitlements,
} from "../lib/viewerEntitlements";
import { issuePlayback } from "../lib/hlsPlayback";
import { resolveRoomViewerAccess } from "../lib/viewerAccessStore";
import { listLedgerForCreator } from "../lib/revenueLedger";
import { getPlatformFeeBps, summarizeEarnings } from "../lib/revenueLedgerPure";
import { getPurchase } from "../lib/monetization";
import { canAccessFeature } from "./featureAccess";
import { checkFeature, getEffectiveEntitlements } from "../lib/entitlements";
import { firestore as db } from "../firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { clearViewerAccessCache } from "../lib/viewerAccessStore";
import {
  broadcastStateFromHls,
  checkStartAgainstBroadcast,
  decidePpvPlayback,
  effectiveEventStatus,
  isCheckoutOpen,
  isLivePaidEvent,
  isPaidMode,
  planTransition,
  priceChangeRequested,
  type BroadcastState,
} from "../lib/ppvLifecyclePure";
import {
  emitPpvEventEnded,
  emitPpvEventScheduled,
  emitPpvEventStarted,
} from "../events/emitters/commerceEmitter";
import { getCreatorContact } from "../lib/creatorContact";
import { recoverTicketsByEmail } from "../lib/ppvCodeEmail";
import { isValidEmail } from "../lib/ppvCodeEmailPure";
import { SlidingWindowLimiter, clientIp, rateLimit } from "../lib/rateLimit";
import {
  createMonetizedEvent,
  updateMonetizedEvent,
  getMonetizedEvent,
  listMonetizedEventsByOwner,
  hashAccessCode,
  findAccessCodeByHash,
  claimAccessCode,
  findClaimedCodeForDevice,
  retrieveAndDeleteRawCode,
  hasAccessSale,
  summarizeEventSales,
  monetizedEventRef,
  monetizedEventsCollection,
  type MonetizedEvent,
  type MonetizationMode,
  type CreateEventInput,
} from "../lib/monetization";

const router = Router();

// Where Stripe sends the viewer back after paying. Production must set
// CLIENT_URL: falling back to localhost there sent paying viewers to a dead
// page (audit P2). The localhost default is kept for local development only.
function clientUrl(): string | null {
  const v = String(process.env.CLIENT_URL || "").trim();
  if (v) return v.replace(/\/+$/, "");
  return process.env.NODE_ENV === "production" ? null : "http://localhost:5173";
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const VALID_MODES: MonetizationMode[] = ["off", "fixed", "pwyw", "donation"];

/** Event + its effective lifecycle status for clients. */
function withLifecycle(e: MonetizedEvent) {
  return { ...e, effectiveStatus: effectiveEventStatus(e as any), checkoutOpen: isCheckoutOpen(e as any) };
}

/** What the host needs to know about the room's broadcast for this event. */
function broadcastSummaryFor(e: MonetizedEvent, b: BroadcastState | null) {
  const state = b || { live: false, protected: false, eventId: null };
  const paid = isPaidMode(e.monetizationMode);
  return {
    live: state.live,
    protected: state.protected,
    assignedEventId: state.eventId,
    /** This event's ticket holders can watch the running broadcast. */
    servingThisEvent: state.live && state.eventId === e.id,
    /** Paid event is started but the running broadcast belongs elsewhere / is public. */
    restartRequired: paid && isLivePaidEvent(e as any) && state.live && state.eventId !== e.id,
    /** Running paid broadcast with no event binding (legacy): paid playback is blocked. */
    unassigned: paid && isLivePaidEvent(e as any) && state.live && !state.eventId,
  };
}



// ---------------------------------------------------------------------------
// POST /events – create or update monetized event (host, auth required)
// ---------------------------------------------------------------------------
router.post("/events", requireAuth, async (req: Request, res: Response) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    // ── Entitlement gates ────────────────────────────────────────────
    const monetizationAccess = await canAccessFeature(uid, "monetization");
    if (!monetizationAccess.allowed) {
      return res.status(403).json({
        error: "monetization_not_enabled",
        reason: monetizationAccess.reason || "Monetization is not enabled on this platform",
      });
    }

    const ppvAccess = await canAccessFeature(uid, "payPerView");
    if (!ppvAccess.allowed) {
      return res.status(403).json({
        error: "ppv_not_entitled",
        reason: ppvAccess.reason || "Your plan does not include pay-per-view",
      });
    }

    const hlsAccess = await canAccessFeature(uid, "hls");
    if (!hlsAccess.allowed) {
      return res.status(403).json({
        error: "hls_not_entitled",
        reason: hlsAccess.reason || "Pay-per-view requires an HLS-enabled plan",
      });
    }

    const {
      eventId,
      roomId,
      name,
      startsAt,
      monetizationMode,
      currency,
      fixedAmountCents,
      pwywMinCents,
      donationPresetsCents,
      allowCustomDonation,
      singlePersonOnly,
      status,
    } = req.body;

    if (!VALID_MODES.includes(monetizationMode)) {
      return res.status(400).json({ error: "invalid_monetization_mode" });
    }

    if (monetizationMode === "fixed") {
      if (typeof fixedAmountCents !== "number" || fixedAmountCents < 100) {
        return res.status(400).json({ error: "fixed_amount_required_min_100_cents" });
      }
    }

    if (monetizationMode === "pwyw") {
      if (pwywMinCents !== undefined && pwywMinCents !== null) {
        if (typeof pwywMinCents !== "number" || pwywMinCents < 0) {
          return res.status(400).json({ error: "pwyw_min_must_be_non_negative" });
        }
      }
    }

    // Update existing event
    if (eventId) {
      const existing = await getMonetizedEvent(eventId);
      if (!existing) return res.status(404).json({ error: "event_not_found" });
      if (existing.ownerUid !== uid) {
        return res.status(403).json({ error: "not_owner" });
      }

      if (effectiveEventStatus(existing as any) === "ended") {
        return res.status(409).json({ error: "event_ended", reason: "This event has ended and can no longer be edited." });
      }

      const patch: Record<string, any> = {};
      if (name !== undefined) patch.name = String(name).slice(0, 200);
      if (startsAt !== undefined) patch.startsAt = startsAt || null;
      if (monetizationMode !== undefined) patch.monetizationMode = monetizationMode;
      if (currency !== undefined) patch.currency = String(currency).toLowerCase();
      if (fixedAmountCents !== undefined) patch.fixedAmountCents = fixedAmountCents;
      if (pwywMinCents !== undefined) patch.pwywMinCents = pwywMinCents;
      if (donationPresetsCents !== undefined) patch.donationPresetsCents = donationPresetsCents;
      if (allowCustomDonation !== undefined) patch.allowCustomDonation = !!allowCustomDonation;
      if (singlePersonOnly !== undefined) patch.singlePersonOnly = !!singlePersonOnly;
      // Status is NOT editable here: saving settings preserves it. Use
      // POST /events/:eventId/start|end (validated transitions).
      void status;

      // Ticket price is fixed once anyone has bought a ticket.
      const priceChanges = priceChangeRequested(existing as any, patch);
      if (priceChanges.length > 0 && (await hasAccessSale(eventId))) {
        return res.status(409).json({
          error: "price_locked",
          fields: priceChanges,
          reason: "Tickets have already been sold for this event, so the price can't change.",
        });
      }
      // Changing a started event into a paid one would paywall the room
      // without the broadcast checks done by Start.
      const nextMode = patch.monetizationMode ?? existing.monetizationMode;
      if (
        isPaidMode(nextMode) &&
        !isPaidMode(existing.monetizationMode) &&
        effectiveEventStatus(existing as any) === "live"
      ) {
        return res.status(409).json({
          error: "end_event_first",
          reason: "End this event and create a paid one instead.",
        });
      }

      await updateMonetizedEvent(eventId, patch);
      clearViewerAccessCache();
      const updated = await getMonetizedEvent(eventId);
      return res.json({ ok: true, event: updated ? withLifecycle(updated) : updated });
    }

    // ── Create new event ─────────────────────────────────────────────
    if (!roomId) return res.status(400).json({ error: "room_id_required" });
    if (!name) return res.status(400).json({ error: "name_required" });

    // Validate room exists, belongs to this user, and is HLS-capable
    let roomSnap;
    try {
      roomSnap = await db.collection("rooms").doc(String(roomId)).get();
    } catch {
      return res.status(400).json({ error: "room_lookup_failed" });
    }
    if (!roomSnap.exists) {
      return res.status(400).json({ error: "room_not_found" });
    }
    const roomData = roomSnap.data() as any;
    if (roomData.ownerId !== uid) {
      return res.status(403).json({ error: "not_room_owner" });
    }
    // Enforce HLS-only: room must be of type "hls" or have active HLS config
    const roomIsHls =
      roomData.roomType === "hls" ||
      roomData.hlsConfig?.enabled === true;
    if (!roomIsHls) {
      return res.status(400).json({
        error: "room_not_hls",
        reason: "Pay-per-view requires an HLS-enabled room. Enable HLS on this room first.",
      });
    }

    const input: CreateEventInput = {
      roomId: String(roomId),
      ownerUid: uid,
      name: String(name).slice(0, 200),
      startsAt: startsAt || null,
      monetizationMode,
      currency: currency || "usd",
      fixedAmountCents: fixedAmountCents ?? null,
      pwywMinCents: pwywMinCents ?? undefined,
      donationPresetsCents: donationPresetsCents ?? undefined,
      allowCustomDonation: allowCustomDonation ?? undefined,
      singlePersonOnly: singlePersonOnly ?? undefined,
    };

    // New events start "scheduled" (draft): presale open, room access
    // unchanged until the creator presses Start.
    const event = await createMonetizedEvent(input);
    if (isPaidMode(event.monetizationMode)) {
      void getCreatorContact(uid).then((creator) =>
        emitPpvEventScheduled({ id: event.id, name: event.name, roomId: event.roomId, startsAt: event.startsAt }, creator)
      );
    }
    return res.status(201).json({ ok: true, event: withLifecycle(event) });
  } catch (err: any) {
    console.error("[monetization] create/update event error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// GET /events – list events for authenticated host
// ---------------------------------------------------------------------------
router.get("/events", requireAuth, async (req: Request, res: Response) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const events = await listMonetizedEventsByOwner(uid);
    const roomIds = [...new Set(events.map((e) => e.roomId).filter(Boolean))];
    const broadcasts = new Map<string, ReturnType<typeof broadcastStateFromHls>>();
    await Promise.all(
      roomIds.map(async (rid) => {
        const snap = await db.collection("rooms").doc(rid).get().catch(() => null);
        broadcasts.set(rid, broadcastStateFromHls(snap?.exists ? (snap.data() as any)?.hls : null));
      })
    );
    const sold = await Promise.all(events.map((e) => hasAccessSale(e.id).catch(() => false)));
    return res.json({
      ok: true,
      events: events.map((e, i) => ({
        ...withLifecycle(e),
        priceLocked: sold[i],
        broadcast: broadcastSummaryFor(e, broadcasts.get(e.roomId) || null),
      })),
    });
  } catch (err: any) {
    console.error("[monetization] list events error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// POST /events/:eventId/start | /end – explicit lifecycle (owner only)
// ---------------------------------------------------------------------------
// start: scheduled → live. One started paid event per room. Refused while the
//        room broadcasts publicly (restart in protected mode first). A
//        protected broadcast that belongs to another event keeps serving that
//        event; the response says a restart is needed for this one.
// end:   → ended (idempotent). Closes checkout and stops live playback for
//        this event's tickets. Tickets, purchases and revenue are kept.
class TransitionError extends Error {
  constructor(public status: number, public code: string, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}

async function transitionEvent(eventId: string, uid: string, action: "start" | "end") {
  const ref = monetizedEventRef(eventId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new TransitionError(404, "event_not_found");
    const ev = snap.data() as MonetizedEvent;
    if (ev.ownerUid !== uid) throw new TransitionError(403, "not_owner");

    const plan = planTransition(ev as any, action);
    if ("error" in plan) throw new TransitionError(409, plan.error, { from: plan.from });

    const roomRef = db.collection("rooms").doc(ev.roomId);
    const roomSnap = await tx.get(roomRef);
    const broadcast = broadcastStateFromHls(roomSnap.exists ? (roomSnap.data() as any)?.hls : null);

    let restartRequired = false;
    if (action === "start" && isPaidMode(ev.monetizationMode)) {
      // Reading the room's events inside the transaction makes two
      // concurrent Starts on the same room conflict (one retries and loses).
      const roomEvents = await tx.get(monetizedEventsCollection().where("roomId", "==", ev.roomId));
      const other = roomEvents.docs
        .map((d) => d.data() as MonetizedEvent)
        .find((e) => e.id !== ev.id && isLivePaidEvent(e as any));
      if (other) {
        throw new TransitionError(409, "another_event_live", {
          liveEventId: other.id,
          liveEventName: other.name,
          reason: `End "${other.name}" before starting this event.`,
        });
      }
      const check = checkStartAgainstBroadcast(broadcast, ev.id);
      if ("error" in check) {
        throw new TransitionError(409, check.error, {
          reason:
            "This room is already streaming publicly. Stop the stream, start the event, then go live again so the broadcast is protected.",
        });
      }
      restartRequired = "restartRequired" in check ? check.restartRequired : false;
    }

    const now = Date.now();
    if (!plan.noop) {
      tx.update(ref, {
        status: plan.to,
        ...(action === "start" ? { startedAt: now } : { endedAt: now }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      event: { ...ev, status: plan.to, ...(action === "start" ? { startedAt: plan.noop ? ev.startedAt ?? null : now } : {}), ...(action === "end" ? { endedAt: plan.noop ? ev.endedAt ?? now : now } : {}) } as MonetizedEvent,
      noop: plan.noop,
      broadcast,
      restartRequired,
      at: now,
    };
  });
}

async function handleTransition(req: Request, res: Response, action: "start" | "end") {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const eventId = String(req.params.eventId || "").trim();
    if (!eventId) return res.status(400).json({ error: "missing_event_id" });

    if (action === "start") {
      const existing = await getMonetizedEvent(eventId);
      if (existing && isPaidMode(existing.monetizationMode)) {
        for (const feature of ["monetization", "payPerView", "hls"] as const) {
          const gate = await canAccessFeature(uid, feature);
          if (!gate.allowed) {
            return res.status(403).json({ error: `${feature}_not_entitled`, reason: gate.reason || "Not included in your plan" });
          }
        }
      }
    }

    const result = await transitionEvent(eventId, uid, action);
    clearViewerAccessCache();

    const ev = result.event;
    if (!result.noop && isPaidMode(ev.monetizationMode)) {
      const ref = { id: ev.id, name: ev.name, roomId: ev.roomId, startsAt: ev.startsAt };
      void (async () => {
        const creator = await getCreatorContact(uid);
        if (action === "start") emitPpvEventStarted(ref, creator, result.at);
        else emitPpvEventEnded(ref, creator, await summarizeEventSales(ev.id).catch(() => ({ ticketsSold: 0, grossCents: 0, currency: ev.currency || "usd" })));
      })().catch((e: any) => console.warn("[monetization] lifecycle event emit failed", { eventId: ev.id, error: e?.message }));
    }

    const b = result.broadcast;
    return res.json({
      ok: true,
      noop: result.noop,
      event: withLifecycle(ev),
      broadcast: {
        ...broadcastSummaryFor(ev, b),
        restartRequired: action === "start" ? result.restartRequired : false,
        // Ending leaves the stream running; this event's ticket holders are cut off.
        stillLiveForThisEvent: action === "end" && b.live && b.eventId === ev.id,
      },
    });
  } catch (err: any) {
    if (err instanceof TransitionError) {
      return res.status(err.status).json({ error: err.code, ...err.extra });
    }
    console.error(`[monetization] ${action} event error:`, err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
}

router.post("/events/:eventId/start", requireAuth, (req, res) => void handleTransition(req, res, "start"));
router.post("/events/:eventId/end", requireAuth, (req, res) => void handleTransition(req, res, "end"));

// ---------------------------------------------------------------------------
// GET /events/:eventId – public event details (for viewer page)
// ---------------------------------------------------------------------------
router.get("/events/:eventId", async (req: Request, res: Response) => {
  try {
    const event = await getMonetizedEvent(String(req.params.eventId ?? ""));
    if (!event) return res.status(404).json({ error: "event_not_found" });

    // Return public-safe subset
    return res.json({
      ok: true,
      event: {
        id: event.id,
        roomId: event.roomId,
        name: event.name,
        startsAt: event.startsAt,
        monetizationMode: event.monetizationMode,
        currency: event.currency,
        fixedAmountCents: event.fixedAmountCents,
        pwywMinCents: event.pwywMinCents,
        donationPresetsCents: event.donationPresetsCents,
        allowCustomDonation: event.allowCustomDonation,
        status: event.status,
        effectiveStatus: effectiveEventStatus(event as any),
        checkoutOpen: isCheckoutOpen(event as any),
      },
    });
  } catch (err: any) {
    console.error("[monetization] get event error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// POST /checkout – create Stripe Checkout session
// ---------------------------------------------------------------------------
router.post("/checkout", async (req: Request, res: Response) => {
  try {
    const { eventId, type, amountCents } = req.body;
    if (!eventId || !type) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const event = await getMonetizedEvent(eventId);
    if (!event) return res.status(404).json({ error: "event_not_found" });

    // Validate type vs mode
    if (
      (event.monetizationMode === "fixed" || event.monetizationMode === "pwyw") &&
      type !== "access"
    ) {
      return res.status(400).json({ error: "type_must_be_access" });
    }
    if (event.monetizationMode === "donation" && type !== "donation") {
      return res.status(400).json({ error: "type_must_be_donation" });
    }
    if (event.monetizationMode === "off") {
      return res.status(400).json({ error: "monetization_off" });
    }
    if (!isCheckoutOpen(event as any)) {
      return res.status(409).json({ error: "event_ended", reason: "This event has ended. Tickets are no longer on sale." });
    }

    // Server-side kill switches + the event OWNER's effective entitlements:
    // no new payments when monetization (or PPV for paid access) is off
    // platform-wide or no longer included in the owner's plan.
    const ownerEnt = await getEffectiveEntitlements(String(event.ownerUid || ""));
    const monetizationCheck = checkFeature(ownerEnt, "monetization");
    if (!monetizationCheck.allowed) {
      return res.status(403).json({ error: "monetization_unavailable", reason: monetizationCheck.reason });
    }
    if (type === "access") {
      const ppvCheck = checkFeature(ownerEnt, "payPerView");
      if (!ppvCheck.allowed) {
        return res.status(403).json({ error: "ppv_unavailable", reason: ppvCheck.reason });
      }
    }

    // Determine amount
    let finalAmountCents: number;
    if (event.monetizationMode === "fixed") {
      finalAmountCents = event.fixedAmountCents!;
    } else if (event.monetizationMode === "pwyw") {
      if (typeof amountCents !== "number" || amountCents < 100) {
        return res.status(400).json({ error: "amount_required_min_100_cents" });
      }
      const minCents = event.pwywMinCents ?? 100;
      if (amountCents < minCents) {
        return res.status(400).json({ error: `amount_below_minimum_${minCents}` });
      }
      finalAmountCents = amountCents;
    } else {
      // donation
      if (typeof amountCents !== "number" || amountCents < 100) {
        return res.status(400).json({ error: "donation_min_100_cents" });
      }
      finalAmountCents = amountCents;
    }

    const lineItemName =
      type === "access"
        ? `Access: ${event.name}`
        : `Donation: ${event.name}`;

    // Bind the purchase to this viewer so access is granted automatically on
    // return (no code entry needed on the buying device): hashed device
    // cookie + account uid when signed in. The access code still works on
    // other devices.
    const viewerDevice = deviceKeyFor(getDeviceId(req, res));
    const viewer = await tryGetAuthUserAny(req).catch(() => null);

    // Return to the page the viewer bought from (channel or PPV page).
    const returnPath = safeReturnPath(req.body?.returnPath) || `/ppv/${encodeURIComponent(event.id)}`;
    const sep = returnPath.includes("?") ? "&" : "?";

    const CLIENT_URL = clientUrl();
    if (!CLIENT_URL) {
      console.error("[monetization] checkout refused: CLIENT_URL is not set");
      return res.status(500).json({ error: "server_misconfigured" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: event.currency || "usd",
            product_data: { name: lineItemName },
            unit_amount: finalAmountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        eventId: event.id,
        type,
        source: "streamline_monetization",
        viewerDevice,
        ...(viewer?.uid ? { viewerUid: viewer.uid } : {}),
      },
      success_url: `${CLIENT_URL}${returnPath}${sep}success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}${returnPath}${sep}canceled=1`,
    });

    recordTelemetry("checkout.started", {
      userId: viewer?.uid || null,
      roomId: typeof event.roomId === "string" ? event.roomId : null,
      metadata: { kind: "monetization", type, eventId: event.id, amountCents: finalAmountCents, currency: event.currency || "usd" },
    });
    return res.json({ ok: true, url: session.url });
  } catch (err: any) {
    console.error("[monetization] checkout error:", err?.message);
    recordTelemetry("checkout.failed", {
      metadata: { kind: "monetization", stage: "create_session", eventId: req.body?.eventId, error: err?.code || err?.message || "error" },
    });
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// GET /code?session_id=… – poll for raw access code after successful payment
// ---------------------------------------------------------------------------
router.get("/code", async (req: Request, res: Response) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "missing_session_id" });
    }
    // Single read: the pending code is deleted once handed to the buyer.
    const code = await retrieveAndDeleteRawCode(sessionId);
    if (!code) {
      return res.json({ ok: true, ready: false });
    }
    return res.json({ ok: true, ready: true, code });
  } catch (err: any) {
    console.error("[monetization] code poll error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// POST /redeem – redeem an access code
// ---------------------------------------------------------------------------
// The access code is how a buyer claims their ticket on another device: a
// successful claim attaches a ViewerEntitlement to this device (and to the
// signed-in account, if any). Single-person tickets move device access to
// the redeeming device.
router.post("/redeem", async (req: Request, res: Response) => {
  try {
    const { eventId, code } = req.body;
    if (!eventId || !code) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const event = await getMonetizedEvent(eventId);
    if (!event) return res.status(404).json({ error: "event_not_found" });

    const hash = hashAccessCode(String(code));
    const accessCode = await findAccessCodeByHash(eventId, hash);

    if (!accessCode) {
      return res.status(400).json({ error: "invalid_code" });
    }

    if (accessCode.status === "revoked") {
      return res.status(400).json({ error: "code_revoked" });
    }

    const purchase = await getPurchase(eventId, accessCode.purchaseId).catch(() => null);
    if (purchase && purchase.status !== "paid") {
      return res.status(400).json({ error: "code_revoked" });
    }

    const deviceId = getDeviceId(req, res);

    // Transaction-based claim to prevent race conditions
    const result = await claimAccessCode(eventId, accessCode.id, deviceId);
    if (!result.ok) {
      if (result.reason === "already_claimed" && event.singlePersonOnly) {
        return res.status(400).json({ error: "code_already_claimed" });
      }
      return res.status(400).json({ error: result.reason || "claim_failed" });
    }

    const viewer = await tryGetAuthUserAny(req).catch(() => null);
    let channelId: string | null = null;
    try {
      channelId = (await resolveRoomViewerAccess(event.roomId)).channelId;
    } catch {
      channelId = null;
    }
    const ids = await grantPpvEntitlement({
      eventId,
      roomId: event.roomId || null,
      channelId,
      purchaseId: accessCode.purchaseId,
      deviceKey: deviceKeyFor(deviceId),
      viewerUid: viewer?.uid || null,
      source: "access_code",
    });
    if (event.singlePersonOnly && ids[0]) {
      await revokeOtherDeviceEntitlements(accessCode.purchaseId, ids[0]).catch((e: any) =>
        console.warn("[monetization] single-person device transfer failed", e?.message)
      );
    }

    return res.json({ ok: true, entitled: true });
  } catch (err: any) {
    console.error("[monetization] redeem error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// POST /recover – guest ticket recovery by purchase email
// ---------------------------------------------------------------------------
// Always answers the same generic message (never reveals whether an email
// bought a ticket) and does the work after responding, so response timing
// doesn't leak it either. Matching paid tickets get a NEW code by email (the
// old code stops working).
const recoverIpLimiter = new SlidingWindowLimiter({ windowMs: 15 * 60_000, max: 10 });
const recoverEmailLimiter = new SlidingWindowLimiter({ windowMs: 60 * 60_000, max: 3 });
const RECOVER_MESSAGE = "If that email bought a ticket for this event, we've sent a new access code to it.";

router.post(
  "/recover",
  rateLimit([{ limiter: recoverIpLimiter, key: (req) => `ip:${clientIp(req)}` }]),
  async (req: Request, res: Response) => {
    const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!eventId || eventId.length > 128 || !isValidEmail(email)) {
      return res.status(400).json({ error: "invalid_request", reason: "Enter the email you used at checkout." });
    }
    res.json({ ok: true, message: RECOVER_MESSAGE });

    // Per-email throttle applied silently (same response either way).
    if (!recoverEmailLimiter.hit(`email:${email.toLowerCase()}:${eventId}`).allowed) return;
    try {
      await recoverTicketsByEmail(eventId, email);
    } catch (err: any) {
      console.warn("[monetization] recover failed", { eventId, error: err?.message });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /enter – gate check: can viewer watch? (PPV event page)
// ---------------------------------------------------------------------------
// Access = a live ViewerEntitlement for this event (device or account; legacy
// claimed codes count too). The playlist is never the raw public URL for a
// protected room: authorized viewers get a signed playback URL. New clients
// use POST /api/public/rooms/:roomId/playback, which also covers
// registered/private channels.
router.post("/enter", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.body;
    if (!eventId) return res.status(400).json({ error: "missing_event_id" });

    const event = await getMonetizedEvent(eventId);
    if (!event) return res.status(404).json({ error: "event_not_found" });

    const resolved = await resolveRoomViewerAccess(event.roomId).catch(() => null);
    const mode = resolved?.access.mode || "private";
    const hls = resolved?.room?.hls || {};
    const broadcast = broadcastStateFromHls(hls);
    const live = hls.status === "live" && !!String(hls.playlistUrl || "").trim();
    const effectiveStatus = effectiveEventStatus(event as any);
    const checkoutOpen = isCheckoutOpen(event as any);

    const isPaid = isPaidMode(event.monetizationMode);
    if (!isPaid && mode !== "pay_per_view") {
      // Donation / free event on an open room: same as before.
      const issued = live && mode === "public" ? issuePlayback({ roomId: event.roomId, hls, mode, entitlementId: null }) : null;
      return res.json({ ok: true, access: true, mode, effectiveStatus, checkoutOpen, playlistUrl: issued && issued.ok ? issued.playbackUrl : null });
    }

    const deviceId = getDeviceId(req, res);
    const viewer = await tryGetAuthUserAny(req).catch(() => null);
    let ent = await findActivePpvEntitlement(eventId, { deviceKey: deviceKeyFor(deviceId), uid: viewer?.uid || null });
    if (!ent) {
      // Pre-Stage-7 claimed codes: migrate into a device entitlement.
      const claimed = await findClaimedCodeForDevice(eventId, deviceId);
      const purchase = claimed ? await getPurchase(eventId, claimed.purchaseId).catch(() => null) : null;
      if (claimed && (!purchase || purchase.status === "paid")) {
        await grantPpvEntitlement({
          eventId,
          roomId: event.roomId || null,
          channelId: resolved?.channelId ?? null,
          purchaseId: claimed.purchaseId,
          deviceKey: deviceKeyFor(deviceId),
          source: "legacy_code",
        });
        ent = await findActivePpvEntitlement(eventId, { deviceKey: deviceKeyFor(deviceId) });
      }
    }
    if (!ent) {
      return res.json({ ok: true, access: false, mode, effectiveStatus, checkoutOpen, reason: "no_entitlement" });
    }

    // Ticket holder: playable only when THIS event's protected broadcast is live.
    const decision = decidePpvPlayback({
      isHost: false,
      event: event as any,
      eventInRoom: true,
      broadcast,
      hasTicket: true,
      salesOpen: true,
    });
    let playlistUrl: string | null = null;
    if (decision.kind === "play" && live) {
      const issued = issuePlayback({ roomId: event.roomId, hls, mode: "pay_per_view", entitlementId: ent.id });
      playlistUrl = issued.ok ? issued.playbackUrl : null;
    }
    return res.json({
      ok: true,
      access: true,
      mode,
      effectiveStatus,
      checkoutOpen,
      playlistUrl,
      waiting: decision.kind === "wait" ? decision.reason : undefined,
      blocked: decision.kind === "deny" ? decision.error : undefined,
    });
  } catch (err: any) {
    console.error("[monetization] enter error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// GET /earnings – creator earnings summary (data only; payouts not yet)
// ---------------------------------------------------------------------------
router.get("/earnings", requireAuth, async (req: Request, res: Response) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    const rows = await listLedgerForCreator(uid);
    return res.json({
      ok: true,
      platformFeeBps: getPlatformFeeBps(),
      totals: summarizeEarnings(rows),
      recent: rows.slice(0, 20).map((r) => ({
        id: r.id,
        eventId: r.eventId,
        channelId: r.channelId,
        type: r.type,
        grossCents: r.grossCents,
        platformFeeCents: r.platformFeeCents,
        netCents: r.netCents,
        refundedCents: r.refundedCents || 0,
        currency: r.currency,
        status: r.status,
        createdAt: r.createdAt,
      })),
      // Manual payouts: PPV_PAYOUT_NOTE tells creators how/when they're paid
      // (shown on the Monetization page before they sell tickets).
      payouts: { available: false, message: String(process.env.PPV_PAYOUT_NOTE || "").trim() || "Payouts coming soon." },
    });
  } catch (err: any) {
    console.error("[monetization] earnings error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ── HLS-enabled rooms for the room picker ──────────────────────────
// GET /api/monetization/hls-rooms — returns rooms owned by the user that have HLS enabled
router.get("/hls-rooms", requireAuth, async (req: Request, res: Response) => {
  try {
    const uid = (req as any).user?.uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const snap = await db.collection("rooms").where("ownerId", "==", uid).get();
    const hlsRooms = snap.docs
      .map((d) => {
        const data = d.data() || {};
        const isHls =
          data.roomType === "hls" || data.hlsConfig?.enabled === true;
        if (!isHls) return null;
        return {
          id: d.id,
          roomType: data.roomType || null,
          status: data.status || "idle",
          hlsEnabled: true,
          name: data.name || data.livekitRoomName || d.id,
        };
      })
      .filter(Boolean);

    return res.json({ ok: true, rooms: hlsRooms });
  } catch (err: any) {
    console.error("[monetization] hls-rooms error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
