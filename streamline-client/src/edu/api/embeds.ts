import { apiFetchAuth } from "../../lib/api";

export type EduEventEmbedAccessMode = "public" | "unlisted" | "password";

export type EduEventEmbed = {
  embedId: string;
  eventId: string;
  accessMode: EduEventEmbedAccessMode;
  token: string;
  hasPassword: boolean;
};

export async function upsertEduEventEmbed(params: {
  eventId: string;
  accessMode: EduEventEmbedAccessMode;
  password?: string;
}): Promise<EduEventEmbed> {
  const res = await apiFetchAuth("/api/edu/embeds/event", {
    method: "POST",
    body: JSON.stringify({
      eventId: params.eventId,
      accessMode: params.accessMode,
      ...(typeof params.password === "string" ? { password: params.password } : {}),
    }),
  });

  const payload = (await res.json().catch(() => null)) as any;
  const embed = payload?.embed || null;
  if (!embed || typeof embed.embedId !== "string") {
    throw new Error(payload?.error || "Failed to create embed");
  }

  return {
    embedId: String(embed.embedId || "").trim(),
    eventId: String(embed.eventId || "").trim(),
    accessMode:
      embed.accessMode === "unlisted" || embed.accessMode === "password" || embed.accessMode === "public"
        ? embed.accessMode
        : "public",
    token: String(embed.token || "").trim(),
    hasPassword: embed.hasPassword === true,
  };
}
