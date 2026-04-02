import { Router } from "express";
import crypto from "node:crypto";
import admin from "firebase-admin";
import { firestore } from "../firebaseAdmin";
import { tryGetAuthUserAny } from "../middleware/requireAuth";

const router = Router();

const SUBJECT_MIN = 3;
const SUBJECT_MAX = 180;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;
const EMAIL_MAX = 254;
const RATE_LIMIT_WINDOW_MS = 60_000;

const ALLOWED_CATEGORIES = new Set([
  "general",
  "billing",
  "streaming",
  "technical",
  "account",
  "feature_request",
]);

const ALLOWED_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

function cleanText(value: any, max: number): string {
  return String(value || "").trim().slice(0, max);
}

function normalizeEmail(value: any): string {
  return cleanText(value, EMAIL_MAX).toLowerCase();
}

function isValidEmail(email: string): boolean {
  if (!email) return false;
  if (email.length > EMAIL_MAX) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeCategory(value: any): string {
  const raw = cleanText(value, 40).toLowerCase().replace(/\s+/g, "_");
  return ALLOWED_CATEGORIES.has(raw) ? raw : "general";
}

function normalizePriority(value: any): string {
  const raw = cleanText(value, 20).toLowerCase();
  return ALLOWED_PRIORITIES.has(raw) ? raw : "normal";
}

function getIp(req: any): string {
  const forwarded = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return String(req.ip || req.socket?.remoteAddress || "unknown").trim() || "unknown";
}

function hashValue(value: string): string {
  const salt = String(process.env.SUPPORT_TICKET_HASH_SALT || "support-ticket-salt");
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

function parseContext(raw: any): Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const out: Record<string, any> = {};
  const safeKeys = ["route", "roomId", "feature", "build", "origin"];
  for (const key of safeKeys) {
    const value = raw[key];
    if (typeof value === "string") {
      out[key] = value.slice(0, 200);
    }
  }
  return out;
}

async function enforceRateLimit(params: {
  ipHash: string;
  emailHash: string | null;
}): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const now = Date.now();
  const keys = [
    `ip:${params.ipHash}`,
    ...(params.emailHash ? [`email:${params.emailHash}`] : []),
  ];

  const refs = keys.map((key) => firestore.collection("supportTicketSubmissions").doc(key));
  const snaps = await Promise.all(refs.map((ref) => ref.get()));

  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = (snap.data() as any) || {};
    const lastSubmittedAtMs = typeof data.lastSubmittedAtMs === "number" ? data.lastSubmittedAtMs : 0;
    const elapsed = now - lastSubmittedAtMs;
    if (elapsed < RATE_LIMIT_WINDOW_MS) {
      const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000));
      return { ok: false, retryAfterSec };
    }
  }

  const batch = firestore.batch();
  for (const ref of refs) {
    batch.set(
      ref,
      {
        lastSubmittedAtMs: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        count: admin.firestore.FieldValue.increment(1),
      },
      { merge: true },
    );
  }
  await batch.commit();

  return { ok: true };
}

router.post("/submit", async (req, res) => {
  const authUser = await tryGetAuthUserAny(req as any).catch(() => null);
  const submitterMode: "user" | "anonymous" = authUser?.uid ? "user" : "anonymous";

  const subject = cleanText(req.body?.subject, SUBJECT_MAX);
  const message = cleanText(req.body?.message, MESSAGE_MAX);
  const category = normalizeCategory(req.body?.category);
  const priority = normalizePriority(req.body?.priority);

  if (subject.length < SUBJECT_MIN) {
    return res.status(400).json({ error: "subject_required", min: SUBJECT_MIN });
  }

  if (message.length < MESSAGE_MIN) {
    return res.status(400).json({ error: "message_required", min: MESSAGE_MIN });
  }

  let email = normalizeEmail(req.body?.email);
  if (submitterMode === "anonymous") {
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "email_required_for_anonymous" });
    }
  } else {
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: "invalid_email" });
    }
    if (!email && authUser?.uid) {
      try {
        const userSnap = await firestore.collection("users").doc(authUser.uid).get();
        const profileEmail = normalizeEmail((userSnap.data() as any)?.email);
        if (isValidEmail(profileEmail)) {
          email = profileEmail;
        }
      } catch {
        // best-effort only
      }
    }
  }

  const pageUrl = cleanText(req.body?.pageUrl, 600);
  const context = parseContext(req.body?.context);
  const ip = getIp(req);
  const ipHash = hashValue(ip);
  const emailHash = email ? hashValue(email) : null;

  const rateLimit = await enforceRateLimit({ ipHash, emailHash });
  if (!rateLimit.ok) {
    return res.status(429).json({ error: "rate_limited", retryAfterSec: rateLimit.retryAfterSec });
  }

  const ticketRef = firestore.collection("supportTickets").doc();
  const nowIso = new Date().toISOString();

  await ticketRef.set({
    ticketId: ticketRef.id,
    status: "new",
    source: "streamline_support_page",
    submittedAt: nowIso,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    submitter: {
      uid: authUser?.uid || null,
      email: email || null,
      auth: submitterMode,
    },
    content: {
      subject,
      message,
      category,
      priority,
    },
    meta: {
      pageUrl: pageUrl || null,
      userAgent: cleanText(req.headers["user-agent"], 400) || null,
      ipHash,
      context,
    },
  });

  return res.status(201).json({ ok: true, ticketId: ticketRef.id });
});

export default router;
