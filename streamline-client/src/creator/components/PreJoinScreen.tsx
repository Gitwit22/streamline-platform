import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  createAudioAnalyser,
  createLocalAudioTrack,
  createLocalVideoTrack,
  VideoPresets,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from "livekit-client";
import { CameraBackgroundOptions } from "./CameraBackgroundPicker";
import { backgroundImageFor, cameraEffectStore } from "../../lib/cameraEffects";
import {
  createCameraEffectApplier,
  defaultProcessorBaseOptions,
  loadBackgroundProcessors,
  type ProcessableTrack,
} from "../../lib/cameraEffectApplier";
import { classifyMediaDeviceError } from "../../lib/mediaDeviceErrors";
import { availableDeviceId, savePreJoinChoices, type PreJoinChoices } from "../../lib/preJoin";

type Device = { deviceId: string; label: string };

async function listDevices(kind: "videoinput" | "audioinput"): Promise<Device[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === kind && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || (kind === "videoinput" ? `Camera ${i + 1}` : `Microphone ${i + 1}`) }));
}

function errorText(error: unknown, kind: "videoinput" | "audioinput"): string {
  return classifyMediaDeviceError(error, kind)?.message || (kind === "videoinput" ? "Couldn't start your camera." : "Couldn't start your microphone.");
}

/**
 * Device check before entering the room: camera preview with the background
 * effect applied (the same selection the room uses), camera / mic on-off,
 * device pickers and a mic level meter. Nothing is published here; on Join
 * the preview is released and the room publishes with these choices.
 */
