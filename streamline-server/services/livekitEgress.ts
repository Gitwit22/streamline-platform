import {
  EgressClient,
  SegmentedFileOutput,
  SegmentedFileProtocol,
  S3Upload,
  EncodingOptionsPreset,
} from "livekit-server-sdk";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export type HlsPresetId = "hls_720p" | "hls_1080p";

function mapPreset(_presetId: HlsPresetId): EncodingOptionsPreset | undefined {
  // TODO: Wire presets into encoding options when supported.
  // For now we rely on LiveKit defaults.
  return undefined;
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
  if (process.env.AUTH_DEBUG === "1") {
    console.log("[livekit-debug] startRoomCompositeEgress (HLS)", {
      livekitRoomName: params.roomName,
      layout: params.layout,
      prefix: params.prefix,
    });
  }

  const info = await client.startRoomCompositeEgress(
    params.roomName,
    { segments: output },
    { layout: params.layout }
  );

  // mapPreset(params.presetId) reserved for future encoding options usage

  return { egressId: info.egressId };
}

export async function stopEgress(egressId: string): Promise<void> {
  const livekitUrl = requireEnv("LIVEKIT_URL");
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const client = new EgressClient(livekitUrl, apiKey, apiSecret);
  await client.stopEgress(egressId);
}
