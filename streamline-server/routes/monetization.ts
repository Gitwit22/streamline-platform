/**
 * Monetization v1 — API Routes
 *
 * POST   /api/monetization/events          – create/update MonetizedEvent
 * GET    /api/monetization/events           – list events for authenticated host
 * GET    /api/monetization/events/:eventId  – get single event (public)
 * POST   /api/monetization/checkout         – create Stripe Checkout session
 * GET    /api/monetization/code             – poll for raw access code after success
 * POST   /api/monetization/redeem           – redeem access code
 * POST   /api/monetization/enter            – gate check (can viewer watch?)
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { stripe } from "../lib/stripe";
import { requireAuth } from "../middleware/requireAuth";
import { canAccessFeature } from "./featureAccess";
import { firestore as db } from "../firebaseAdmin";
import {
  createMonetizedEvent,
  updateMonetizedEvent,
  getMonetizedEvent,
  listMonetizedEventsByOwner,
  hashAccessCode,
  findAccessCodeByHash,
  claimAccessCode,
  findClaimedCodeForDevice,
  peekRawCode,
  type MonetizationMode,
  type CreateEventInput,
} from "../lib/monetization";

const router = Router();

const CLIENT_URL =
  (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function getDeviceId(req: Request, res: Response): string {
  let deviceId = req.cookies?.sl_device_id;
  if (!deviceId || typeof deviceId !== "string") {
    deviceId = crypto.randomUUID();
    res.cookie("sl_device_id", deviceId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === "production",
    });
  }
  return deviceId;
}

const VALID_MODES: MonetizationMode[] = ["off", "fixed", "pwyw", "donation"];

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
      if (status !== undefined) patch.status = status;

      await updateMonetizedEvent(eventId, patch);
      const updated = await getMonetizedEvent(eventId);
      return res.json({ ok: true, event: updated });
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

    const event = await createMonetizedEvent(input);
    return res.status(201).json({ ok: true, event });
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
    return res.json({ ok: true, events });
  } catch (err: any) {
    console.error("[monetization] list events error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// GET /events/:eventId – public event details (for viewer page)
// ---------------------------------------------------------------------------
router.get("/events/:eventId", async (req: Request, res: Response) => {
  try {
    const event = await getMonetizedEvent(req.params.eventId);
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
      },
      success_url: `${CLIENT_URL}/ppv/${event.id}?success=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/ppv/${event.id}?canceled=1`,
    });

    return res.json({ ok: true, url: session.url });
  } catch (err: any) {
    console.error("[monetization] checkout error:", err?.message);
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
    const code = peekRawCode(sessionId);
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

    const deviceId = getDeviceId(req, res);

    // Transaction-based claim to prevent race conditions
    const result = await claimAccessCode(eventId, accessCode.id, deviceId);
    if (!result.ok) {
      if (result.reason === "already_claimed" && event.singlePersonOnly) {
        return res.status(400).json({ error: "code_already_claimed" });
      }
      return res.status(400).json({ error: result.reason || "claim_failed" });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[monetization] redeem error:", err?.message);
    return res.status(500).json({ error: "internal_error" });
  }
});

// ---------------------------------------------------------------------------
// POST /enter – gate check: can viewer watch?
// ---------------------------------------------------------------------------
router.post("/enter", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.body;
    if (!eventId) return res.status(400).json({ error: "missing_event_id" });

    const event = await getMonetizedEvent(eventId);
    if (!event) return res.status(404).json({ error: "event_not_found" });

    // Donation mode: always ok
    if (event.monetizationMode === "donation" || event.monetizationMode === "off") {
      return res.json({ ok: true, access: true });
    }

    // Paid modes: check device cookie
    const deviceId = getDeviceId(req, res);
    const claimed = await findClaimedCodeForDevice(eventId, deviceId);
    if (!claimed) {
      return res.json({ ok: true, access: false, reason: "no_claimed_code" });
    }

    return res.json({ ok: true, access: true });
  } catch (err: any) {
    console.error("[monetization] enter error:", err?.message);
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
