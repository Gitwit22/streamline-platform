/**
 * Monetization v1 — Data Model & Firestore Helpers
 *
 * Objects:
 *   MonetizedEvent  – attached to an HLS room
 *   Purchase        – Stripe Checkout result (access or donation)
 *   AccessCode      – single-use code for paid-entry purchases
 *
 * All writes use the top-level Firestore collections:
 *   monetizedEvents/{eventId}
 *   monetizedEvents/{eventId}/purchases/{purchaseId}
 *   monetizedEvents/{eventId}/accessCodes/{codeId}
 */

import crypto from "crypto";
import { firestore as db } from "../firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MonetizationMode = "off" | "fixed" | "pwyw" | "donation";
export type EventStatus = "draft" | "live" | "ended";
export type PurchaseType = "access" | "donation";
export type PurchaseStatus = "paid" | "refunded" | "disputed";
export type AccessCodeStatus = "issued" | "claimed" | "revoked";

export interface MonetizedEvent {
  id: string;
  roomId: string;
  ownerUid: string;
  name: string;
  startsAt: string | null; // ISO-8601
  monetizationMode: MonetizationMode;
  currency: string;
  fixedAmountCents: number | null;
  pwywMinCents: number | null;
  donationPresetsCents: number[];
  allowCustomDonation: boolean;
  singlePersonOnly: boolean;
  status: EventStatus;
  // HLS enforcement fields — PPV events require HLS delivery
  requiresHls: boolean;
  deliveryMode: "hls";
  hlsEnabledAtCreation: boolean;
  monetizationType: "pay_per_view" | "donation" | "off";
  createdAt: FirebaseFirestore.Timestamp | FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FieldValue;
}

export interface Purchase {
  id: string;
  eventId: string;
  type: PurchaseType;
  amountCents: number;
  currency: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  payerEmail: string | null;
  status: PurchaseStatus;
  createdAt: FirebaseFirestore.Timestamp | FieldValue;
}

export interface AccessCode {
  id: string;
  eventId: string;
  purchaseId: string;
  codeHash: string;
  status: AccessCodeStatus;
  claimedAt: FirebaseFirestore.Timestamp | FieldValue | null;
  claimedDeviceId: string | null;
  createdAt: FirebaseFirestore.Timestamp | FieldValue;
}

// ---------------------------------------------------------------------------
// Collection helpers
// ---------------------------------------------------------------------------

function eventsCol() {
  return db.collection("monetizedEvents");
}

function purchasesCol(eventId: string) {
  return eventsCol().doc(eventId).collection("purchases");
}

function accessCodesCol(eventId: string) {
  return eventsCol().doc(eventId).collection("accessCodes");
}

// ---------------------------------------------------------------------------
// Access-code generation & hashing
// ---------------------------------------------------------------------------

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0,O,1,I
const CODE_LENGTH = 12;

function getCodeSalt(): string {
  return process.env.MONETIZATION_CODE_SALT || "streamline-monetization-salt";
}

export function generateAccessCode(): string {
  // Use rejection sampling to avoid modulo bias.
  // CODE_CHARS has 30 characters; largest multiple of 30 ≤ 255 is 240.
  const maxValid = Math.floor(256 / CODE_CHARS.length) * CODE_CHARS.length;
  let code = "";
  while (code.length < CODE_LENGTH) {
    const bytes = crypto.randomBytes(CODE_LENGTH * 2); // over-provision
    for (let i = 0; i < bytes.length && code.length < CODE_LENGTH; i++) {
      if (bytes[i] < maxValid) {
        code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
      }
    }
  }
  return code;
}

export function hashAccessCode(rawCode: string): string {
  return crypto
    .createHmac("sha256", getCodeSalt())
    .update(rawCode.toUpperCase().trim())
    .digest("hex");
}

// ---------------------------------------------------------------------------
// CRUD — MonetizedEvent
// ---------------------------------------------------------------------------

export interface CreateEventInput {
  roomId: string;
  ownerUid: string;
  name: string;
  startsAt?: string | null;
  monetizationMode: MonetizationMode;
  currency?: string;
  fixedAmountCents?: number | null;
  pwywMinCents?: number | null;
  donationPresetsCents?: number[];
  allowCustomDonation?: boolean;
  singlePersonOnly?: boolean;
}

export async function createMonetizedEvent(
  input: CreateEventInput
): Promise<MonetizedEvent> {
  const ref = eventsCol().doc(); // auto-id
  const now = FieldValue.serverTimestamp();

  const isPaid = input.monetizationMode === "fixed" || input.monetizationMode === "pwyw";

  const monetizationType: MonetizedEvent["monetizationType"] =
    isPaid ? "pay_per_view" : input.monetizationMode === "donation" ? "donation" : "off";

  const event: MonetizedEvent = {
    id: ref.id,
    roomId: input.roomId,
    ownerUid: input.ownerUid,
    name: input.name,
    startsAt: input.startsAt ?? null,
    monetizationMode: input.monetizationMode,
    currency: input.currency || "usd",
    fixedAmountCents: input.fixedAmountCents ?? null,
    pwywMinCents: input.pwywMinCents ?? (input.monetizationMode === "pwyw" ? 100 : null),
    donationPresetsCents: input.donationPresetsCents ?? [500, 1000, 2000],
    allowCustomDonation: input.allowCustomDonation ?? true,
    singlePersonOnly: input.singlePersonOnly ?? isPaid,
    status: "draft",
    requiresHls: true,
    deliveryMode: "hls",
    hlsEnabledAtCreation: true,
    monetizationType,
    createdAt: now,
    updatedAt: now,
  };

  await ref.set(event);
  return event;
}