export default function PreJoinScreen({
  displayName,
  initialChoices,
  cameraAllowed,
  micAllowed,
  onJoin,
  onBack,
}: {
  displayName: string;
  initialChoices: PreJoinChoices;
  /** False when the room won't let this person publish a camera (host controls). */
  cameraAllowed: boolean;
  micAllowed: boolean;
  onJoin: (choices: PreJoinChoices) => void;
  onBack?: () => void;
}) {
  const [choices, setChoices] = useState<PreJoinChoices>(initialChoices);
  const [videoDevices, setVideoDevices] = useState<Device[]>([]);
  const [audioDevices, setAudioDevices] = useState<Device[]>([]);
  const [activeVideoId, setActiveVideoId] = useState("");
  const [activeAudioId, setActiveAudioId] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  // Device id key of the preview that's showing (null = none yet / stopped).
  const [videoReadyFor, setVideoReadyFor] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [joining, setJoining] = useState(false);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const applyEffectRef = useRef<(() => Promise<void>) | null>(null);

  // Attaches the preview when the <video> mounts (the track may already exist).
  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    videoElRef.current = el;
    if (el && videoTrackRef.current) videoTrackRef.current.attach(el);
  }, []);

  const cameraOn = cameraAllowed && choices.videoEnabled;
  const micOn = micAllowed && choices.audioEnabled;

  // The background effect on the preview, through the same applier the room uses.
  useEffect(() => {
    applyEffectRef.current = createCameraEffectApplier({
      getTrack: () => (videoTrackRef.current as unknown as ProcessableTrack) || null,
      getDesired: () => {
        const snap = cameraEffectStore.getSnapshot();
        return { effect: snap.effect, imageUrl: backgroundImageFor(snap.effect, snap.customImage) };
      },
      loadModule: loadBackgroundProcessors,
      baseOptions: defaultProcessorBaseOptions(),
      onApplying: () => cameraEffectStore.setStatus({ state: "applying" }),
      onApplied: () => cameraEffectStore.setStatus({ state: "idle" }),
      onFail: (message) => cameraEffectStore.fail(message),
    });
    // A preview that started before this ran picks the effect up now.
    void applyEffectRef.current();
    const unsubscribe = cameraEffectStore.subscribeSelection(() => void applyEffectRef.current?.());
    return () => {
      unsubscribe();
      applyEffectRef.current = null;
    };
  }, []);

  // Device lists (labels only appear after permission) and hot-plugging.
  useEffect(() => {
    const refresh = () => {
      listDevices("videoinput").then(setVideoDevices).catch(() => {});
      listDevices("audioinput").then(setAudioDevices).catch(() => {});
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, []);

  // Camera preview.
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let track: LocalVideoTrack | null = null;
    const key = choices.videoDeviceId;
    createLocalVideoTrack({ deviceId: choices.videoDeviceId || undefined, resolution: VideoPresets.h720.resolution })
      .then(async (t) => {
        if (cancelled) {
          t.stop();
          return;
        }
        track = t;
        videoTrackRef.current = t;
        if (videoElRef.current) t.attach(videoElRef.current);
        setActiveVideoId(t.mediaStreamTrack?.getSettings?.().deviceId || "");
        setVideoReadyFor(key);
        listDevices("videoinput").then(setVideoDevices).catch(() => {});
        await applyEffectRef.current?.();
      })
      .catch((err) => {
        if (cancelled) return;
        setVideoError(errorText(err, "videoinput"));
        // Joining with a camera that fails would just fail again in the room.
        setChoices((c) => ({ ...c, videoEnabled: false }));
      });
    return () => {
      cancelled = true;
      if (videoTrackRef.current === track) videoTrackRef.current = null;
      // stop() also tears down the background processor.
      track?.stop();
      setVideoReadyFor(null);
    };
  }, [cameraOn, choices.videoDeviceId]);
  const videoStarting = cameraOn && videoReadyFor !== choices.videoDeviceId && !videoError;

  // Microphone + level meter.
  useEffect(() => {
    if (!micOn) return;
    let cancelled = false;
    let track: LocalAudioTrack | null = null;
    let analyser: ReturnType<typeof createAudioAnalyser> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    createLocalAudioTrack({ deviceId: choices.audioDeviceId || undefined })
      .then((t) => {
        if (cancelled) {
          t.stop();
          return;
        }
        track = t;
        audioTrackRef.current = t;
        setActiveAudioId(t.mediaStreamTrack?.getSettings?.().deviceId || "");
        listDevices("audioinput").then(setAudioDevices).catch(() => {});
        try {
          analyser = createAudioAnalyser(t);
          timer = setInterval(() => setLevel(analyser ? analyser.calculateVolume() : 0), 120);
        } catch {
          // No Web Audio: the mic still works, there's just no meter.
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setAudioError(errorText(err, "audioinput"));
        setChoices((c) => ({ ...c, audioEnabled: false }));
      });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      analyser?.cleanup().catch(() => {});
      if (audioTrackRef.current === track) audioTrackRef.current = null;
      track?.stop();
      setLevel(0);
    };
  }, [micOn, choices.audioDeviceId]);
  const shownLevel = micOn ? level : 0;

  const toggle = (key: "videoEnabled" | "audioEnabled") => {
    if (key === "videoEnabled") setVideoError(null);
    else setAudioError(null);
    setChoices((c) => ({ ...c, [key]: !c[key] }));
  };

  const handleJoin = () => {
    if (joining) return;
    setJoining(true);
    // Release the camera/mic first so the room can open them.
    videoTrackRef.current?.stop();
    audioTrackRef.current?.stop();
    videoTrackRef.current = null;
    audioTrackRef.current = null;
    const final: PreJoinChoices = {
      videoEnabled: cameraOn,
      audioEnabled: micOn,
      videoDeviceId: availableDeviceId(choices.videoDeviceId || activeVideoId, videoDevices),
      audioDeviceId: availableDeviceId(choices.audioDeviceId || activeAudioId, audioDevices),
    };
    savePreJoinChoices(final);
    onJoin(final);
  };

  return (
    <div style={cardStyle} data-testid="prejoin">
      <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0, textAlign: "center" }}>Check your camera and mic</h1>

      <div style={columns}>
        <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
          <div style={previewBox}>
            {cameraOn ? (
              <video
                ref={setVideoEl}
                data-testid="prejoin-preview"
                muted
                playsInline
                autoPlay
                style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
              />
            ) : (
              <div style={previewOff} data-testid="prejoin-camera-off">
                {cameraAllowed ? "Camera is off" : "The host has turned off cameras for guests"}
              </div>
            )}
            {cameraOn && videoStarting && <div style={previewStatus}>Starting camera…</div>}
            <div style={nameTag}>{displayName}</div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="prejoin-toggle-mic"
              aria-pressed={micOn}
              disabled={!micAllowed}
              onClick={() => toggle("audioEnabled")}
              style={toggleBtn(micOn, !micAllowed)}
            >
              {micOn ? "Mic on" : "Mic off"}
            </button>
            <button
              type="button"
              data-testid="prejoin-toggle-camera"
              aria-pressed={cameraOn}
              disabled={!cameraAllowed}
              onClick={() => toggle("videoEnabled")}
              style={toggleBtn(cameraOn, !cameraAllowed)}
            >
              {cameraOn ? "Camera on" : "Camera off"}
            </button>
            <div style={meterTrack} aria-label="Microphone level" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(shownLevel.toFixed(2))}>
              <div style={{ ...meterFill, width: `${Math.min(100, Math.round(shownLevel * 140))}%` }} />
            </div>
          </div>

          {videoError && (
            <div role="alert" style={errBox} data-testid="prejoin-camera-error">
              {videoError}
            </div>
          )}
          {audioError && (
            <div role="alert" style={errBox} data-testid="prejoin-mic-error">
              {audioError}
            </div>
          )}

          <label style={fieldLabel}>
            <span style={labelText}>Camera</span>
            <select
              aria-label="Camera"
              value={choices.videoDeviceId || activeVideoId}
              disabled={!cameraAllowed || videoDevices.length === 0}
              onChange={(e) => {
                setVideoError(null);
                setChoices((c) => ({ ...c, videoDeviceId: e.target.value, videoEnabled: true }));
              }}
              style={selectStyle}
            >
              {videoDevices.length === 0 && <option value="">Default camera</option>}
              {videoDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label style={fieldLabel}>
            <span style={labelText}>Microphone</span>
            <select
              aria-label="Microphone"
              value={choices.audioDeviceId || activeAudioId}
              disabled={!micAllowed || audioDevices.length === 0}
              onChange={(e) => {
                setAudioError(null);
                setChoices((c) => ({ ...c, audioDeviceId: e.target.value, audioEnabled: true }));
              }}
              style={selectStyle}
            >
              {audioDevices.length === 0 && <option value="">Default microphone</option>}
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gap: 8, alignContent: "start", minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Background</div>
          {cameraAllowed ? (
            <CameraBackgroundOptions columns={4} />
          ) : (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Not available while cameras are off for guests.</div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginRight: "auto" }}>
          You can change all of this inside the room too.
        </span>
        {onBack && (
          <button type="button" onClick={onBack} style={secondaryBtn} disabled={joining}>
            Back
          </button>
        )}
        <button type="button" data-testid="prejoin-join" onClick={handleJoin} disabled={joining} style={primaryBtn(joining)}>
          {joining ? "Joining…" : "Join room"}
        </button>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: "rgba(39, 39, 42, 0.6)",
  borderRadius: "1rem",
  padding: "1.5rem",
  width: "100%",
  maxWidth: 920,
  display: "grid",
  gap: "1rem",
  border: "1px solid rgba(63, 63, 70, 0.8)",
  backdropFilter: "blur(20px)",
  position: "relative",
  zIndex: 1,
  color: "#fff",
  boxSizing: "border-box",
};
const columns: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "1.25rem" };
const previewBox: CSSProperties = {
  position: "relative",
  width: "100%",
  aspectRatio: "16 / 9",
  borderRadius: 12,
  overflow: "hidden",
  background: "#0a0a0a",
  border: "1px solid rgba(63,63,70,0.8)",
};
const previewOff: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  padding: 16,
  color: "rgba(255,255,255,0.6)",
  fontSize: 14,
};
const previewStatus: CSSProperties = { ...previewOff, background: "rgba(0,0,0,0.4)" };
const nameTag: CSSProperties = {
  position: "absolute",
  left: 8,
  bottom: 8,
  padding: "3px 8px",
  borderRadius: 6,
  background: "rgba(0,0,0,0.6)",
  fontSize: 12,
  fontWeight: 600,
  maxWidth: "70%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
function toggleBtn(on: boolean, disabled: boolean): CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 999,
    border: on ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(239,68,68,0.55)",
    background: on ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.15)",
    color: on ? "#bbf7d0" : "#fecaca",
    fontSize: 13,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
