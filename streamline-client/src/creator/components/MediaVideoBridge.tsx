import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { AudioPresets, RoomEvent, Track, type LocalTrackPublication } from "livekit-client";
import { getVideoDeck } from "../hooks/useVideoDeck";
import type { StageHandle, StagePublisher } from "../../lib/mediaVideo";

/**
 * Connects the tab's stage-video deck (lib/mediaVideo.ts) to the LiveKit room:
 * a stage video is published as the local participant's screen share, so
 * layouts, the program stage and every output show it like any screen share.
 * Unmounting (leaving the room) takes the video off stage.
 */
export default function MediaVideoBridge() {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    const deck = getVideoDeck();

    const publisher: StagePublisher = {
      isScreenSharing: () => !!room.localParticipant?.isScreenShareEnabled,

      async publish(video, audio, onStopped): Promise<StageHandle> {
        const lp = room.localParticipant;
        const pubs: LocalTrackPublication[] = [];
        let selfStopping = false;

        const unpublishAll = async () => {
          selfStopping = true;
          room.off(RoomEvent.LocalTrackUnpublished, onUnpublished);
          // splice: a second call (idempotent unpublish) finds nothing left.
          for (const p of pubs.splice(0)) {
            if (!p.track) continue;
            try {
              await lp.unpublishTrack(p.track, true);
            } catch {
              // already gone (disconnect)
            }
          }
          video.stop();
          audio?.stop();
        };

        // Something else removed one of our tracks (control bar "Stop
        // sharing", host controls, disconnect): remove the rest and report.
        const onUnpublished = (pub: LocalTrackPublication) => {
          if (selfStopping || !pubs.some((p) => p === pub || p.trackSid === pub.trackSid)) return;
          void unpublishAll();
          onStopped();
        };

        try {
          pubs.push(
            await lp.publishTrack(video, {
              source: Track.Source.ScreenShare,
              name: "stage-video",
              degradationPreference: "maintain-framerate",
            }),
          );
          if (audio) {
            pubs.push(
              await lp.publishTrack(audio, {
                source: Track.Source.ScreenShareAudio,
                name: "stage-video-audio",
                audioPreset: AudioPresets.musicHighQualityStereo,
                dtx: false,
                red: false,
              }),
            );
          }
        } catch (e) {
          await unpublishAll();
          throw e;
        }
        room.on(RoomEvent.LocalTrackUnpublished, onUnpublished);
        return { unpublish: unpublishAll };
      },
    };

    deck.attachPublisher(publisher);
    return () => deck.detachPublisher(publisher);
  }, [room]);

  return null;
}
