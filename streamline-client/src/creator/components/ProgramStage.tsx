/**
 * ProgramStage — the in-room stage that shows the live program layout
 * (programState v2) to everyone in the room: host, guests and viewers.
 *
 * - ProgramStateProvider reads programState from LiveKit room metadata
 *   (RoomMetadataChanged), with an initial GET since metadata may be empty,
 *   and lets the layout picker apply changes optimistically.
 * - ProgramStage renders the landscape layout in a letterboxed 16:9 box using
 *   the same resolution algorithm as the egress compositor (programResolve).
 * - A local, per-user "Gallery" toggle falls back to LiveKit's prefab
 *   VideoConference (SafeVideoConference).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ControlBar,
  ParticipantTile,
  RoomAudioRenderer,
  useRoomContext,
  useRoomInfo,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { RoomEvent, Track, type Participant } from "livekit-client";
import { apiGetProgramState, apiUpdateProgramState } from "../../lib/api";
import {
  buildOrientationLayout,
  portraitFor,
  suggestPreset,
  type OrientationLayout,
  type ProgramStateV2,
  type ProgramStateV2Patch,
  type ScreenShareMode,
} from "../../lib/programPresets";
import {
  isEligible,
  normalizeProgramState,
  programStateFromRoomMetadata,
  resolveProgram,
  type ProgramResolution,
  type ResolveParticipant,
} from "../../lib/programResolve";
import SafeVideoConference from "./SafeVideoConference";
import type { ScreenShareRouteMode } from "./ScreenShareRouter";

// ---------------------------------------------------------------------------
// Live participants -> resolver input
// ---------------------------------------------------------------------------

const PARTICIPANT_EVENTS: RoomEvent[] = [
  RoomEvent.Connected,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantMetadataChanged,
  RoomEvent.ParticipantPermissionsChanged,
  RoomEvent.ParticipantNameChanged,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
];

type RoomLike = { localParticipant?: Participant; remoteParticipants?: Map<string, Participant> } | null | undefined;

function allParticipants(room: RoomLike): Participant[] {
  if (!room) return [];
  const list: Participant[] = [];
  if (room.localParticipant) list.push(room.localParticipant);
  for (const p of Array.from(room.remoteParticipants?.values() ?? [])) list.push(p);
  return list;
}

/**
 * Snapshot of the room's participants as resolver input. `seen` records the
 * first time each screen-share publication was observed (publish-order proxy;
 * LiveKit does not expose a publish timestamp to clients).
 */
function snapshotParticipants(room: RoomLike, seen: Map<string, number>): ResolveParticipant[] {
  const live = new Set<string>();
  const now = Date.now();
  const out = allParticipants(room).map((p): ResolveParticipant => {
    const cam = p.getTrackPublication(Track.Source.Camera);
    const scr = p.getTrackPublication(Track.Source.ScreenShare);
    let screenPublishedAt: number | null = null;
    if (scr) {
      const key = `${p.identity}:${scr.trackSid}`;
      live.add(key);
      if (!seen.has(key)) seen.set(key, now);
      screenPublishedAt = seen.get(key) ?? null;
    }
    return {
      identity: p.identity,
      name: p.name || p.identity,
      metadata: p.metadata ?? null,
      isAgent: !!p.isAgent,
      joinedAt: p.joinedAt ? p.joinedAt.getTime() : null,
      canPublish: p.permissions?.canPublish,
      hasCamera: !!cam,
      hasScreen: !!scr,
      screenPublishedAt,
    };
  });
  for (const key of Array.from(seen.keys())) if (!live.has(key)) seen.delete(key);
  return out;
}

/** Live resolver input; updates on participant/track/permission changes. */
export function useProgramParticipants(): ResolveParticipant[] {
  const room = useRoomContext();
  const [seen] = useState(() => new Map<string, number>());
  const [snapshot, setSnapshot] = useState<ResolveParticipant[]>(() => snapshotParticipants(room, seen));

  useEffect(() => {
    if (!room) return;
    const emitter = room as unknown as {
      on: (ev: RoomEvent, fn: () => void) => void;
      off: (ev: RoomEvent, fn: () => void) => void;
    };
    let active = true;
    const update = () => {
      if (active) setSnapshot(snapshotParticipants(room, seen));
    };
    for (const ev of PARTICIPANT_EVENTS) emitter.on(ev, update);
    queueMicrotask(update);
    return () => {
      active = false;
      for (const ev of PARTICIPANT_EVENTS) emitter.off(ev, update);
    };
  }, [room, seen]);

  return snapshot;
}

// ---------------------------------------------------------------------------
// Program state context
// ---------------------------------------------------------------------------

