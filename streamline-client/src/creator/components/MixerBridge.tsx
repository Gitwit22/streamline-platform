/**
 * MixerBridge
 *
 * Renders inside <LiveKitRoom> and wires LiveKit audio tracks into the
 * AudioMixer's bus-based gain-node graph.
 *
 * Track → Bus mapping:
 *   - Local microphone       → localMicBus
 *   - Remote participant mic  → guestBus
 *   - Screen-share audio      → screenShareBus
 *
 * Music bus is driven externally (e.g. an MP3 element calling
 * getMixer().connectSource("musicBus", …) directly).
 */

import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track, type RemoteTrackPublication } from "livekit-client";
import { getMixer } from "./AudioMixerModal";

/**
 * Determine which mixer bus an audio track belongs to.
 * Returns null if the track should not be routed through the mixer.
 */
function busForTrack(
  source: Track.Source | undefined,
  isLocal: boolean,
): "localMicBus" | "guestBus" | "screenShareBus" | null {
  if (source === Track.Source.ScreenShareAudio || source === Track.Source.ScreenShare) {
    return "screenShareBus";
  }
  if (source === Track.Source.Microphone) {
    return isLocal ? "localMicBus" : "guestBus";
  }
  // Unknown audio source from a remote participant → guest bus
  if (!isLocal) return "guestBus";
  return null;
}

/**
 * Build a stable key for a connected source so we can disconnect later.
 */
function sourceKey(participantIdentity: string, trackSid: string): string {
  return `${participantIdentity}::${trackSid}`;
}

export default function MixerBridge() {
  const room = useRoomContext();
  const connectedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!room) return;

    const mixer = getMixer();
    const connected = connectedRef.current;

    // ---- helpers --------------------------------------------------------

    const connectTrack = (
      track: { mediaStream?: MediaStream; mediaStreamTrack?: MediaStreamTrack; sid: string; source: Track.Source },
      participantIdentity: string,
      isLocal: boolean,
    ) => {
      // Only audio tracks
      if (!track.mediaStreamTrack || track.mediaStreamTrack.kind !== "audio") return;

      const bus = busForTrack(track.source, isLocal);
      if (!bus) return;

      // Build a MediaStream from the raw track if one isn't already present
      const stream =
        track.mediaStream && track.mediaStream.getAudioTracks().length > 0
          ? track.mediaStream
          : new MediaStream([track.mediaStreamTrack]);

      const key = sourceKey(participantIdentity, track.sid);
      mixer.connectSource(bus, key, stream);
      connected.add(key);
    };

    const disconnectTrack = (trackSid: string, participantIdentity: string) => {
      const key = sourceKey(participantIdentity, trackSid);
      if (connected.has(key)) {
        mixer.disconnectSource(key);
        connected.delete(key);
      }
    };

    // ---- wire existing tracks that are already subscribed ---------------

    const wireExisting = () => {
      // Local participant
      const lp = room.localParticipant;
      if (lp) {
        for (const pub of lp.audioTrackPublications.values()) {
          if (pub.track) {
            connectTrack(pub.track as any, lp.identity, true);
          }
        }
      }

      // Remote participants
      for (const rp of room.remoteParticipants.values()) {
        for (const pub of rp.audioTrackPublications.values()) {
          if (pub.isSubscribed && pub.track) {
            connectTrack(pub.track as any, rp.identity, false);
          }
        }
      }
    };

    wireExisting();

    // ---- event handlers -------------------------------------------------

    const onTrackSubscribed = (track: any, publication: RemoteTrackPublication, participant: any) => {
      if (track.kind !== "audio") return;
      connectTrack(track, participant.identity, false);
    };

    const onTrackUnsubscribed = (track: any, publication: RemoteTrackPublication, participant: any) => {
      disconnectTrack(track.sid, participant.identity);
    };

    const onLocalTrackPublished = (publication: any) => {
      const track = publication.track;
      if (!track || track.kind !== "audio") return;
      connectTrack(track as any, room.localParticipant.identity, true);
    };

    const onLocalTrackUnpublished = (publication: any) => {
      const track = publication.track;
      if (!track) return;
      disconnectTrack(track.sid, room.localParticipant.identity);
    };

    const onParticipantDisconnected = (participant: any) => {
      // Disconnect all sources for this participant
      const prefix = `${participant.identity}::`;
      for (const key of [...connected]) {
        if (key.startsWith(prefix)) {
          mixer.disconnectSource(key);
          connected.delete(key);
        }
      }
    };

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

    return () => {
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, onLocalTrackUnpublished);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected);

      // Disconnect all sources on unmount
      for (const key of connected) {
        mixer.disconnectSource(key);
      }
      connected.clear();
    };
  }, [room]);

  // This component only manages side effects; no UI.
  return null;
}
