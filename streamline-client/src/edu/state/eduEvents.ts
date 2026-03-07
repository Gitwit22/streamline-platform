export type EduEventType = "concert" | "game" | "assembly" | "address";

export type EduEventStatus = "scheduled" | "ready" | "live" | "ended" | "canceled";

export type EduEventOutputs = {
  publishHls: boolean;
  recordMp4: boolean;
  youtube: boolean;
  youtubeDestinationId: string | null;
};

export type EduEvent = {
  id: string;
  title: string;
  type: EduEventType;
  startsAt: string; // ISO
  endsAt: string; // ISO
  timezone: string; // IANA, locked to school timezone

  notes?: string;

  producerName: string | null;
  talent: string[];
  studentProducerCanStart: boolean;

  outputs: EduEventOutputs;

  // Room assignment
  assignedRoomId: string | null;

  // Links
  savedEmbedId: string | null; // /live/:savedEmbedId

  // Status fields
  isLive: boolean;
  endedAt: string | null;
  canceledAt: string | null;

  createdAt: string;
  updatedAt: string;
};

import { apiFetchAuth } from "../../lib/api";

/* ── Helpers ──────────────────────────────────────────────────── */

function addMinutesIso(iso: string, minutes: number): string {
  try {
    const base = new Date(iso).getTime();
    if (!Number.isFinite(base)) return iso;
    return new Date(base + minutes * 60_000).toISOString();
  } catch {
    return iso;
  }
}

function normalizeEvent(x: any): EduEvent | null {
  if (!x || typeof x !== "object") return null;
  const id = typeof x.id === "string" ? x.id : "";
  const title = typeof x.title === "string" ? x.title : "";
  const type = x.type as EduEventType;
  const startsAt = typeof x.startsAt === "string" ? x.startsAt : "";
  const timezone = typeof x.timezone === "string" && x.timezone.trim() ? x.timezone.trim() : "America/New_York";
  const endsAt = typeof x.endsAt === "string" && x.endsAt ? x.endsAt : addMinutesIso(startsAt, 60);

  if (!id || !title || !startsAt) return null;
  if (type !== "concert" && type !== "game" && type !== "assembly" && type !== "address") return null;

  const outputsRaw = x.outputs || {};
  const outputs: EduEventOutputs = {
    publishHls: !!outputsRaw.publishHls,
    recordMp4: !!outputsRaw.recordMp4,
    youtube: !!outputsRaw.youtube,
    youtubeDestinationId: typeof outputsRaw.youtubeDestinationId === "string" ? outputsRaw.youtubeDestinationId : null,
  };

  const talent = Array.isArray(x.talent) ? x.talent.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim()) : [];

  const createdAt = typeof x.createdAt === "string" ? x.createdAt : new Date().toISOString();
  const updatedAt = typeof x.updatedAt === "string" ? x.updatedAt : createdAt;

  return {
    id,
    title,
    type,
    startsAt,
    endsAt,
    timezone,
    notes: typeof x.notes === "string" ? x.notes : "",
    producerName: typeof x.producerName === "string" ? x.producerName : null,
    talent,
    studentProducerCanStart: !!x.studentProducerCanStart,
    outputs,
    assignedRoomId: typeof x.assignedRoomId === "string" ? x.assignedRoomId : null,
    savedEmbedId: typeof x.savedEmbedId === "string" ? x.savedEmbedId : null,
    isLive: !!x.isLive,
    endedAt: typeof x.endedAt === "string" ? x.endedAt : null,
    canceledAt: typeof x.canceledAt === "string" ? x.canceledAt : null,
    createdAt,
    updatedAt,
  };
}

/* ── API-backed CRUD ──────────────────────────────────────────── */

export async function listEduEvents(): Promise<EduEvent[]> {
  const res = await apiFetchAuth("/api/edu/events?limit=200");
  if (!res.ok) throw new Error(`Failed to list events: ${res.status}`);
  const data = await res.json();
  const raw = Array.isArray(data?.events) ? data.events : [];
  return raw.map(normalizeEvent).filter(Boolean) as EduEvent[];
}

