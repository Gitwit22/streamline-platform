import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { getVideoDeck } from "../hooks/useVideoDeck";
import type { StagePublisher } from "../../lib/mediaVideo";
import { publishCapabilities, publishOutput, type LkRoom } from "../../lib/mediaOutputs";

/**
 * Connects the tab's video playlist (lib/mediaVideo.ts) to the LiveKit room:
 * videos play in the local participant's own video box or on stage
 * (lib/mediaOutputs.ts). Unmounting (leaving the room) ends playback and
 * restores the camera.
 */
export default function MediaVideoBridge() {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;
    const deck = getVideoDeck();
    const lkRoom = room as unknown as LkRoom;

    const publisher: StagePublisher = {
      capabilities: () => publishCapabilities(lkRoom.localParticipant),
      isScreenSharing: () => !!room.localParticipant?.isScreenShareEnabled,
      publish: (target, video, audio, onStopped) => publishOutput(lkRoom, target, video, audio, onStopped),
    };

    deck.attachPublisher(publisher);
    // Promotion / demotion / host controls change what may be published.
    const refresh = () => deck.refreshCapabilities();
    room.on(RoomEvent.ParticipantPermissionsChanged, refresh);
    room.on(RoomEvent.Connected, refresh);
    return () => {
      room.off(RoomEvent.ParticipantPermissionsChanged, refresh);
      room.off(RoomEvent.Connected, refresh);
      deck.detachPublisher(publisher);
    };
  }, [room]);

  return null;
}
