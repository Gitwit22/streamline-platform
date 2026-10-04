/**
 * Admin metrics backed by Firestore aggregation queries (count()/sum()), so
 * the admin dashboard never scans whole collections.
 *
 *   computePlatformStats()   GET /api/admin/stats         (cached 60s)
 *   computePeriodCounters()  GET /api/admin/usage/counters (cached 2 min)
 *   listUsersPage()          GET /api/admin/usage user list (ordered, paginated)
 *
 * Index notes (see firestore.indexes.json at the repo root):
 *   - users where planId == X orderBy createdAt desc   -> composite (planId, createdAt desc)
 *   - collectionGroup("messages") createdAt range       -> collection-group field override
 *   Everything else is a single-field filter (automatic indexes).
 */
import { AggregateField, Timestamp, type Query } from "firebase-admin/firestore";
import { firestore } from "../firebaseAdmin";
import { PLAN_CATALOG_V2 } from "./entitlements";
import { monthKeyUTC } from "./streamingMeterPure";
import {
  activityWindows,
  buildUsersByPlan,
  createTtlCache,
  emailPrefixRange,
  matchesProgramContext,
  monthKeysBetween,
  sumCountParts,
  sumStreamingMinutes,
  type UserListQuery,
} from "./adminMetricsPure";

function warn(label: string, err: any) {
  console.warn(`[adminMetrics] ${label} failed:`, err?.message || err);
}

export async function countQuery(q: Query, label = "count"): Promise<number | null> {
  try {
    const snap = await q.count().get();
    return Number(snap.data().count) || 0;
  } catch (err) {
    warn(label, err);
    return null;
  }
}

async function sumQuery(q: Query, field: string, label: string): Promise<number | null> {
  try {
    const snap = await q.aggregate({ total: AggregateField.sum(field) }).get();
    const v = Number((snap.data() as any).total);
    return Number.isFinite(v) ? v : 0;
  } catch (err) {
    warn(label, err);
    return null;
  }
}

/**
 * Count docs whose `field` falls in [startMs, endMs]. Timestamps in this
 * codebase are stored as epoch ms, Firestore Timestamps or ISO strings
 * depending on the writer; Firestore range filters are type-specific, so each
 * representation is counted separately and summed.
 */
export async function countInRange(base: Query, field: string, startMs: number, endMs: number, label: string): Promise<number | null> {
  const parts = await Promise.all([
    countQuery(base.where(field, ">=", startMs).where(field, "<=", endMs), `${label}:ms`),
    countQuery(
      base.where(field, ">=", Timestamp.fromMillis(startMs)).where(field, "<=", Timestamp.fromMillis(endMs)),
      `${label}:ts`
    ),
    countQuery(
      base.where(field, ">=", new Date(startMs).toISOString()).where(field, "<=", new Date(endMs).toISOString()),
      `${label}:iso`
    ),
  ]);
  return sumCountParts(parts);
}

/** Bounded scan variant for program-scoped (Support Hub) counters. */
async function scanInRange(
  base: Query,
  field: string,
  startMs: number,
  endMs: number,
  keep: (doc: FirebaseFirestore.QueryDocumentSnapshot) => boolean,
  label: string,
  cap = 2000
): Promise<number | null> {
  const queries = [
    base.where(field, ">=", startMs).where(field, "<=", endMs),
    base.where(field, ">=", Timestamp.fromMillis(startMs)).where(field, "<=", Timestamp.fromMillis(endMs)),
  ];
  const parts = await Promise.all(
    queries.map(async (q) => {
      try {
        const snap = await q.limit(cap).get();
        return snap.docs.filter(keep).length;
      } catch (err) {
        warn(label, err);
        return null;
      }
    })
  );
  return sumCountParts(parts);
}

/** Sum of a usageMonthly field over month keys (`in` filter, 30 keys per query). */
export async function sumUsageMonthly(monthKeys: string[], field: string): Promise<number | null> {
  const parts: Array<number | null> = [];
  for (let i = 0; i < monthKeys.length; i += 30) {
    const chunk = monthKeys.slice(i, i + 30);
    const q = firestore.collection("usageMonthly").where("monthKey", "in", chunk);
    parts.push(await sumQuery(q, field, `sum ${field}`));
  }
  return sumCountParts(parts);
}

/** Streaming minutes for one month; falls back to a bounded paginated scan. */
async function streamingMinutesForMonth(monthKey: string): Promise<{ minutes: number; method: "aggregate" | "scan" | "unavailable" }> {
  const agg = await sumQuery(
    firestore.collection("usageMonthly").where("monthKey", "==", monthKey),
    "usage.streamingMinutes",
    "sum streamingMinutes"
  );
  if (agg !== null) return { minutes: Math.round(agg * 100) / 100, method: "aggregate" };
  try {
    const docs: any[] = [];
    let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (let page = 0; page < 10; page++) {
      let q = firestore.collection("usageMonthly").where("monthKey", "==", monthKey).select("usage").limit(500);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      snap.docs.forEach((d) => docs.push(d.data()));
      if (snap.size < 500) break;
      last = snap.docs[snap.docs.length - 1];
    }
    return { minutes: sumStreamingMinutes(docs), method: "scan" };
  } catch (err) {
    warn("streaming minutes scan", err);
    return { minutes: 0, method: "unavailable" };
  }
}