export async function getEduEventById(id: string): Promise<EduEvent | null> {
  const res = await apiFetchAuth(`/api/edu/events/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return normalizeEvent(data?.event) || null;
}

export async function createEduEvent(params: {
  title: string;
  type: EduEventType;
  startsAt: string;
  endsAt?: string;
  timezone?: string;
  producerName?: string | null;
  talent?: string[];
  studentProducerCanStart?: boolean;
  outputs?: Partial<EduEventOutputs>;
  assignedRoomId?: string | null;
}): Promise<EduEvent> {
  const res = await apiFetchAuth("/api/edu/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: params.title.trim(),
      type: params.type,
      startsAt: params.startsAt,
      endsAt: params.endsAt || undefined,
      timezone: params.timezone || undefined,
      producerName: params.producerName || null,
      talent: params.talent || [],
      studentProducerCanStart: !!params.studentProducerCanStart,
      outputs: {
        publishHls: params.outputs?.publishHls ?? true,
        recordMp4: params.outputs?.recordMp4 ?? true,
        youtube: params.outputs?.youtube ?? false,
        youtubeDestinationId: params.outputs?.youtubeDestinationId ?? null,
      },
      assignedRoomId: params.assignedRoomId || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || `Failed to create event: ${res.status}`);
  }
  const data = await res.json();
  const ev = normalizeEvent(data?.event);
  if (!ev) throw new Error("Invalid event returned from server");
  return ev;
}

export async function upsertEduEvent(event: EduEvent): Promise<EduEvent> {
  const res = await apiFetchAuth(`/api/edu/events/${encodeURIComponent(event.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: event.title,
      type: event.type,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      notes: event.notes || "",
      producerName: event.producerName,
      talent: event.talent,
      studentProducerCanStart: event.studentProducerCanStart,
      outputs: event.outputs,
      assignedRoomId: event.assignedRoomId,
      savedEmbedId: event.savedEmbedId,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || `Failed to update event: ${res.status}`);
  }
  const data = await res.json();
  return normalizeEvent(data?.event) || event;
}

export async function duplicateEduEvent(sourceId: string): Promise<EduEvent | null> {
  const res = await apiFetchAuth(`/api/edu/events/${encodeURIComponent(sourceId)}/duplicate`, {
    method: "POST",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return normalizeEvent(data?.event) || null;
}

export async function cancelEduEvent(id: string): Promise<void> {
  await apiFetchAuth(`/api/edu/events/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
}

export async function setEduEventLive(id: string, live: boolean): Promise<void> {
  await apiFetchAuth(`/api/edu/events/${encodeURIComponent(id)}/set-live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ live }),
  });
}

/* ── Pure helpers (no API needed) ─────────────────────────────── */

export function computeEduEventStatus(ev: EduEvent): EduEventStatus {
  if (ev.canceledAt) return "canceled";
  if (ev.isLive) return "live";
  if (ev.endedAt) return "ended";
  const hasProducer = !!(ev.producerName && ev.producerName.trim());
  const hasOutputs = !!(ev.outputs.publishHls || ev.outputs.recordMp4 || ev.outputs.youtube);
  if (hasProducer && hasOutputs) return "ready";
  return "scheduled";
}

export function isInStartWindow(ev: EduEvent, opts?: { beforeMinutes?: number; afterHours?: number }): boolean {
  const beforeMinutes = opts?.beforeMinutes ?? 15;
  const afterHours = opts?.afterHours ?? 4;
  const start = new Date(ev.startsAt).getTime();
  if (!Number.isFinite(start)) return false;
  const now = Date.now();
  const from = start - beforeMinutes * 60_000;
  const to = start + afterHours * 60 * 60_000;
  return now >= from && now <= to;
}
