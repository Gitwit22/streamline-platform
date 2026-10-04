import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { applyCameraCaptureDefault, patchScreenShareDefaults } from "../../lib/captureDefaults";
import { captureResolutionForPreset } from "../../lib/mediaPresetLabels";

/**
 * Applies media capture defaults inside a LiveKitRoom.
 *
 * 1. Screen share: the ControlBar / VideoConference prefabs cannot pass
 *    captureOptions, so enabling screen share without options gets the
 *    1080p30 + system/tab audio defaults (the mixer's screenShareBus needs
 *    audio). Disabling (HostControlsEnforcer) is untouched.
 * 2. Camera: when the host's effective preset becomes known after connect
 *    (owner default hydration) and needs 1080p capture, update the room's
 *    capture defaults and restart a published 720p camera at 1080p.
 */
export default function CaptureDefaultsSync({ presetId, isPublisher }: { presetId?: string | null; isPublisher: boolean }) {
  const room = useRoomContext();
  const appliedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!room || !isPublisher) return;
    return patchScreenShareDefaults(room.localParticipant);
  }, [room, isPublisher]);

  useEffect(() => {
    if (!room || !isPublisher) return;
    const key = captureResolutionForPreset(presetId);
    const apply = () => {
      if (appliedKeyRef.current === key) return;
      applyCameraCaptureDefault(room, key);
      appliedKeyRef.current = key;
    };
    if (room.state === "connected") apply();
    room.on(RoomEvent.Connected, apply);
    return () => {
      room.off(RoomEvent.Connected, apply);
    };
  }, [room, presetId, isPublisher]);

  return null;
}
