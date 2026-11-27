import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track, type Participant, type TrackPublication } from "livekit-client";
import { backgroundImageFor, cameraEffectStore } from "../../lib/cameraEffects";
import {
  createCameraEffectApplier,
  defaultProcessorBaseOptions,
  loadBackgroundProcessors,
  type ProcessableTrack,
} from "../../lib/cameraEffectApplier";

/**
 * Keeps the local camera track in sync with the selected background effect.
 * Mounted once inside <LiveKitRoom>; renders nothing.
 */
export default function CameraEffectController() {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    const apply = createCameraEffectApplier({
      getTrack: () => {
        const track = room.localParticipant?.getTrackPublication(Track.Source.Camera)?.track;
        return (track as unknown as ProcessableTrack) || null;
      },
      getDesired: () => {
        const s = cameraEffectStore.getSnapshot();
        return { effect: s.effect, imageUrl: backgroundImageFor(s.effect, s.customImage) };
      },
      loadModule: loadBackgroundProcessors,
      baseOptions: defaultProcessorBaseOptions(),
      onApplying: () => cameraEffectStore.setStatus({ state: "applying" }),
      onApplied: () => cameraEffectStore.setStatus({ state: "idle" }),
      onFail: (message) => cameraEffectStore.fail(message),
    });

    const onCamera = (pub: TrackPublication) => {
      if (pub?.source === Track.Source.Camera) void apply();
    };
    const onUnmuted = (pub: TrackPublication, participant: Participant) => {
      if (participant === room.localParticipant) onCamera(pub);
    };
    room.on(RoomEvent.LocalTrackPublished, onCamera);
    room.on(RoomEvent.TrackUnmuted, onUnmuted);
    // Only a new selection triggers a run (status updates would loop).
    const unsubscribe = cameraEffectStore.subscribeSelection(() => void apply());
    void apply();
    return () => {
      room.off(RoomEvent.LocalTrackPublished, onCamera);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
      unsubscribe();
    };
  }, [room]);

  return null;
}
