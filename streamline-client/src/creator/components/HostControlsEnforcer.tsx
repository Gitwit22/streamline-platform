import React from "react";
import { useLocalParticipantPermissions, useParticipants, useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";

// livekit.TrackSource protocol enum values (ParticipantPermission.canPublishSources).
const TRACK_SOURCE_ENUM: Record<string, number> = {
  [Track.Source.Camera]: 1,
  [Track.Source.Microphone]: 2,
  [Track.Source.ScreenShare]: 3,
  [Track.Source.ScreenShareAudio]: 4,
};

export type PublishPermissionState = {
  /** null until LiveKit has reported permissions for the local participant. */
  canPublish: boolean | null;
  canPublishAudio: boolean;
  canPublishVideo: boolean;
  canScreenShare: boolean;
};

function sourceAllowed(perms: any, source: Track.Source): boolean {
  if (!perms) return true;
  if (perms.canPublish === false) return false;
  const list: unknown[] = Array.isArray(perms.canPublishSources) ? perms.canPublishSources : [];
  if (list.length === 0) return true; // empty == all sources allowed
  const n = TRACK_SOURCE_ENUM[source];
  return list.some((s) => s === n || String(s).toLowerCase() === String(source).toLowerCase());
}

/**
 * Makes host controls actually take effect on this client:
 *  - audioBlocked (canPublishAudio=false / forcedMute / mute lock) turns the
 *    mic off and keeps it off if the user (or a stale UI) re-enables it
 *  - videoBlocked (forcedVideoOff / canPublishVideo=false) does the same for
 *    the camera; screenBlocked for screen share
 *  - reacts live to LiveKit permission changes: a demoted participant's
 *    tracks are unpublished, a promoted viewer can publish without reload
 *
 * The server enforces the same restrictions via LiveKit permissions; this
 * keeps the local UI/track state consistent with them.
 */
export function HostControlsEnforcer({
  audioBlocked,
  videoBlocked,
  screenBlocked,
  onPublishPermissionChange,
}: {
  audioBlocked: boolean;
  videoBlocked: boolean;
  screenBlocked: boolean;
  onPublishPermissionChange?: (state: PublishPermissionState) => void;
}) {
  const room = useRoomContext();
  const permissions = useLocalParticipantPermissions();

  const effAudioBlocked = audioBlocked || (!!permissions && !sourceAllowed(permissions, Track.Source.Microphone));
  const effVideoBlocked = videoBlocked || (!!permissions && !sourceAllowed(permissions, Track.Source.Camera));
  const effScreenBlocked = screenBlocked || (!!permissions && !sourceAllowed(permissions, Track.Source.ScreenShare));

  const blockedRef = React.useRef({ audio: effAudioBlocked, video: effVideoBlocked, screen: effScreenBlocked });
  blockedRef.current = { audio: effAudioBlocked, video: effVideoBlocked, screen: effScreenBlocked };

  // Report permission state upward (drives viewer banner / LiveKitRoom props).
  const canPublish = permissions ? permissions.canPublish !== false : null;
  const canPublishAudio = permissions ? sourceAllowed(permissions, Track.Source.Microphone) : true;
  const canPublishVideo = permissions ? sourceAllowed(permissions, Track.Source.Camera) : true;
  const canScreenShare = permissions ? sourceAllowed(permissions, Track.Source.ScreenShare) : true;
  React.useEffect(() => {
    onPublishPermissionChange?.({ canPublish, canPublishAudio, canPublishVideo, canScreenShare });
  }, [canPublish, canPublishAudio, canPublishVideo, canScreenShare, onPublishPermissionChange]);

  // Apply blocks whenever they change.
  React.useEffect(() => {
    const lp = room?.localParticipant;
    if (!lp) return;
    if (effAudioBlocked && lp.isMicrophoneEnabled) {
      lp.setMicrophoneEnabled(false).catch(() => {});
    }
  }, [room, effAudioBlocked]);

  React.useEffect(() => {
    const lp = room?.localParticipant;
    if (!lp) return;
    if (effVideoBlocked && lp.isCameraEnabled) {
      lp.setCameraEnabled(false).catch(() => {});
    }
  }, [room, effVideoBlocked]);

  React.useEffect(() => {
    const lp = room?.localParticipant;
    if (!lp) return;
    if (effScreenBlocked && lp.isScreenShareEnabled) {
      lp.setScreenShareEnabled(false).catch(() => {});
    }
  }, [room, effScreenBlocked]);

  // Demotion: once publishing is revoked entirely, unpublish everything so no
  // stale track lingers (LiveKit may otherwise just leave it muted).
  const prevCanPublishRef = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    const prev = prevCanPublishRef.current;
    prevCanPublishRef.current = canPublish;
    const lp: any = room?.localParticipant;
    if (!lp || canPublish !== false || prev === false) return;
    const pubs: any[] = Array.from(lp.trackPublications?.values?.() ?? []);
    for (const pub of pubs) {
      const track = pub?.track;
      if (!track) continue;
      try {
        void lp.unpublishTrack(track, true);
      } catch {
        // ignore
      }
    }
  }, [room, canPublish]);

  // Re-apply blocks if something re-enables a blocked source.
  React.useEffect(() => {
    if (!room) return;
    const lp = room.localParticipant;
    const recheck = (pubOrTrack: any) => {
      const source = pubOrTrack?.source ?? pubOrTrack?.track?.source;
      const b = blockedRef.current;
      if (b.audio && source === Track.Source.Microphone && lp.isMicrophoneEnabled) {
        lp.setMicrophoneEnabled(false).catch(() => {});
      }
      if (b.video && source === Track.Source.Camera && lp.isCameraEnabled) {
        lp.setCameraEnabled(false).catch(() => {});
      }
      if (b.screen && source === Track.Source.ScreenShare && lp.isScreenShareEnabled) {
        lp.setScreenShareEnabled(false).catch(() => {});
      }
    };
    const onUnmuted = (pub: any, participant: any) => {
      if (participant && participant !== lp) return;
      recheck(pub);
    };
    room.on(RoomEvent.LocalTrackPublished, recheck as any);
    room.on(RoomEvent.TrackUnmuted, onUnmuted as any);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, recheck as any);
      room.off(RoomEvent.TrackUnmuted, onUnmuted as any);
    };
  }, [room]);

  return null;
}

