/**
 * Commerce event emitter (pay-per-view lifecycle + tickets + account).
 *
 * Delivered to STREAMLINE_COMMERCE_EVENT_URL (n8n "StreamLine — Commerce &
 * Lifecycle Emails"). Payload contracts are shared with that workflow; keep
 * field names stable.
 *
 * Rules:
 *  - NEVER include access codes, tokens, payment secrets or device ids.
 *  - Ids are deterministic per business fact so a Stripe webhook redelivery
 *    that re-emits the same fact carries the same `id` (receiver dedupes).
 */
import { emitEvent } from "../eventBus";
import { EventTypes, createEventPayload } from "../eventTypes";

function clientUrl(): string {
  return String(process.env.CLIENT_URL || "").trim().replace(/\/+$/, "");
}

/** Public watch link for a PPV event (null when CLIENT_URL is unset). */
export function ppvWatchUrl(eventId: string): string | null {
  const base = clientUrl();
  return base ? `${base}/ppv/${encodeURIComponent(eventId)}` : null;
}

/** Optional creator-facing payout note (manual payouts); empty → omitted. */
function payoutNote(): string | null {
  const v = String(process.env.PPV_PAYOUT_NOTE || "").trim();
  return v || null;
}

export type CreatorContact = { uid: string; email: string | null; name: string | null };

type EventRef = { id: string; name: string; roomId: string | null; startsAt?: string | null };

export function emitPpvEventScheduled(ev: EventRef, creator: CreatorContact): void {
  emitEvent(
    createEventPayload(EventTypes.PPV_EVENT_SCHEDULED, {
      id: `ppv.event.scheduled:${ev.id}`,
      roomId: ev.roomId,
      entityId: ev.id,
      data: {
        eventId: ev.id,
        eventName: ev.name,
        startsAt: ev.startsAt ?? null,
        watchUrl: ppvWatchUrl(ev.id),
        creatorName: creator.name,
        creatorEmail: creator.email,
      },
    })
  );
}

export function emitPpvEventStarted(ev: EventRef, creator: CreatorContact, startedAtMs: number): void {
  emitEvent(
    createEventPayload(EventTypes.PPV_EVENT_STARTED, {
      id: `ppv.event.started:${ev.id}:${startedAtMs}`,
      roomId: ev.roomId,
      entityId: ev.id,
      data: {
        eventId: ev.id,
        eventName: ev.name,
        watchUrl: ppvWatchUrl(ev.id),
        creatorName: creator.name,
        creatorEmail: creator.email,
      },
    })
  );
}

export function emitPpvEventEnded(
  ev: EventRef,
  creator: CreatorContact,
  summary: { ticketsSold: number; grossCents: number; currency: string }
): void {
  emitEvent(
    createEventPayload(EventTypes.PPV_EVENT_ENDED, {
      id: `ppv.event.ended:${ev.id}`,
      roomId: ev.roomId,
      entityId: ev.id,
      data: {
        eventId: ev.id,
        eventName: ev.name,
        ticketsSold: summary.ticketsSold,
        grossCents: summary.grossCents,
        currency: summary.currency,
        creatorName: creator.name,
        creatorEmail: creator.email,
        payoutNote: payoutNote(),
      },
    })
  );
}

export function emitPpvTicketPurchased(input: {
  ev: EventRef;
  creator: CreatorContact;
  purchaseId: string;
  amountCents: number;
  currency: string;
  buyerEmail: string | null;
  buyerIsGuest: boolean;
}): void {
  emitEvent(
    createEventPayload(EventTypes.PPV_TICKET_PURCHASED, {
      id: `ppv.ticket.purchased:${input.purchaseId}`,
      roomId: input.ev.roomId,
      entityId: input.purchaseId,
      data: {
        eventId: input.ev.id,
        eventName: input.ev.name,
        startsAt: input.ev.startsAt ?? null,
        purchaseId: input.purchaseId,
        amountCents: input.amountCents,
        currency: input.currency,
        buyerEmail: input.buyerEmail,
        buyerIsGuest: input.buyerIsGuest,
        watchUrl: ppvWatchUrl(input.ev.id),
        creatorName: input.creator.name,
        creatorEmail: input.creator.email,
      },
    })
  );
}

export function emitPpvTicketRefunded(input: {
  ev: EventRef;
  creator: CreatorContact;
  purchaseId: string;
  amountCents: number;
  currency: string;
  buyerEmail: string | null;
  reason: "refund" | "dispute";
}): void {
  emitEvent(
    createEventPayload(EventTypes.PPV_TICKET_REFUNDED, {
      id: `ppv.ticket.refunded:${input.purchaseId}:${input.reason}`,
      roomId: input.ev.roomId,
      entityId: input.purchaseId,
      data: {
        eventId: input.ev.id,
        eventName: input.ev.name,
        purchaseId: input.purchaseId,
        amountCents: input.amountCents,
        currency: input.currency,
        buyerEmail: input.buyerEmail,
        reason: input.reason,
        creatorName: input.creator.name,
        creatorEmail: input.creator.email,
      },
    })
  );
}

export function emitPpvPaymentAfterEnd(input: {
  ev: EventRef;
  purchaseId: string;
  amountCents: number;
  currency: string;
  buyerEmail: string | null;
  stripePaymentIntentId: string | null;
}): void {
  emitEvent(
    createEventPayload(EventTypes.PPV_PAYMENT_AFTER_END, {
      id: `ppv.payment.after_end:${input.purchaseId}`,
      roomId: input.ev.roomId,
      entityId: input.purchaseId,
      data: {
        eventId: input.ev.id,
        eventName: input.ev.name,
        purchaseId: input.purchaseId,
        amountCents: input.amountCents,
        currency: input.currency,
        buyerEmail: input.buyerEmail,
        stripePaymentIntentId: input.stripePaymentIntentId,
      },
    })
  );
}

export function emitAccountCreated(input: { uid: string; email: string; displayName: string | null }): void {
  emitEvent(
    createEventPayload(EventTypes.ACCOUNT_CREATED, {
      id: `account.created:${input.uid}`,
      entityId: input.uid,
      data: {
        email: input.email,
        displayName: input.displayName,
        appUrl: clientUrl() || null,
      },
    })
  );
}