type ProgramStateContextValue = {
  /** Effective state (optimistic local change or latest from server). */
  state: ProgramStateV2 | null;
  loaded: boolean;
  saving: boolean;
  error: string | null;
  canLayout: boolean;
  participants: ResolveParticipant[];
  /** Applies a change (optimistic for this client; others get it via metadata). */
  apply: (change: { landscapeId?: string; portraitId?: string; screenShareMode?: ScreenShareMode }) => Promise<void>;
  /** True when the portrait preset was chosen explicitly (not portraitFor). */
  portraitExplicit: boolean;
};

const ProgramStateContext = createContext<ProgramStateContextValue | null>(null);

export function useProgramState(): ProgramStateContextValue | null {
  return useContext(ProgramStateContext);
}

export function ProgramStateProvider({
  roomId,
  roomAccessToken,
  canLayout,
  isHost,
  screenShareRouteMode,
  screenShareRouteNonce,
  children,
}: {
  roomId: string | null;
  roomAccessToken: string | null;
  canLayout: boolean;
  isHost: boolean;
  screenShareRouteMode?: ScreenShareRouteMode;
  /** Bumped when the user changes the screen-share route (not on sync). */
  screenShareRouteNonce?: number;
  children: React.ReactNode;
}) {
  const room = useRoomContext();
  const { metadata } = useRoomInfo();
  const participants = useProgramParticipants();
  const [server, setServer] = useState<ProgramStateV2 | null>(null);
  const [optimistic, setOptimistic] = useState<ProgramStateV2 | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef(0);
  const gotMetadataRef = useRef(false);

  // Room metadata is the live source of truth for everyone.
  useEffect(() => {
    const fromMeta = programStateFromRoomMetadata(metadata);
    if (fromMeta) {
      gotMetadataRef.current = true;
      setServer(fromMeta);
      setLoaded(true);
    }
  }, [metadata]);

  // Initial GET (room metadata may be empty until the first PATCH).
  useEffect(() => {
    if (!roomId || !roomAccessToken) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGetProgramState(roomId, roomAccessToken);
        const s = normalizeProgramState(data?.programState ?? null);
        if (!cancelled && s && !gotMetadataRef.current) setServer((prev) => prev ?? s);
      } catch {
        // keep whatever metadata provides
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, roomAccessToken]);

  const state = optimistic ?? server;
  const stateRef = useRef(state);
  const participantsRef = useRef(participants);
  useEffect(() => {
    stateRef.current = state;
    participantsRef.current = participants;
  }, [state, participants]);

  const portraitExplicit = !!state && state.portrait?.presetId !== portraitFor(state.landscape?.presetId);

  const apply = useCallback<ProgramStateContextValue["apply"]>(
    async (change) => {
      if (!roomId || !roomAccessToken) return;
      const cur = stateRef.current;
      const eligibleCount = participantsRef.current.filter(isEligible).length;
      const landscape: OrientationLayout | null = change.landscapeId
        ? buildOrientationLayout(change.landscapeId, "landscape")
        : cur?.landscape ?? buildOrientationLayout(suggestPreset(eligibleCount, "landscape"), "landscape");
      if (!landscape) return;
      const explicitNow = !!cur && cur.portrait?.presetId !== portraitFor(cur.landscape?.presetId);
      let portrait: OrientationLayout | undefined;
      if (change.portraitId) portrait = buildOrientationLayout(change.portraitId, "portrait") ?? undefined;
      else if (explicitNow && cur?.portrait) portrait = cur.portrait;
      const screenShareMode: ScreenShareMode = change.screenShareMode ?? cur?.screenShareMode ?? "auto";

      const patch: ProgramStateV2Patch = { version: 2, landscape, screenShareMode, ...(portrait ? { portrait } : {}) };
      const derivedPortrait = portrait ?? buildOrientationLayout(portraitFor(landscape.presetId), "portrait");
      if (!derivedPortrait) return;
      const opt: ProgramStateV2 = {
        version: 2,
        landscape,
        portrait: derivedPortrait,
        screenShareMode,
        hostIdentity: cur?.hostIdentity ?? (isHost ? room?.localParticipant?.identity ?? null : null),
        updatedAt: Date.now(),
      };

      pendingRef.current += 1;
      setOptimistic(opt);
      setSaving(true);
      setError(null);
      try {
        const res = await apiUpdateProgramState(roomId, roomAccessToken, patch);
        const confirmed = normalizeProgramState(res?.programState ?? null);
        setServer(confirmed ?? opt);
      } catch (err) {
        console.error("[ProgramStage] Failed to update program state", err);
        setError("Couldn't apply the layout. Try again.");
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current <= 0) {
          pendingRef.current = 0;
          setOptimistic(null);
          setSaving(false);
        }
      }
    },
    [roomId, roomAccessToken, isHost, room],
  );

  // Screen-share route control (Off / Main / Pop-out) maps onto screenShareMode.
  const lastNonceRef = useRef(screenShareRouteNonce ?? 0);
  useEffect(() => {
    const nonce = screenShareRouteNonce ?? 0;
    if (nonce === lastNonceRef.current) return;
    lastNonceRef.current = nonce;
    if (!canLayout || !screenShareRouteMode) return;
    void apply({ screenShareMode: screenShareRouteMode === "main" ? "auto" : "manual" });
  }, [screenShareRouteNonce, screenShareRouteMode, canLayout, apply]);

  const value = useMemo<ProgramStateContextValue>(
    () => ({ state, loaded, saving, error, canLayout, participants, apply, portraitExplicit }),
    [state, loaded, saving, error, canLayout, participants, apply, portraitExplicit],
  );

  return <ProgramStateContext.Provider value={value}>{children}</ProgramStateContext.Provider>;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