export async function updateMonetizedEvent(
  eventId: string,
  patch: Partial<Omit<MonetizedEvent, "id" | "createdAt">>
): Promise<void> {
  await eventsCol()
    .doc(eventId)
    .update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
}

export async function getMonetizedEvent(
  eventId: string
): Promise<MonetizedEvent | null> {
  const snap = await eventsCol().doc(eventId).get();
  if (!snap.exists) return null;
  return snap.data() as MonetizedEvent;
}

export async function listMonetizedEventsByOwner(
  ownerUid: string
): Promise<MonetizedEvent[]> {
  const snap = await eventsCol()
    .where("ownerUid", "==", ownerUid)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();
  return snap.docs.map((d) => d.data() as MonetizedEvent);
}

export async function listMonetizedEventsByRoom(
  roomId: string
): Promise<MonetizedEvent[]> {
  const snap = await eventsCol()
    .where("roomId", "==", roomId)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();
  return snap.docs.map((d) => d.data() as MonetizedEvent);
}

// ---------------------------------------------------------------------------
// CRUD — Purchase
// ---------------------------------------------------------------------------

export interface CreatePurchaseInput {
  eventId: string;
  type: PurchaseType;
  amountCents: number;
  currency: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string | null;
  payerEmail?: string | null;
}

export async function createPurchase(
  input: CreatePurchaseInput
): Promise<Purchase> {
  const ref = purchasesCol(input.eventId).doc();
  const purchase: Purchase = {
    id: ref.id,
    eventId: input.eventId,
    type: input.type,
    amountCents: input.amountCents,
    currency: input.currency,
    stripeCheckoutSessionId: input.stripeCheckoutSessionId,
    stripePaymentIntentId: input.stripePaymentIntentId ?? null,
    payerEmail: input.payerEmail ?? null,
    status: "paid",
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(purchase);
  return purchase;
}

export async function getPurchaseBySessionId(
  eventId: string,
  sessionId: string
): Promise<Purchase | null> {
  const snap = await purchasesCol(eventId)
    .where("stripeCheckoutSessionId", "==", sessionId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data() as Purchase;
}

// ---------------------------------------------------------------------------
// CRUD — AccessCode
// ---------------------------------------------------------------------------

export interface CreateAccessCodeInput {
  eventId: string;
  purchaseId: string;
  codeHash: string;
}

export async function createAccessCode(
  input: CreateAccessCodeInput
): Promise<AccessCode> {
  const ref = accessCodesCol(input.eventId).doc();
  const code: AccessCode = {
    id: ref.id,
    eventId: input.eventId,
    purchaseId: input.purchaseId,
    codeHash: input.codeHash,
    status: "issued",
    claimedAt: null,
    claimedDeviceId: null,
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(code);
  return code;
}

export async function findAccessCodeByHash(
  eventId: string,
  codeHash: string
): Promise<AccessCode | null> {
  const snap = await accessCodesCol(eventId)
    .where("codeHash", "==", codeHash)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data() as AccessCode;
}

export async function claimAccessCode(
  eventId: string,
  codeId: string,
  deviceId: string
): Promise<{ ok: boolean; reason?: string }> {
  const ref = accessCodesCol(eventId).doc(codeId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "not_found" };
    const data = snap.data() as AccessCode;
    if (data.status === "claimed") {
      // Allow re-entry from the same device
      if (data.claimedDeviceId === deviceId) return { ok: true };
      return { ok: false, reason: "already_claimed" };
    }
    if (data.status === "revoked") return { ok: false, reason: "revoked" };
    tx.update(ref, {
      status: "claimed",
      claimedAt: FieldValue.serverTimestamp(),
      claimedDeviceId: deviceId,
    });
    return { ok: true };
  });
}

export async function findClaimedCodeForDevice(
  eventId: string,
  deviceId: string
): Promise<AccessCode | null> {
  const snap = await accessCodesCol(eventId)
    .where("status", "==", "claimed")
    .where("claimedDeviceId", "==", deviceId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data() as AccessCode;
}

// ---------------------------------------------------------------------------
// Temporary raw-code store (short TTL, keyed by checkoutSessionId)
// ---------------------------------------------------------------------------
// In-memory cache — safe because codes are transient and the webhook +
// success-page poll happen within seconds on the same server instance.
// For multi-instance deployments, replace with Redis/Firestore TTL doc.

const rawCodeCache = new Map<string, { code: string; expiresAt: number }>();
const RAW_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function storeRawCode(checkoutSessionId: string, rawCode: string) {
  rawCodeCache.set(checkoutSessionId, {
    code: rawCode,
    expiresAt: Date.now() + RAW_CODE_TTL_MS,
  });
}

export function retrieveAndDeleteRawCode(
  checkoutSessionId: string
): string | null {
  const entry = rawCodeCache.get(checkoutSessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    rawCodeCache.delete(checkoutSessionId);
    return null;
  }
  rawCodeCache.delete(checkoutSessionId);
  return entry.code;
}

/** Peek without deleting (for polling before the viewer is ready to consume). */
export function peekRawCode(checkoutSessionId: string): string | null {
  const entry = rawCodeCache.get(checkoutSessionId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    rawCodeCache.delete(checkoutSessionId);
    return null;
  }
  return entry.code;
}
