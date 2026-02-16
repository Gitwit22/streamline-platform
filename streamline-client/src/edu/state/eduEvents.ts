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

  notes?: string;

  producerName: string | null;
  talent: string[];
  studentProducerCanStart: boolean;

  outputs: EduEventOutputs;

  // Links
  savedEmbedId: string | null; // /live/:savedEmbedId

  // Status fields
  isLive: boolean;
  endedAt: string | null;
  canceledAt: string | null;

  createdAt: string;
  updatedAt: string;
};

const EVENTS_KEY = "sl_edu_events_v1";

function nowIso() {
  return new Date().toISOString();
}

export function randomId(prefix: string) {
  try {
    // @ts-expect-error crypto may be missing
    const id = crypto?.randomUUID?.();
    if (id) return `${prefix}_${id.slice(0, 12)}`;
  } catch {
    // ignore
  }
  return `${prefix}_${Math.random().toString(16).slice(2, 14)}`;
}

function safeParse(raw: string | null): unknown {
  try {
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeEvent(x: any): EduEvent | null {
  if (!x || typeof x !== "object") return null;
  const id = typeof x.id === "string" ? x.id : "";
  const title = typeof x.title === "string" ? x.title : "";
  const type = x.type as EduEventType;
  const startsAt = typeof x.startsAt === "string" ? x.startsAt : "";

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

  const createdAt = typeof x.createdAt === "string" ? x.createdAt : nowIso();
  const updatedAt = typeof x.updatedAt === "string" ? x.updatedAt : createdAt;

  return {
    id,
    title,
    type,
    startsAt,
    notes: typeof x.notes === "string" ? x.notes : "",
    producerName: typeof x.producerName === "string" ? x.producerName : null,
    talent,
    studentProducerCanStart: !!x.studentProducerCanStart,
    outputs,
    savedEmbedId: typeof x.savedEmbedId === "string" ? x.savedEmbedId : null,
    isLive: !!x.isLive,
    endedAt: typeof x.endedAt === "string" ? x.endedAt : null,
    canceledAt: typeof x.canceledAt === "string" ? x.canceledAt : null,
    createdAt,
    updatedAt,
  };
}

function loadAll(): EduEvent[] {
  try {
    if (typeof window === "undefined") return [];
    const parsed = safeParse(window.localStorage.getItem(EVENTS_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEvent).filter(Boolean) as EduEvent[];
  } catch {
    return [];
  }
}

function saveAll(events: EduEvent[]) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  } catch {
    // ignore
  }
}

export function listEduEvents(): EduEvent[] {
  return loadAll().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
}

export function getEduEventById(id: string): EduEvent | null {
  const all = loadAll();
  return all.find((e) => e.id === id) || null;
}

export function upsertEduEvent(event: EduEvent) {
  const all = loadAll();
  const idx = all.findIndex((e) => e.id === event.id);
  const next: EduEvent = { ...event, updatedAt: nowIso() };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  saveAll(all);
}

export function createEduEvent(params: {
  title: string;
  type: EduEventType;
  startsAt: string;
  producerName?: string | null;
  talent?: string[];
  studentProducerCanStart?: boolean;
  outputs?: Partial<EduEventOutputs>;
}): EduEvent {
  const createdAt = nowIso();
  const ev: EduEvent = {
    id: randomId("edu_event"),
    title: params.title.trim(),
    type: params.type,
    startsAt: params.startsAt,
    notes: "",
    producerName: (params.producerName || "").trim() ? String(params.producerName).trim() : null,
    talent: (params.talent || []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean),
    studentProducerCanStart: !!params.studentProducerCanStart,
    outputs: {
      publishHls: params.outputs?.publishHls ?? true,
      recordMp4: params.outputs?.recordMp4 ?? true,
      youtube: params.outputs?.youtube ?? false,
      youtubeDestinationId: typeof params.outputs?.youtubeDestinationId === "string" ? params.outputs?.youtubeDestinationId : null,
    },
    savedEmbedId: null,
    isLive: false,
    endedAt: null,
    canceledAt: null,
    createdAt,
    updatedAt: createdAt,
  };
  upsertEduEvent(ev);
  return ev;
}

export function duplicateEduEvent(sourceId: string): EduEvent | null {
  const src = getEduEventById(sourceId);
  if (!src) return null;
  const createdAt = nowIso();
  const ev: EduEvent = {
    ...src,
    id: randomId("edu_event"),
    title: `${src.title} (Copy)`,
    isLive: false,
    endedAt: null,
    canceledAt: null,
    createdAt,
    updatedAt: createdAt,
  };
  upsertEduEvent(ev);
  return ev;
}

export function cancelEduEvent(id: string) {
  const ev = getEduEventById(id);
  if (!ev) return;
  if (ev.canceledAt) return;
  upsertEduEvent({ ...ev, isLive: false, endedAt: ev.endedAt, canceledAt: nowIso() });
}

export function setEduEventLive(id: string, live: boolean) {
  const ev = getEduEventById(id);
  if (!ev) return;
  if (ev.canceledAt) return;
  if (live) {
    upsertEduEvent({ ...ev, isLive: true, endedAt: null });
  } else {
    upsertEduEvent({ ...ev, isLive: false, endedAt: ev.endedAt || nowIso() });
  }
}

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
