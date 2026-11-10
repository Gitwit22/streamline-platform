/**
 * Guest PPV access-code delivery: a small, retry-safe email outbox.
 *
 *   ppvCodeEmails/{deliveryKey}
 *     eventId, purchaseId, kind ("purchase" | "recovery"), to,
 *     sealed (AES-GCM raw code, deleted once sent/failed), status
 *     ("pending" | "sent" | "failed"), attempts, lastError, nextAttemptAt,
 *     createdAt, sentAt, ttlAt
 *
 * - The doc id is the delivery key and doubles as Resend's Idempotency-Key,
 *   so a webhook redelivery, the retry job and a concurrent attempt can't
 *   send the same email twice.
 * - The raw code only exists encrypted (STREAM_KEY_SECRET_V1) and only until
 *   the email is sent; it is never logged.
 * - Recovery never resends an old code: it rotates the purchase's access
 *   code (old code stops working) and emails the new one.
 */
import { FieldValue } from "firebase-admin/firestore";
import { firestore as db } from "../firebaseAdmin";
import { sealPendingCode, openPendingCode } from "./monetizationSecrets";
import { sendTransactionalEmail, maskEmail } from "./transactionalEmail";
import {
  buildAccessCodeEmail,
  CODE_EMAIL_MAX_ATTEMPTS,
  isValidEmail,
  nextAttemptDelayMs,
} from "./ppvCodeEmailPure";
import {
  accessCodeRef,
  findPaidAccessPurchasesByEmail,
  generateAccessCode,
  getMonetizedEvent,
  hashAccessCode,
} from "./monetization";
import { effectiveEventStatus } from "./ppvLifecyclePure";
import { ppvWatchUrl } from "../events/emitters/commerceEmitter";

const COLLECTION = "ppvCodeEmails";
const OUTBOX_TTL_MS = 30 * 24 * 60 * 60_000;
const DISABLED_RECHECK_MS = 15 * 60_000;

function col() {
  return db.collection(COLLECTION);
}

function isAlreadyExists(err: any): boolean {
  return err?.code === 6 || err?.code === "already-exists" || /ALREADY_EXISTS/i.test(String(err?.message || ""));
}

export async function enqueueCodeEmail(input: {
  deliveryKey: string;
  eventId: string;
  purchaseId: string;
  kind: "purchase" | "recovery";
  to: string;
  code: string;
}): Promise<{ created: boolean }> {
  const now = Date.now();
  try {
    await col().doc(input.deliveryKey).create({
      eventId: input.eventId,
      purchaseId: input.purchaseId,
      kind: input.kind,
      to: input.to.trim(),
      sealed: sealPendingCode(input.code),
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: now,
      createdAt: now,
      sentAt: null,
      ttlAt: new Date(now + OUTBOX_TTL_MS),
    });
    return { created: true };
  } catch (err: any) {
    if (isAlreadyExists(err)) return { created: false };
    throw err;
  }
}

export async function discardCodeEmail(deliveryKey: string): Promise<void> {
  await col().doc(deliveryKey).delete().catch(() => undefined);
}

/** One send attempt. Never throws; returns the resulting status. */
export async function attemptCodeEmail(deliveryKey: string): Promise<"sent" | "pending" | "failed" | "skipped"> {
  const ref = col().doc(deliveryKey);
  try {
    const snap = await ref.get();
    if (!snap.exists) return "skipped";
    const d = snap.data() as any;
    if (d.status !== "pending") return "skipped";

    const code = openPendingCode(d.sealed);
    if (!code) {
      await ref.set({ status: "failed", lastError: "code_unavailable", sealed: FieldValue.delete() }, { merge: true });
      return "failed";
    }
    const ev = await getMonetizedEvent(String(d.eventId));
    const msg = buildAccessCodeEmail({
      eventName: ev?.name || "your event",
      code,
      watchUrl: ppvWatchUrl(String(d.eventId)),
      kind: d.kind === "recovery" ? "recovery" : "purchase",
    });
    const result = await sendTransactionalEmail({
      to: String(d.to),
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      idempotencyKey: deliveryKey,
      tag: `ppv_code_${d.kind}`,
    });

    if (result.ok === true) {
      await ref.set(
        { status: "sent", sentAt: Date.now(), lastError: null, providerId: result.id, sealed: FieldValue.delete() },
        { merge: true }
      );
      return "sent";
    }
    const failure = result as { ok: false; retryable: boolean; error: string };
    if (failure.error === "email_disabled") {
      // Not an attempt: delivered once email is configured.
      await ref.set({ lastError: "email_disabled", nextAttemptAt: Date.now() + DISABLED_RECHECK_MS }, { merge: true });
      return "pending";
    }
    const attempts = Number(d.attempts || 0) + 1;
    if (failure.retryable && attempts < CODE_EMAIL_MAX_ATTEMPTS) {
      await ref.set(
        { attempts, lastError: failure.error, nextAttemptAt: Date.now() + nextAttemptDelayMs(attempts) },
        { merge: true }
      );
      return "pending";
    }
    await ref.set({ status: "failed", attempts, lastError: failure.error, sealed: FieldValue.delete() }, { merge: true });
    console.warn("[ppv-code-email] giving up", { deliveryKey, to: maskEmail(String(d.to)), error: failure.error });
    return "failed";
  } catch (err: any) {
    console.warn("[ppv-code-email] attempt error", { deliveryKey, error: err?.message || err });
    return "pending";
  }
}

/** Retry job body: due pending deliveries (single-field query, filtered in memory). */
export async function retryDueCodeEmails(nowMs: number, max = 100): Promise<{ attempted: number; sent: number; failed: number }> {
  const snap = await col().where("status", "==", "pending").limit(max).get();
  let attempted = 0;
  let sent = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    const next = Number((doc.data() as any).nextAttemptAt || 0);
    if (next > nowMs) continue;
    attempted += 1;
    const r = await attemptCodeEmail(doc.id);
    if (r === "sent") sent += 1;
    if (r === "failed") failed += 1;
  }
  return { attempted, sent, failed };
}

/**
 * Guest ticket recovery: for every paid ticket bought with `email` for this
 * event, rotate the access code and email the new one. Returns how many were
 * queued (for logs only — the HTTP response must not reveal it).
 */
export async function recoverTicketsByEmail(eventId: string, email: string): Promise<number> {
  if (!isValidEmail(email)) return 0;
  const ev = await getMonetizedEvent(eventId);
  if (!ev || effectiveEventStatus(ev as any) === "ended") return 0;
  const purchases = await findPaidAccessPurchasesByEmail(eventId, email);
  let queued = 0;
  for (const p of purchases) {
    const code = generateAccessCode();
    // Rotate: the old code stops working; "issued" lets the new code be
    // claimed (single-person tickets then move to the redeeming device).
    await accessCodeRef(eventId, p.id).set(
      {
        id: p.id,
        eventId,
        purchaseId: p.id,
        codeHash: hashAccessCode(code),
        status: "issued",
        claimedAt: null,
        claimedDeviceId: null,
        rotatedAt: Date.now(),
      },
      { merge: true }
    );
    const deliveryKey = `recovery_${p.id}_${Date.now()}`;
    await enqueueCodeEmail({ deliveryKey, eventId, purchaseId: p.id, kind: "recovery", to: p.payerEmail || email, code });
    await attemptCodeEmail(deliveryKey);
    queued += 1;
  }
  return queued;
}
