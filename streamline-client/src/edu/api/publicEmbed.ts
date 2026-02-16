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

export type PublicEduEmbedMetaResponse = {
  embed: {
    embedId: string;
    accessMode: "public" | "unlisted" | "password";
    requiresPassword: boolean;
  };
  event: PublicEduEvent;
  broadcast: Omit<PublicEduBroadcast, "hlsPlaybackUrl" | "recordingId" | "replayUrl"> & {
    hlsPlaybackUrl: null;
    recordingId: null;
    replayUrl: null;
  } | null;
};

export type PublicEduEmbedResponse = {
  embed: {
    embedId: string;
    accessMode: "public" | "unlisted" | "password";
  };
  event: PublicEduEvent;
  broadcast: PublicEduBroadcast | null;
};

function coerceEvent(payload: any): PublicEduEvent {
  const ev = payload?.event || {};
  return {
    id: String(ev?.id || "").trim(),
    title: typeof ev?.title === "string" ? ev.title : "",
    scheduledStartAt: typeof ev?.scheduledStartAt === "string" ? ev.scheduledStartAt : null,
    status: typeof ev?.status === "string" ? ev.status : null,
    broadcastId: typeof ev?.broadcastId === "string" ? ev.broadcastId : null,
  };
}

function coerceBroadcast(b: any): PublicEduBroadcast | null {
  if (!b) return null;
  return {
    id: String(b?.id || "").trim(),
    status: typeof b?.status === "string" ? b.status : null,
    hlsPlaybackUrl: typeof b?.hlsPlaybackUrl === "string" ? b.hlsPlaybackUrl : null,
    recordingId: typeof b?.recordingId === "string" ? b.recordingId : null,
    replayUrl: typeof b?.replayUrl === "string" ? b.replayUrl : null,
    endedAt: typeof b?.endedAt === "string" ? b.endedAt : null,
  };
}

export async function fetchPublicEduEmbedMeta(params: { embedId: string; token?: string }): Promise<PublicEduEmbedMetaResponse> {
  const embedId = String(params.embedId || "").trim();
  const t = String(params.token || "").trim();
  if (!embedId) throw new Error("embedId required");

  const sp = new URLSearchParams();
  sp.set("embedId", embedId);
  if (t) sp.set("t", t);

  const res = await fetch(`/api/public/edu/embed/meta?${sp.toString()}`);
  if (!res.ok) {
    let err = `Failed to load embed meta (${res.status})`;
    try {
      const body = (await res.json().catch(() => null)) as any;
      if (body?.error) err = String(body.error);
    } catch {
      // ignore
    }
    throw new Error(err);
  }

  const payload = (await res.json().catch(() => null)) as any;
  const embed = payload?.embed || {};
  const broadcast = payload?.broadcast || null;

  return {
    embed: {
      embedId: String(embed?.embedId || "").trim(),
      accessMode: embed?.accessMode === "unlisted" || embed?.accessMode === "password" ? embed.accessMode : "public",
      requiresPassword: embed?.requiresPassword === true,
    },
    event: coerceEvent(payload),
    broadcast: broadcast
      ? {
          ...coerceBroadcast(broadcast)!,
          hlsPlaybackUrl: null,
          recordingId: null,
          replayUrl: null,
        }
      : null,
  };
}

export async function authPublicEduEmbedPassword(params: {
  embedId: string;
  token?: string;
  password: string;
}): Promise<{ grant: string; expiresInSeconds: number }> {
  const embedId = String(params.embedId || "").trim();
  const t = String(params.token || "").trim();
  const password = String(params.password || "");
  if (!embedId) throw new Error("embedId required");

  const res = await fetch("/api/public/edu/embed/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embedId, t, password }),
  });

  const payload = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new Error(payload?.error || `Auth failed (${res.status})`);
  }

  const grant = String(payload?.grant || "").trim();
  if (!grant) throw new Error("Auth failed");
  return {
    grant,
    expiresInSeconds: typeof payload?.expiresInSeconds === "number" ? payload.expiresInSeconds : 1800,
  };
}

export async function fetchPublicEduEmbed(params: {
  embedId: string;
  token?: string;
  grant?: string;
}): Promise<PublicEduEmbedResponse> {
  const embedId = String(params.embedId || "").trim();
  const t = String(params.token || "").trim();
  const g = String(params.grant || "").trim();
  if (!embedId) throw new Error("embedId required");

  const sp = new URLSearchParams();
  sp.set("embedId", embedId);
  if (t) sp.set("t", t);
  if (g) sp.set("g", g);

  const res = await fetch(`/api/public/edu/embed?${sp.toString()}`);
  const payload = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new Error(payload?.error || `Failed to load embed (${res.status})`);
  }

  const embed = payload?.embed || {};
  return {
    embed: {
      embedId: String(embed?.embedId || "").trim(),
      accessMode: embed?.accessMode === "unlisted" || embed?.accessMode === "password" ? embed.accessMode : "public",
    },
    event: coerceEvent(payload),
    broadcast: coerceBroadcast(payload?.broadcast || null),
  };
}