const meterTrack: CSSProperties = {
  flex: "1 1 120px",
  alignSelf: "center",
  height: 8,
  borderRadius: 999,
  background: "rgba(255,255,255,0.1)",
  overflow: "hidden",
};
const meterFill: CSSProperties = { height: "100%", background: "linear-gradient(90deg,#22c55e,#a3e635)", transition: "width 0.1s linear" };
const fieldLabel: CSSProperties = { display: "grid", gap: 4 };
const labelText: CSSProperties = { fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.65)" };
const selectStyle: CSSProperties = {
  width: "100%",
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid rgba(75,85,99,0.6)",
  background: "rgba(31,41,55,0.85)",
  color: "#fff",
  fontSize: 13,
};
const errBox: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  background: "rgba(239,68,68,0.12)",
  border: "1px solid rgba(239,68,68,0.35)",
  color: "#fca5a5",
  fontSize: 12.5,
  lineHeight: 1.4,
};
const secondaryBtn: CSSProperties = {
  padding: "0.75rem 1.1rem",
  borderRadius: "0.75rem",
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  fontWeight: 600,
  border: "1px solid rgba(255,255,255,0.2)",
  cursor: "pointer",
  fontSize: 14,
};
function primaryBtn(busy: boolean): CSSProperties {
  return {
    padding: "0.75rem 1.5rem",
    borderRadius: "0.75rem",
    background: "linear-gradient(135deg, #dc2626, #ef4444)",
    color: "#fff",
    fontWeight: 700,
    border: "none",
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.7 : 1,
    fontSize: 14,
  };
}
