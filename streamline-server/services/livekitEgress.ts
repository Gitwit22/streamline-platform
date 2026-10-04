import {
  EgressClient,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  S3Upload,
  EncodingOptions,
} from "livekit-server-sdk";
import { getPresetById, toEncodingOptions } from "../lib/mediaPresets";
import { compositorUrl, warnBuiltInLayoutFallback } from "../lib/egressTemplate";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export type HlsPresetId = "hls_720p" | "hls_1080p";

/**
 * HLS preset → advanced encoding options, using the same media-preset table
 * (lib/mediaPresets.ts, "stream" profile) as multistream.  Landscape 16:9.
 * Unknown ids fall back to 720p. Includes 2s keyframes (keyFrameInterval).
 * Callers resolve/clamp the id first (lib/mediaPresets resolveHlsPreset).
 */
export function mapPreset(presetId: HlsPresetId | string | null | undefined) {
  const mediaPresetId = presetId === "hls_1080p" ? "hd_1080p30" : "standard_720p30";
  return toEncodingOptions(getPresetById(mediaPresetId), "stream");
}

export async function startHlsEgress(params: {
  roomName: string; // livekit room name (use Firestore roomId)
  layout: "speaker" | "grid";
  prefix: string; // e.g. "hls/<roomId>/"
  playlistName: string; // e.g. "room.m3u8"
  livePlaylistName?: string; // e.g. "live.m3u8" (sliding live playlist)
  segmentDurationSec: number;
  presetId: HlsPresetId;
}) {
  const livekitUrl = requireEnv("LIVEKIT_URL");
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const r2 = {
    accessKey: requireEnv("R2_ACCESS_KEY_ID"),
    secret: requireEnv("R2_SECRET_ACCESS_KEY"),
    bucket: requireEnv("R2_BUCKET"),
    region: process.env.R2_REGION || "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
  };

  const client = new EgressClient(livekitUrl, apiKey, apiSecret);

  const output = new SegmentedFileOutput({
    filenamePrefix: `${params.prefix}seg-`, // => hls/<roomId>/seg-00001.ts etc
    playlistName: params.playlistName, // => hls/<roomId>/room.m3u8
    livePlaylistName: params.livePlaylistName, // => hls/<roomId>/live.m3u8 (sliding live playlist)
    segmentDuration: params.segmentDurationSec,
    protocol: SegmentedFileProtocol.HLS_PROTOCOL,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: r2.accessKey,
        secret: r2.secret,
        region: r2.region,
        bucket: r2.bucket,
        endpoint: r2.endpoint,
      }),
    },
  });

  // RoomComposite + Segments output => HLS manifest + segments uploaded continuously.
  // Prefer the custom program-compositor template so the egress output reflects
  // the host's real-time layout choices (programState via room metadata).
  const customBaseUrl = compositorUrl("landscape") || undefined;
  const layoutWithNames = `${params.layout}-dark`;
  if (!customBaseUrl) warnBuiltInLayoutFallback("hls", layoutWithNames);
  const encodingOptions = new EncodingOptions(mapPreset(params.presetId));

  if (process.env.AUTH_DEBUG === "1") {
    console.log("[livekit-debug] startRoomCompositeEgress (HLS)", {
      livekitRoomName: params.roomName,
      layout: params.layout,
      prefix: params.prefix,
      customBaseUrl: customBaseUrl || "(fallback: built-in layout)",
      encodingOptions,
    });
  }

  const info = await client.startRoomCompositeEgress(
    params.roomName,
    { segments: output },
    {
      ...(customBaseUrl ? { customBaseUrl } : { layout: layoutWithNames }),
      encodingOptions,
    }
  );

  return { egressId: info.egressId };
}

export async function stopEgress(egressId: string): Promise<void> {
  const livekitUrl = requireEnv("LIVEKIT_URL");
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const client = new EgressClient(livekitUrl, apiKey, apiSecret);
  await client.stopEgress(egressId);
}
