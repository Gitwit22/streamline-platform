import { Track } from "livekit-client";

export const RECONNECT_MEDIA_MESSAGE_TYPE = "sl:reconnectMedia";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function encodeReconnectMediaMessage() {
  return new TextEncoder().encode(JSON.stringify({ type: RECONNECT_MEDIA_MESSAGE_TYPE }));
}

export function tryParseLiveKitDataMessage(payload: Uint8Array): any {
  try {
    const txt = new TextDecoder().decode(payload);
    return JSON.parse(txt || "{}");
  } catch {
    return null;
  }
}

export async function reconnectMedia(
  room: any,
  opts?: { audioDeviceId?: string; videoDeviceId?: string }
) {
  if (!room?.localParticipant) return;
  const lp: any = room.localParticipant;

  // LiveKit exposes these as booleans, but be tolerant of getter/function shapes.
  const wasMicEnabled = !!(lp as any).isMicrophoneEnabled;
  const wasCamEnabled = !!(lp as any).isCameraEnabled;

  const stopPublicationTracks = async (publications: any[], source: any) => {
    const pubs = Array.isArray(publications) ? publications : [];
    const matches = pubs.filter((p: any) => p?.source === source);
    for (const pub of matches) {
      const t: any = pub?.track;
      try {
        if (t && lp?.unpublishTrack) {
          await lp.unpublishTrack(t, true as any);
        }
      } catch {}
      try {
        if (t?.stop) t.stop();
      } catch {}
      try {
        const mst = t?.mediaStreamTrack;
        if (mst?.stop) mst.stop();
      } catch {}
    }
  };

  // Stop existing mic/cam publications (best-effort) so the browser releases devices.
  try {
    const audioPubs = Array.from(lp?.audioTrackPublications?.values?.() || []);
    await stopPublicationTracks(audioPubs, Track.Source.Microphone);
  } catch {}
  try {
    const videoPubs = Array.from(lp?.videoTrackPublications?.values?.() || []);
    await stopPublicationTracks(videoPubs, Track.Source.Camera);
  } catch {}

  try {
    if (wasMicEnabled && lp.setMicrophoneEnabled) {
      await lp.setMicrophoneEnabled(false);
    }
    if (wasCamEnabled && lp.setCameraEnabled) {
      await lp.setCameraEnabled(false);
    }

    await sleep(150);

    // Prefer Room.switchActiveDevice when present; otherwise pass deviceId into enable() calls.
    if (opts?.audioDeviceId && room.switchActiveDevice) {
      try {
        await room.switchActiveDevice("audioinput", opts.audioDeviceId);
      } catch {}
    }
    if (opts?.videoDeviceId && room.switchActiveDevice) {
      try {
        await room.switchActiveDevice("videoinput", opts.videoDeviceId);
      } catch {}
    }

    await sleep(150);

    if (wasMicEnabled && lp.setMicrophoneEnabled) {
      const audioOpts = opts?.audioDeviceId && !room.switchActiveDevice ? { deviceId: opts.audioDeviceId } : undefined;
      await lp.setMicrophoneEnabled(true, audioOpts as any);
    }
    if (wasCamEnabled && lp.setCameraEnabled) {
      const videoOpts = opts?.videoDeviceId && !room.switchActiveDevice ? { deviceId: opts.videoDeviceId } : undefined;
      await lp.setCameraEnabled(true, videoOpts as any);
    }
  } catch {
    // Manual-only UX: no banners/overlays here.
  }
}
