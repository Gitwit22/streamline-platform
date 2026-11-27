import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track, type Participant, type TrackPublication } from "livekit-client";
import { backgroundImageFor, cameraEffectStore } from "../../lib/cameraEffects";
import { createCameraEffectApplier, type ProcessableTrack, type ProcessorModule } from "../../lib/cameraEffectApplier";

function selectionKey(): string {
  const s = cameraEffectStore.getSnapshot();
  return `${s.effect.mode}|${s.effect.imageId || ""}|${s.customImage ? s.customImage.length + s.customImage.slice(-32) : ""}`;
}

// Loaded only when someone picks an effect: keeps MediaPipe out of the main bundle.
const loadProcessors = () => import("@livekit/track-processors") as unknown as Promise<ProcessorModule>;

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
      loadModule: loadProcessors,
      // Self-hosted copy (scripts/copy-mediapipe-wasm.cjs) instead of cdn.jsdelivr.net.
      baseOptions: { assetPaths: { tasksVisionFileSet: new URL("/mediapipe/wasm", window.location.origin).href } },
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
    // Only a new selection triggers a run; status updates (which the run
    // itself emits) must not, or applying would loop.
    let lastKey = selectionKey();
    const unsubscribe = cameraEffectStore.subscribe(() => {
      const key = selectionKey();
      if (key === lastKey) return;
      lastKey = key;
      void apply();
    });
    void apply();
    return () => {
      room.off(RoomEvent.LocalTrackPublished, onCamera);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
      unsubscribe();
    };
  }, [room]);

  return null;
}
