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
import {
  getCodeSalt,
  sealPendingCode,
  openPendingCode,
  isPendingCodeExpired,
  PENDING_CODE_TTL_MS,
} from "./monetizationSecrets";

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

/**
 * True when the room has a non-ended event that requires payment (fixed/PWYW).
 * Used to keep the HLS playlist URL off public endpoints for paywalled rooms.
 * Single-field query so it doesn't depend on a composite index.
 */
export async function roomHasActivePaidEvent(roomId: string): Promise<boolean> {
  const snap = await eventsCol().where("roomId", "==", roomId).get();
  return snap.docs.some((d) => isActivePaidEvent(d.data() as MonetizedEvent));
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

function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || err?.code === "already-exists" || /ALREADY_EXISTS/i.test(String(err?.message || ""));
}

/**
 * Idempotent per Stripe checkout session: the purchase doc id is the session
 * id, so a redelivered webhook returns the existing purchase (created=false)
 * instead of recording a second one.
 */
export async function createPurchase(
  input: CreatePurchaseInput
): Promise<Purchase & { created: boolean }> {
  const ref = input.stripeCheckoutSessionId
    ? purchasesCol(input.eventId).doc(input.stripeCheckoutSessionId)
    : purchasesCol(input.eventId).doc();
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
  try {
    await ref.create(purchase);
  } catch (err: any) {
    if (!isAlreadyExists(err)) throw err;
    const existing = await ref.get();
    return { ...(existing.data() as Purchase), created: false };
  }
  return { ...purchase, created: true };
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

/**
 * One access code per purchase (doc id = purchaseId). Returns null when a code
 * was already issued for this purchase (e.g. a redelivered webhook).
 */
export async function createAccessCode(
  input: CreateAccessCodeInput
): Promise<AccessCode | null> {
  const ref = accessCodesCol(input.eventId).doc(input.purchaseId);
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
  try {
    await ref.create(code);
  } catch (err: any) {
    if (isAlreadyExists(err)) return null;
    throw err;
  }
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
// Pending raw-code store (short TTL, keyed by checkoutSessionId)
// ---------------------------------------------------------------------------
// Persisted in Firestore (monetizationPendingCodes/{checkoutSessionId}) so it
// survives restarts and works across instances. The raw code is encrypted
// with AES-256-GCM (lib/crypto.ts); only its HMAC lives on the access code.

function pendingCodesCol() {
  return db.collection("monetizationPendingCodes");
}

/**
 * Stash the raw code for this checkout session and return the code that is
 * actually stored. Call this BEFORE createAccessCode: if a previous delivery
 * already stashed a (still valid) code, that code is returned and reused so a
 * retried webhook never hashes a code different from the one the buyer gets.
 */
export async function storeRawCode(
  checkoutSessionId: string,
  rawCode: string
): Promise<{ code: string; created: boolean }> {
  const ref = pendingCodesCol().doc(checkoutSessionId);
  const now = Date.now();
  const doc = {
    sealed: sealPendingCode(rawCode),
    createdAt: now,
    expiresAt: now + PENDING_CODE_TTL_MS,
    // Date field so a Firestore TTL policy can purge abandoned docs.
    ttlAt: new Date(now + PENDING_CODE_TTL_MS),
  };
  try {
    await ref.create(doc);
    return { code: rawCode, created: true };
  } catch (err: any) {
    if (!isAlreadyExists(err)) throw err;
  }
  const existing = await readPendingCode(checkoutSessionId);
  if (existing) return { code: existing.code, created: false };
  await ref.set(doc);
  return { code: rawCode, created: true };
}

export async function deleteRawCode(checkoutSessionId: string): Promise<void> {
  await pendingCodesCol().doc(checkoutSessionId).delete();
}

async function readPendingCode(
  checkoutSessionId: string
): Promise<{ ref: FirebaseFirestore.DocumentReference; code: string } | null> {
  const ref = pendingCodesCol().doc(checkoutSessionId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  if (isPendingCodeExpired(data?.expiresAt)) {
    await ref.delete().catch(() => {});
    return null;
  }
  const code = openPendingCode(data?.sealed);
  if (!code) return null;
  return { ref, code };
}

export async function retrieveAndDeleteRawCode(
  checkoutSessionId: string
): Promise<string | null> {
  const entry = await readPendingCode(checkoutSessionId);
  if (!entry) return null;
  await entry.ref.delete();
  return entry.code;
}

/** Peek without deleting (for polling before the viewer is ready to consume). */
export async function peekRawCode(checkoutSessionId: string): Promise<string | null> {
  const entry = await readPendingCode(checkoutSessionId);
  return entry ? entry.code : null;
}

// ---------------------------------------------------------------------------
// Stage 7 helpers (viewer access / refunds)
// ---------------------------------------------------------------------------

export function isActivePaidEvent(e: MonetizedEvent | null | undefined): boolean {
  if (!e) return false;
  const paid = e.monetizationMode === "fixed" || e.monetizationMode === "pwyw";
  return paid && e.status !== "ended";
}

function createdAtMs(e: MonetizedEvent): number {
  const c: any = e.createdAt;
  if (c && typeof c.toMillis === "function") return c.toMillis();
  return 0;
}

/**
 * Non-ended fixed/PWYW events for a room, newest first. Single-field query
 * (no composite index).
 */
export async function listActivePaidEvents(roomId: string): Promise<MonetizedEvent[]> {
  if (!roomId) return [];
  const snap = await eventsCol().where("roomId", "==", roomId).get();
  return snap.docs
    .map((d) => d.data() as MonetizedEvent)
    .filter(isActivePaidEvent)
    .sort((a, b) => createdAtMs(b) - createdAtMs(a));
}

export async function setPurchaseStatus(
  eventId: string,
  purchaseId: string,
  status: PurchaseStatus
): Promise<void> {
  await purchasesCol(eventId)
    .doc(purchaseId)
    .set({ status, statusUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function getPurchase(eventId: string, purchaseId: string): Promise<Purchase | null> {
  const snap = await purchasesCol(eventId).doc(purchaseId).get();
  return snap.exists ? (snap.data() as Purchase) : null;
}

/** Access codes are keyed by purchaseId (see createAccessCode). */
export async function revokeAccessCodeForPurchase(eventId: string, purchaseId: string): Promise<void> {
  const ref = accessCodesCol(eventId).doc(purchaseId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set({ status: "revoked", revokedAt: FieldValue.serverTimestamp() }, { merge: true });
}
