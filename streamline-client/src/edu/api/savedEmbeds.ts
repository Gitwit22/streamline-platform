import { apiFetchAuth } from "../../lib/api";

export type EduSavedEmbed = {
  embedId: string;
  viewerPath: string;
  roomId: string;
  label?: string;
  name?: string;
  description?: string;
};

export async function createEduSavedEmbed(params: {
  name: string;
  description?: string;
  hlsConfig?: {
    enabled?: boolean;
    title?: string;
    subtitle?: string;
    offlineMessage?: string;
    theme?: "dark" | "light";
    logoUrl?: string;
  };
}): Promise<EduSavedEmbed> {
  const res = await apiFetchAuth("/api/saved-embeds", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      description: params.description,
      hlsConfig: params.hlsConfig,
    }),
  });

  const data = (await res.json()) as any;
  const embed = data?.embed || data;
  return {
    embedId: String(embed?.embedId || embed?.savedEmbedId || ""),
    viewerPath: String(embed?.viewerPath || ""),
    roomId: String(embed?.roomId || ""),
    label: typeof embed?.label === "string" ? embed.label : undefined,
    name: typeof embed?.name === "string" ? embed.name : undefined,
    description: typeof embed?.description === "string" ? embed.description : undefined,
  };
}