function parseMetadata(raw: unknown): any {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Hides tiles of participants the host set tileVisible=false for.
 *
 * The server mirrors the control into participant metadata (`tileHidden`),
 * so every client knows which tiles to hide. LiveKit's prefab tiles carry no
 * identity attribute, so we tag them (`data-sl-tile-hidden`) by matching the
 * tile's video track to a participant, falling back to the local-participant
 * flag and to a unique display-name match for camera-off placeholder tiles.
 */
export function TileVisibilityEnforcer({
  rootRef,
  hideLocal,
}: {
  rootRef: React.RefObject<HTMLElement | null>;
  hideLocal: boolean;
}) {
  const room = useRoomContext();
  const participants = useParticipants();

  const hidden = React.useMemo(() => {
    const ids = new Set<string>();
    for (const p of participants) {
      const meta = parseMetadata((p as any).metadata);
      if (meta?.tileHidden === true) ids.add(p.identity);
    }
    if (hideLocal && room?.localParticipant?.identity) ids.add(room.localParticipant.identity);
    return ids;
  }, [participants, hideLocal, room]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || !room) return;

    const apply = () => {
      const all: any[] = [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
      const byTrackId = new Map<string, string>();
      const nameCounts = new Map<string, number>();
      const byName = new Map<string, string>();
      for (const p of all) {
        if (!p) continue;
        for (const pub of Array.from((p.trackPublications?.values?.() ?? []) as Iterable<any>)) {
          const mst = pub?.track?.mediaStreamTrack;
          if (mst?.id) byTrackId.set(mst.id, p.identity);
        }
        const name = String(p.name || p.identity || "").trim();
        if (name) {
          nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
          byName.set(name, p.identity);
        }
      }

      root.querySelectorAll<HTMLElement>(".lk-participant-tile").forEach((tile) => {
        // Never hide screen-share tiles through this mechanism.
        if (tile.getAttribute("data-lk-source") === "screen_share") {
          tile.removeAttribute("data-sl-tile-hidden");
          return;
        }
        let identity: string | null = null;
        const video = tile.querySelector("video") as HTMLVideoElement | null;
        const stream = video?.srcObject as MediaStream | null;
        const vt = stream && typeof stream.getVideoTracks === "function" ? stream.getVideoTracks()[0] : null;
        if (vt?.id) identity = byTrackId.get(vt.id) || null;
        if (!identity && tile.getAttribute("data-lk-local-participant") === "true") {
          identity = room.localParticipant?.identity || null;
        }
        if (!identity) {
          const name = tile.querySelector(".lk-participant-name")?.textContent?.trim() || "";
          if (name && nameCounts.get(name) === 1) identity = byName.get(name) || null;
        }
        if (identity && hidden.has(identity)) tile.setAttribute("data-sl-tile-hidden", "true");
        else tile.removeAttribute("data-sl-tile-hidden");
      });
    };

    apply();
    if (hidden.size === 0) {
      // Nothing to hide: clear tags once and skip observing.
      return;
    }
    const obs = new MutationObserver(() => apply());
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [rootRef, room, hidden]);

  return null;
}