export type PlatformStats = {
  totalUsers: number;
  deletedUsers: number;
  usersByPlan: Record<string, number>;
  /** Users with an admin plan override set (the effective plan differs from the base plan while active). */
  planOverrides: number;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  /** Streaming minutes this (UTC) month, all users. */
  totalMinutesUsed: number;
  streamingMinutesThisMonth: number;
  usersWithUsageThisMonth: number;
  averageMinutesPerUser: number;
  averageMinutesPerActiveUser: number;
  monthKey: string;
  minutesMethod: "aggregate" | "scan" | "unavailable";
  computedAt: number;
  /** Metric definitions for the UI. */
  notes: Record<string, string>;
};

const statsCache = createTtlCache<PlatformStats>(60_000, 4);

export async function computePlatformStats(opts: { fresh?: boolean } = {}): Promise<PlatformStats> {
  if (opts.fresh) statsCache.clear();
  return statsCache.get("stats", async () => {
    const nowMs = Date.now();
    const users = firestore.collection("users");
    const w = activityWindows(nowMs);
    const monthKey = monthKeyUTC(new Date(nowMs));

    let planIds: string[] = Object.keys(PLAN_CATALOG_V2);
    try {
      const plansSnap = await firestore.collection("plans").select().get();
      planIds = Array.from(new Set([...planIds, ...plansSnap.docs.map((d) => d.id)]));
    } catch (err) {
      warn("plan ids", err);
    }

    const [total, deleted, today, week, month, overrides, withUsage, minutes, ...planCounts] = await Promise.all([
      countQuery(users, "users total"),
      countQuery(users.where("accountStatus", "==", "deleted"), "users deleted"),
      countQuery(users.where("lastActiveAt", ">=", w.dayStartMs), "active today"),
      countQuery(users.where("lastActiveAt", ">=", w.weekStartMs), "active week"),
      countQuery(users.where("lastActiveAt", ">=", w.monthStartMs), "active month"),
      countQuery(users.where("planOverride.planId", ">", ""), "plan overrides"),
      countQuery(firestore.collection("usageMonthly").where("monthKey", "==", monthKey), "usage docs"),
      streamingMinutesForMonth(monthKey),
      ...planIds.map((id) => countQuery(users.where("planId", "==", id), `plan ${id}`)),
    ]);

    const counts: Record<string, number> = {};
    planIds.forEach((id, i) => {
      counts[id] = Number(planCounts[i] ?? 0) || 0;
    });
    const totalUsers = Math.max(0, (Number(total) || 0) - (Number(deleted) || 0));
    const totalMinutes = (minutes as any).minutes as number;
    const activeThisMonth = Number(month) || 0;
    return {
      totalUsers,
      deletedUsers: Number(deleted) || 0,
      usersByPlan: buildUsersByPlan({ planIds, counts, totalUsers }),
      planOverrides: Number(overrides) || 0,
      activeToday: Number(today) || 0,
      activeThisWeek: Number(week) || 0,
      activeThisMonth,
      totalMinutesUsed: totalMinutes,
      streamingMinutesThisMonth: totalMinutes,
      usersWithUsageThisMonth: Number(withUsage) || 0,
      averageMinutesPerUser: totalUsers > 0 ? Math.round((totalMinutes / totalUsers) * 10) / 10 : 0,
      averageMinutesPerActiveUser: activeThisMonth > 0 ? Math.round((totalMinutes / activeThisMonth) * 10) / 10 : 0,
      monthKey,
      minutesMethod: (minutes as any).method,
      computedAt: nowMs,
      notes: {
        active: "users.lastActiveAt (written on authenticated requests, at most every 10 minutes); UTC day/month, rolling 7 days",
        usersByPlan: "Base plan (users.planId; includes soft-deleted accounts, missing planId counted as free). Effective plans differ while an admin override is active.",
        minutes: `Streaming minutes metered this month (${monthKey}, UTC) from usageMonthly`,
      },
    };
  });
}

export type PeriodCounters = {
  ticketsToday: number;
  activeUsers: number;
  roomsCreated: number;
  messagesSent: number;
  streamMinutes: number;
  apiRequests: number;
  recordingsCreated: number;
  hlsMinutes: number;
  /** Counter names that could not be computed (index missing, etc.). */
  unavailable: string[];
  period: { startMs: number; endMs: number };
  activeProgramId: string | null;
  computedAt: number;
};

