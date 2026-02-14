import React, { useEffect, useMemo, useRef, useState } from "react";
import { VideoConference, useRoomContext } from "@livekit/components-react";
import { RoomEvent, Track } from "livekit-client";

type VideoConferenceProps = React.ComponentProps<typeof VideoConference>;

function isLiveKitTileArrayTransientError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? "");
  return msg.includes("Element not part of the array:");
}

class LiveKitTileArrayGuard extends React.Component<
  { versionKey: string; conferenceProps: VideoConferenceProps; fallback?: React.ReactNode },
  { hasError: boolean; error?: unknown; attempt: number; retryCount: number; retryWindowStartMs: number }
> {
  constructor(props: { versionKey: string; conferenceProps: VideoConferenceProps; fallback?: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      error: undefined,
      attempt: 0,
      retryCount: 0,
      retryWindowStartMs: Date.now(),
    };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error } as any;
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const transient = isLiveKitTileArrayTransientError(error);
    console.warn("[SafeVideoConference] VideoConference crashed", {
      transient,
      message: String((error as any)?.message ?? error ?? ""),
      componentStack: info?.componentStack,
    });

    if (!transient) return;

    const now = Date.now();
    const WINDOW_MS = 5000;
    const MAX_RETRIES = 3;

    const windowStart = this.state.retryWindowStartMs;
    const inWindow = now - windowStart <= WINDOW_MS;
    const nextRetryCount = inWindow ? this.state.retryCount + 1 : 1;
    const nextWindowStart = inWindow ? windowStart : now;

    if (nextRetryCount > MAX_RETRIES) {
      return;
    }

    // Immediately remount the VideoConference with a new key.
    this.setState((prev) => ({
      hasError: false,
      error: undefined,
      attempt: prev.attempt + 1,
      retryCount: nextRetryCount,
      retryWindowStartMs: nextWindowStart,
    }));
  }

  componentDidUpdate(prevProps: { versionKey: string }) {
    // If the underlying room track membership changes, force a clean remount.
    if (prevProps.versionKey !== this.props.versionKey) {
      if (this.state.hasError) {
        this.setState({ hasError: false, error: undefined });
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ maxWidth: 540, padding: 16, textAlign: "center" }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Live room UI hit an error</div>
              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Try toggling screen share again or refresh the page.
              </div>
              <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }}>
                {String((this.state.error as any)?.message ?? this.state.error ?? "")}
              </div>
            </div>
          </div>
        )
      );
    }

    const key = `${this.state.attempt}:${this.props.versionKey}`;
    return <VideoConference key={key} {...this.props.conferenceProps} />;
  }
}

export default function SafeVideoConference(props: VideoConferenceProps) {
  const room = useRoomContext();
  const [version, setVersion] = useState(0);
  const bumpQueued = useRef(false);

  useEffect(() => {
    if (!room) return;

    const bump = () => {
      if (bumpQueued.current) return;
      bumpQueued.current = true;
      queueMicrotask(() => {
        bumpQueued.current = false;
        setVersion((v) => v + 1);
      });
    };

    const onTrackChange = (pubOrTrack: any) => {
      const source = pubOrTrack?.source ?? pubOrTrack?.publication?.source;
      if (source === Track.Source.Camera || source === Track.Source.ScreenShare) {
        bump();
      }
    };

    const onParticipantChange = () => bump();

    room.on(RoomEvent.TrackPublished, onTrackChange as any);
    room.on(RoomEvent.TrackUnpublished, onTrackChange as any);
    room.on(RoomEvent.TrackSubscribed, onTrackChange as any);
    room.on(RoomEvent.TrackUnsubscribed, onTrackChange as any);
    room.on(RoomEvent.LocalTrackPublished, onTrackChange as any);
    room.on(RoomEvent.LocalTrackUnpublished, onTrackChange as any);

    room.on(RoomEvent.ParticipantConnected, onParticipantChange as any);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantChange as any);

    return () => {
      room.off(RoomEvent.TrackPublished, onTrackChange as any);
      room.off(RoomEvent.TrackUnpublished, onTrackChange as any);
      room.off(RoomEvent.TrackSubscribed, onTrackChange as any);
      room.off(RoomEvent.TrackUnsubscribed, onTrackChange as any);
      room.off(RoomEvent.LocalTrackPublished, onTrackChange as any);
      room.off(RoomEvent.LocalTrackUnpublished, onTrackChange as any);

      room.off(RoomEvent.ParticipantConnected, onParticipantChange as any);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantChange as any);
    };
  }, [room]);

  const versionKey = useMemo(() => String(version), [version]);

  return <LiveKitTileArrayGuard versionKey={versionKey} conferenceProps={props} />;
}
