/**
 * useMixerBroadcast
 *
 * Owns the host's microphone inside the audio mixer and, while "Send mix to
 * stream" is on, swaps the published Microphone track for the mixer's stream
 * output (host mic + music, never guests / screen share). The publication
 * itself is unchanged, so mute, host controls, room audio and every egress
 * output keep working - they simply carry the mix.
 *
 * - The raw mic always feeds localMicBus (key "host-raw-mic"); MixerBridge
 *   skips the local mic so it can't feed the mix back into itself.
 * - Swaps use userProvidedTrack:true in both directions: LiveKit stops the
 *   outgoing track otherwise, which would kill the raw mic or the mixer output.
 * - Re-applies after the mic is republished or restarted (device switch,
 *   media recovery).
 */
import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track, TrackEvent, type LocalAudioTrack } from "livekit-client";
import { getMixer } from "../components/AudioMixerModal";

export const HOST_RAW_MIC_KEY = "host-raw-mic";

export function useMixerBroadcast(): void {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    const mixer = getMixer();
    let rawTrack: MediaStreamTrack | null = null;
    let watched: LocalAudioTrack | null = null;
    let disposed = false;
    let syncing: Promise<void> = Promise.resolve();

    const micTrack = (): LocalAudioTrack | null => {
      const pub = room.localParticipant?.getTrackPublication(Track.Source.Microphone);
      return (pub?.track as LocalAudioTrack | undefined) ?? null;
    };

    const onRestarted = () => schedule();

    const watch = (t: LocalAudioTrack | null) => {
      if (watched === t) return;
      watched?.off(TrackEvent.Restarted, onRestarted);
      watched = t;
      watched?.on(TrackEvent.Restarted, onRestarted);
    };

    const connectRaw = (t: MediaStreamTrack | null) => {
      if (t === rawTrack) return;
      rawTrack = t;
      if (t && mixer.isInitialized()) mixer.connectSource("localMicBus", HOST_RAW_MIC_KEY, new MediaStream([t]));
      else mixer.disconnectSource(HOST_RAW_MIC_KEY);
    };

    const sync = async () => {
      const track = micTrack();
      watch(track);
      const current = track?.mediaStreamTrack ?? null;

      // Any non-mixer track on the publication is the real microphone.
      if (current && !mixer.isMixerOutputTrack(current)) connectRaw(current);
      if (!track || disposed) return;

      const streamTrack = mixer.isInitialized() ? mixer.getStreamAudioTrack() : null;
      const want = mixer.isBroadcasting() && !!streamTrack;
      try {
        if (want && current !== streamTrack) {
          await mixer.resume();
          await track.replaceTrack(streamTrack!, { userProvidedTrack: true });
          // LiveKit mutes by disabling the published track; the raw mic may
          // have been disabled by an earlier mute. Mute now applies to the mix.
          if (rawTrack) rawTrack.enabled = true;
        } else if (!want && current && mixer.isMixerOutputTrack(current) && rawTrack && rawTrack.readyState === "live") {
          await track.replaceTrack(rawTrack, { userProvidedTrack: true });
        }
      } catch (e) {
        console.warn("[mixer] broadcast track swap failed", e);
      }
    };

    // Serialize swaps; events can arrive in bursts.
    const schedule = () => {
      syncing = syncing.then(sync, sync);
    };

    schedule();
    const offBroadcast = mixer.subscribeBroadcast(schedule);
    const offInit = mixer.subscribeInit(() => {
      // Graph (re)created: sources must be connected again.
      const r = rawTrack;
      rawTrack = null;
      connectRaw(r);
      schedule();
    });
    room.on(RoomEvent.LocalTrackPublished, schedule);
    room.on(RoomEvent.LocalTrackUnpublished, schedule);

    return () => {
      disposed = true;
      offBroadcast();
      offInit();
      room.off(RoomEvent.LocalTrackPublished, schedule);
      room.off(RoomEvent.LocalTrackUnpublished, schedule);
      const track = micTrack();
      watch(null);
      // Leaving the room / mixer turned off: put the real mic back.
      const current = track?.mediaStreamTrack ?? null;
      if (track && current && mixer.isMixerOutputTrack(current) && rawTrack && rawTrack.readyState === "live") {
        void track.replaceTrack(rawTrack, { userProvidedTrack: true }).catch(() => {});
      }
      mixer.disconnectSource(HOST_RAW_MIC_KEY);
      mixer.setBroadcasting(false);
    };
  }, [room]);
}
