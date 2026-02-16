export type PublicEduEvent = {
  id: string;
  title: string;
  scheduledStartAt: string | null;
  status: string | null;
  broadcastId: string | null;
};

export type PublicEduBroadcast = {
  id: string;
  status: string | null;
  hlsPlaybackUrl: string | null;
  recordingId: string | null;
  replayUrl: string | null;
  endedAt: string | null;
};

export type PublicEduEventResponse = {
  event: PublicEduEvent;
  broadcast: PublicEduBroadcast | null;
};

export async function fetchPublicEduEvent(eventId: string): Promise<PublicEduEventResponse> {
  const trimmed = String(eventId || "").trim();
  if (!trimmed) throw new Error("eventId required");

  const res = await fetch(`/api/public/edu/events/${encodeURIComponent(trimmed)}`);
  if (!res.ok) {
    let err = `Failed to load event (${res.status})`;
    try {
      const body = (await res.json().catch(() => null)) as any;
      if (body?.error) err = String(body.error);
    } catch {
      // ignore
    }
    throw new Error(err);
  }

  const payload = (await res.json().catch(() => null)) as any;
  const ev = payload?.event || {};
  const b = payload?.broadcast || null;

  return {
    event: {
      id: String(ev?.id || "").trim(),
      title: typeof ev?.title === "string" ? ev.title : "",
      scheduledStartAt: typeof ev?.scheduledStartAt === "string" ? ev.scheduledStartAt : null,
      status: typeof ev?.status === "string" ? ev.status : null,
      broadcastId: typeof ev?.broadcastId === "string" ? ev.broadcastId : null,
    },
    broadcast: b
      ? {
          id: String(b?.id || "").trim(),
          status: typeof b?.status === "string" ? b.status : null,
          hlsPlaybackUrl: typeof b?.hlsPlaybackUrl === "string" ? b.hlsPlaybackUrl : null,
          recordingId: typeof b?.recordingId === "string" ? b.recordingId : null,
          replayUrl: typeof b?.replayUrl === "string" ? b.replayUrl : null,
          endedAt: typeof b?.endedAt === "string" ? b.endedAt : null,
        }
      : null,
  };
}
