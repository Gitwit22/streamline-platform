import { apiFetchAuth } from "../../lib/api";
import { isEduBypassEnabled } from "../state/eduMode";

export type EduEventListItem = {
  id: string;
  title: string;
  scheduledStartAt: string | null;
  status: string | null;
  broadcastId: string | null;
  updatedAt: string | null;
};

export async function listEduEventsFromApi(opts?: { limit?: number }): Promise<EduEventListItem[]> {
  if (isEduBypassEnabled()) {
    // Fall back to the localStorage-backed event store so the Embed page
    // (and anything else using the API list) sees events created in demo mode.
    try {
      const raw = localStorage.getItem("sl_edu_events_v1");
      if (raw) {
        const parsed = JSON.parse(raw) as any[];
        return parsed.map((e: any) => ({
          id: String(e?.id || ""),
          title: typeof e?.title === "string" ? e.title : "",
          scheduledStartAt: typeof e?.startsAt === "string" ? e.startsAt : null,
          status: typeof e?.isLive === "boolean" && e.isLive ? "live" : (e?.canceledAt ? "canceled" : "scheduled"),
          broadcastId: null,
          updatedAt: typeof e?.updatedAt === "string" ? e.updatedAt : null,
        })).filter((x: EduEventListItem) => !!x.id);
      }
    } catch { /* ignore */ }
    return [];
  }
  const sp = new URLSearchParams();
  if (typeof opts?.limit === "number" && Number.isFinite(opts.limit)) {
    sp.set("limit", String(Math.max(1, Math.min(100, Math.floor(opts.limit)))));
  }

  const res = await apiFetchAuth(`/api/edu/events${sp.toString() ? `?${sp.toString()}` : ""}`);
  const payload = (await res.json().catch(() => null)) as any;
  const items = Array.isArray(payload?.events) ? payload.events : [];
  return items
    .map((x: any) => ({
      id: String(x?.id || "").trim(),
      title: typeof x?.title === "string" ? x.title : "",
      scheduledStartAt: typeof x?.scheduledStartAt === "string" ? x.scheduledStartAt : null,
      status: typeof x?.status === "string" ? x.status : null,
      broadcastId: typeof x?.broadcastId === "string" ? x.broadcastId : null,
      updatedAt: typeof x?.updatedAt === "string" ? x.updatedAt : null,
    }))
    .filter((x: EduEventListItem) => !!x.id);
}
