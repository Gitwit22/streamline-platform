/**
 * useActiveScreenShare — detects the currently active screen share track in the room.
 * Returns the first screen share publication found (local or remote), or null.
 * Re-scans on every relevant LiveKit track lifecycle event.
 */
import { useState, useEffect, useCallback } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  RoomEvent,
  Track,
  type RemoteTrackPublication,
  type LocalTrackPublication,
  type Participant,
} from "livekit-client";

export interface ActiveScreenShare {
  publication: RemoteTrackPublication | LocalTrackPublication;
  participant: Participant;
  participantName: string;
  isLocal: boolean;
}

export function useActiveScreenShare(): ActiveScreenShare | null {
  const room = useRoomContext();
  const [active, setActive] = useState<ActiveScreenShare | null>(null);

  const scan = useCallback(() => {
    if (!room) {
      setActive(null);
      return;
    }

    const participants: Participant[] = [
      room.localParticipant,
      ...Array.from(room.remoteParticipants.values()),
    ];

    for (const p of participants) {
      for (const pub of p.trackPublications.values()) {
        if (
          pub.source === Track.Source.ScreenShare &&
          pub.track &&
          !pub.isMuted
        ) {
          setActive({
            publication: pub as RemoteTrackPublication | LocalTrackPublication,
            participant: p,
            participantName: p.name || p.identity || "Unknown",
            isLocal: p === room.localParticipant,
          });
          return;
        }
      }
    }

    setActive(null);
  }, [room]);

  useEffect(() => {
    if (!room) return;

    scan();

    const events = [
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.ParticipantDisconnected,
    ];

    for (const evt of events) {
      room.on(evt, scan as any);
    }

    return () => {
      for (const evt of events) {
        room.off(evt, scan as any);
      }
    };
  }, [room, scan]);

  return active;
}