const VIEW_KEY = "sl_stage_view";

function readView(): "program" | "gallery" {
  try {
    return localStorage.getItem(VIEW_KEY) === "gallery" ? "gallery" : "program";
  } catch {
    return "program";
  }
}

function useFittedBox(aspect: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      let width = W;
      let height = W / aspect;
      if (height > H) {
        height = H;
        width = H * aspect;
      }
      setBox({ left: (W - width) / 2, top: (H - height) / 2, width, height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);
  return { ref, box };
}

function trackRefFor(room: RoomLike, identity: string, track: "camera" | "screen"): TrackReferenceOrPlaceholder | null {
  const participant: Participant | undefined = allParticipants(room).find((p) => p.identity === identity);
  if (!participant) return null;
  const source = track === "screen" ? Track.Source.ScreenShare : Track.Source.Camera;
  const publication = participant.getTrackPublication(source);
  if (publication) return { participant, publication, source };
  return { participant, source };
}

function StageCanvas({ resolution }: { resolution: ProgramResolution }) {
  const room = useRoomContext();
  return (
    <>
      {resolution.slots.map((r) => {
        const ref = r.identity && r.track ? trackRefFor(room, r.identity, r.track) : null;
        return (
          <div
            key={r.slot.id}
            className="sl-stage-slot"
            data-slot-id={r.slot.id}
            data-identity={r.identity ?? ""}
            data-track={r.track ?? ""}
            data-fit={r.fit}
            data-label={r.label ? "true" : "false"}
            style={{
              position: "absolute",
              left: `${r.slot.x * 100}%`,
              top: `${r.slot.y * 100}%`,
              width: `${r.slot.w * 100}%`,
              height: `${r.slot.h * 100}%`,
              zIndex: r.slot.z ?? 1,
            }}
          >
            {ref ? (
              <ParticipantTile
                key={`${r.identity}:${r.track}`}
                trackRef={ref}
                style={{ width: "100%", height: "100%" }}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export default function ProgramStage() {
  const ctx = useProgramState();
  const participants = useMemo(() => ctx?.participants ?? [], [ctx?.participants]);
  const state = ctx?.state ?? null;
  const [view, setView] = useState<"program" | "gallery">(readView);
  const { ref, box } = useFittedBox(16 / 9);

  const toggleView = () => {
    setView((v) => {
      const next = v === "program" ? "gallery" : "program";
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  };

  const resolution = useMemo(
    () => resolveProgram({ state, participants, orientation: "landscape" }),
    [state, participants],
  );

  const toggle = (
    <button
      type="button"
      className="sl-stage-view-toggle"
      data-testid="stage-view-toggle"
      onClick={toggleView}
      title={view === "program" ? "Show everyone in a gallery grid (only for you)" : "Show the live program layout"}
    >
      {view === "program" ? "Gallery" : "Program view"}
    </button>
  );

  if (view === "gallery") {
    return (
      <div className="sl-gallery-stage" style={{ width: "100%", height: "100%", position: "relative" }}>
        <SafeVideoConference />
        {toggle}
      </div>
    );
  }

  return (
    <div className="sl-stage-root" data-testid="program-stage">
      <div className="sl-stage-area" ref={ref}>
        <div
          className="sl-stage-canvas"
          data-testid="program-canvas"
          data-preset={resolution.presetId}
          data-screen-override={resolution.screenOverride ? "true" : "false"}
          data-fallback-grid={resolution.fallbackGrid ? "true" : "false"}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          <StageCanvas resolution={resolution} />
          {resolution.slots.length === 0 && <div className="sl-stage-empty">Waiting for participants…</div>}
        </div>
        {toggle}
      </div>
      <ControlBar controls={{ chat: false }} />
      <RoomAudioRenderer />
    </div>
  );
}
