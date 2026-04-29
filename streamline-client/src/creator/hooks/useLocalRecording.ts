/**
 * useLocalRecording — records the mixer's program output to a local file.
 *
 * Supports two modes:
 *   1. **Audio-only** (default): captures the mixer's program audio stream.
 *   2. **Composite**: combines an optional video MediaStreamTrack with the
 *      mixer's program audio into a single video+audio recording.
 *
 * Pass `videoTrack` via options to enable composite mode.
 * The resulting blob can be downloaded directly by the host.
 *
 * Architectural note: LiveKit still publishes and records original audio tracks
 * independently. This recording captures the host's mixed program output.
 */

import { useState, useRef, useCallback } from "react";
import { getMixer } from "../components/AudioMixerModal";

export type LocalRecordingState = "idle" | "recording" | "stopping";

export interface LocalRecordingResult {
  blob: Blob;
  url: string;
  durationMs: number;
  hasVideo: boolean;
}

export interface LocalRecordingOptions {
  /** Optional video track to include in recording (enables composite mode). */
  videoTrack?: MediaStreamTrack | null;
}

export function useLocalRecording(options?: LocalRecordingOptions) {
  const [state, setState] = useState<LocalRecordingState>("idle");
  const [lastResult, setLastResult] = useState<LocalRecordingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef<number>(0);
  const compositeStreamRef = useRef<MediaStream | null>(null);

  const start = useCallback(() => {
    const mixer = getMixer();
    const programStream = mixer.getProgramStream();
    if (!programStream) {
      setError("Mixer not initialized — open the mixer panel first.");
      return;
    }

    const audioTrack = programStream.getAudioTracks()[0] ?? null;
    if (!audioTrack) {
      setError("No audio tracks available in program output.");
      return;
    }

    setError(null);
    setLastResult(null);
    chunksRef.current = [];

    // Build the recording stream: composite (video+audio) or audio-only
    const videoTrack = options?.videoTrack ?? null;
    const hasVideo = videoTrack != null && videoTrack.readyState === "live";

    let recordingStream: MediaStream;
    if (hasVideo) {
      recordingStream = new MediaStream([videoTrack, audioTrack]);
      compositeStreamRef.current = recordingStream;
    } else {
      recordingStream = new MediaStream([audioTrack]);
      compositeStreamRef.current = null;
    }

    // Pick a supported MIME type (prefer video container when composite)
    let mimeType: string;
    if (hasVideo) {
      mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
          ? "video/webm;codecs=vp8,opus"
          : MediaRecorder.isTypeSupported("video/webm")
            ? "video/webm"
            : "video/mp4";
    } else {
      mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg";
    }

    const recorder = new MediaRecorder(recordingStream, { mimeType });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const durationMs = Date.now() - startTimeRef.current;
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setLastResult({ blob, url, durationMs, hasVideo });
      setState("idle");
      recorderRef.current = null;
      compositeStreamRef.current = null;
    };

    recorder.onerror = () => {
      setError("Recording failed unexpectedly.");
      setState("idle");
      recorderRef.current = null;
      compositeStreamRef.current = null;
    };

    recorderRef.current = recorder;
    startTimeRef.current = Date.now();
    recorder.start(1000); // collect data every second
    setState("recording");
  }, [options?.videoTrack]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      setState("stopping");
      recorderRef.current.stop();
    }
  }, []);

  const download = useCallback((filename?: string) => {
    if (!lastResult) return;
    const ext = lastResult.hasVideo ? "webm" : "webm";
    const defaultName = `streamline-program-mix-${Date.now()}.${ext}`;
    const a = document.createElement("a");
    a.href = lastResult.url;
    a.download = filename ?? defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [lastResult]);

  const clearResult = useCallback(() => {
    if (lastResult?.url) URL.revokeObjectURL(lastResult.url);
    setLastResult(null);
  }, [lastResult]);

  return { state, lastResult, error, start, stop, download, clearResult };
}