const countersCache = createTtlCache<PeriodCounters>(120_000, 50);

export async function computePeriodCounters(startMs: number, endMs: number, activeProgramId: string | null): Promise<PeriodCounters> {
  // Round to the minute so "now"-relative periods share a cache entry.
  const s = Math.floor(startMs / 60_000) * 60_000;
  const e = Math.ceil(endMs / 60_000) * 60_000;
  const key = `${s}:${e}:${activeProgramId || ""}`;
  return countersCache.get(key, async () => {
    const monthKeys = monthKeysBetween(s, e);
    const unavailable: string[] = [];
    const keep = (d: FirebaseFirestore.QueryDocumentSnapshot) => matchesProgramContext(d.data(), activeProgramId);
    const msgKeep = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
      const path = d.ref.path.split("/");
      const roomId = path[0] === "rooms" ? path[1] || "" : "";
      return Boolean(activeProgramId && roomId.includes(activeProgramId));
    };
    const range = (base: Query, field: string, label: string, keepFn = keep) =>
      activeProgramId ? scanInRange(base, field, s, e, keepFn, label) : countInRange(base, field, s, e, label);

    const [tickets, active, rooms, messages, recStarted, recCreated, stream, hls, api] = await Promise.all([
      range(firestore.collection("supportTickets"), "createdAt", "tickets"),
      range(firestore.collection("users"), "lastActiveAt", "active users"),
      range(firestore.collection("rooms"), "createdAt", "rooms"),
      range(firestore.collectionGroup("messages"), "createdAt", "messages", msgKeep),
      range(firestore.collection("recordings"), "startedAt", "recordings started"),
      range(firestore.collection("recordings"), "createdAt", "recordings created"),
      activeProgramId ? Promise.resolve(0) : sumUsageMonthly(monthKeys, "usage.streamingMinutes"),
      activeProgramId ? Promise.resolve(0) : sumUsageMonthly(monthKeys, "usage.outputMinutes.hls"),
      activeProgramId ? Promise.resolve(0) : sumUsageMonthly(monthKeys, "usage.apiRequests"),
    ]);
    const val = (name: string, v: number | null) => {
      if (v === null) unavailable.push(name);
      return Number(v || 0);
    };
    return {
      ticketsToday: val("ticketsToday", tickets),
      activeUsers: val("activeUsers", active),
      roomsCreated: val("roomsCreated", rooms),
      messagesSent: val("messagesSent", messages),
      streamMinutes: Math.round(val("streamMinutes", stream)),
      apiRequests: val("apiRequests", api),
      // Recordings carry startedAt and/or createdAt depending on the writer.
      recordingsCreated: Math.max(val("recordingsCreated", recStarted), Number(recCreated || 0)),
      hlsMinutes: Math.round(val("hlsMinutes", hls)),
      unavailable,
      period: { startMs: s, endMs: e },
      activeProgramId,
      computedAt: Date.now(),
    };
  });
}

/**
 * One page of users for the admin usage table.
 *   - default: createdAt desc, cursor = last doc id (optionally planId ==)
 *   - search:  email prefix on emailLower (and legacy email, which signup
 *              already stores lower-cased); plan filter applied in memory.
 */
export async function listUsersPage(q: UserListQuery): Promise<{
  docs: FirebaseFirestore.QueryDocumentSnapshot[];
  nextCursor: string | null;
}> {
  const users = firestore.collection("users");
  if (q.search) {
    const { start, end } = emailPrefixRange(q.search);
    const run = async (field: string) => {
      try {
        const snap = await users.where(field, ">=", start).where(field, "<", end).orderBy(field).limit(q.limit).get();
        return snap.docs;
      } catch (err) {
        warn(`search ${field}`, err);
        return [];
      }
    };
    const [a, b] = await Promise.all([run("emailLower"), run("email")]);
    const byId = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    [...a, ...b].forEach((d) => byId.set(d.id, d));
    let docs = Array.from(byId.values());
    if (q.plan) docs = docs.filter((d) => String((d.data() as any)?.planId || "free") === q.plan);
    docs.sort((x, y) => String((x.data() as any)?.email || "").localeCompare(String((y.data() as any)?.email || "")));
    return { docs: docs.slice(0, q.limit), nextCursor: null };
  }

  let query: Query = users;
  if (q.plan) query = query.where("planId", "==", q.plan);
  query = query.orderBy("createdAt", "desc");
  if (q.cursor) {
    const cursorSnap = await users.doc(q.cursor).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap);
  }
  const snap = await query.limit(q.limit + 1).get();
  const docs = snap.docs.slice(0, q.limit);
  return { docs, nextCursor: snap.docs.length > q.limit ? docs[docs.length - 1].id : null };
}
