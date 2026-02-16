import express from "express";
import { firestore } from "../firebaseAdmin";

const router = express.Router();

// Simple in-memory cache to reduce Firestore reads
let cached: {
  payload: any;
  at: number;
} | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// Public stats for landing page
router.get("/public", async (_req, res) => {
  try {
    // Serve from cache if fresh
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return res.json(cached.payload);
    }

    // Run both queries in parallel for speed
    const [usersSnap, usageSnap] = await Promise.all([
      firestore.collection("users").get(),
      firestore.collection("usageMonthly").get(),
    ]);

    // Total registered users (streamers)
    const streamers = usersSnap.size;
    const knownUserIds = new Set<string>();
    usersSnap.docs.forEach((d) => {
      if (d?.id) knownUserIds.add(String(d.id));
    });

    const extractUid = (docId: string, data: any): string | null => {
      const id = String(docId || "").trim();
      if (id) {
        // Expected usageMonthly doc id shape: `${uid}_${YYYY-MM}`
        const idx = id.indexOf("_");
        if (idx > 0) return id.slice(0, idx);
      }
      const uid = String(data?.uid || data?.userId || "").trim();
      return uid || null;
    };

    // Sum participant minutes from usageMonthly
    let totalMinutes = 0;
    const activeCutoffMs = Date.now() - 60 * 60 * 1000; // last 60 minutes
    const activeUids = new Set<string>();
    usageSnap.docs.forEach((doc) => {
      const data = doc.data() as any;
      const usage = data?.usage || data?.totals || {};
      const participantMinutes = Number(
        usage?.participantMinutes ?? usage?.streamMinutes ?? usage?.minutes ?? 0
      );
      totalMinutes += participantMinutes;

      // Consider a usageMonthly doc "active" if updated within the last hour
      const updatedAt = (data?.updatedAt as any);
      const createdAt = (data?.createdAt as any);
      // Firestore Timestamp has toMillis/toDate; otherwise try number/date string
      const toMs = (t: any): number | null => {
        try {
          if (!t) return null;
          if (typeof t === "number") return t;
          if (typeof t === "string") return Date.parse(t) || null;
          if (typeof t.toMillis === "function") return t.toMillis();
          if (typeof t.toDate === "function") return t.toDate().getTime();
          return null;
        } catch {
          return null;
        }
      };
      const updatedMs = toMs(updatedAt) ?? toMs(createdAt);
      if (!updatedMs || updatedMs < activeCutoffMs) return;

      const uid = extractUid(doc.id, data);
      if (!uid) return;
      // Avoid the landing page showing more "Active Now" than total users.
      if (knownUserIds.size && !knownUserIds.has(uid)) return;
      activeUids.add(uid);
    });

    const streamersActive = activeUids.size;

    const hoursStreamed = Math.floor(totalMinutes / 60);

    const payload = {
      streamers,
      hoursStreamed,
      minutesStreamed: totalMinutes,
      streamersActive,
    };

    // Update cache
    cached = { payload, at: Date.now() };

    return res.json(payload);
  } catch (err: any) {
    console.error("stats/public error:", err);
    return res.status(500).json({ error: "failed_to_load_stats" });
  }
});

export default router;
