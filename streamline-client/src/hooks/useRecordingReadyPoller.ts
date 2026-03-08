import { useEffect, useRef, useCallback, useState } from "react";
import { apiFetchAuth } from "../lib/api";

type RecordingStatus = "starting" | "recording" | "processing" | "ready" | "failed" | "unknown";

type PollerState = {
  /** True while actively polling */
  polling: boolean;
  /** Set once the recording reaches "ready" */
  ready: boolean;
  /** Set if the recording reached "failed" */
  failed: boolean;
  /** The current status string */
  status: RecordingStatus;
};

/**
 * Poll a recording's status after it has been stopped, until it becomes
 * "ready" or "failed". Calls `onReady` when the file is available.
 *
 * Usage:
 *   const { startPolling, toast, dismissToast } = useRecordingReadyPoller({ onReady });
 *   // After stopping a recording:
 *   startPolling(recordingId);
 */
export function useRecordingReadyPoller(opts?: {
  /** Called when the recording becomes ready */
  onReady?: (recordingId: string) => void;
  /** Called when the recording fails */
  onFailed?: (recordingId: string) => void;
  /** Polling interval in ms (default 3000) */
  intervalMs?: number;
  /** Max polling time before giving up in ms (default 120000 = 2 min) */
  timeoutMs?: number;
}) {
  const intervalMs = opts?.intervalMs ?? 3000;
  const timeoutMs = opts?.timeoutMs ?? 120_000;

  const [state, setState] = useState<PollerState>({
    polling: false,
    ready: false,
    failed: false,
    status: "unknown",
  });

  // Toast message state
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
    recordingId: string;
  } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const activeIdRef = useRef<string | null>(null);
  const onReadyRef = useRef(opts?.onReady);
  const onFailedRef = useRef(opts?.onFailed);
  onReadyRef.current = opts?.onReady;
  onFailedRef.current = opts?.onFailed;

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    activeIdRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const dismissToast = useCallback(() => setToast(null), []);

  // Auto-dismiss toast after 8 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const startPolling = useCallback(
    (recordingId: string) => {
      // Stop any existing poll
      cleanup();

      activeIdRef.current = recordingId;
      startTimeRef.current = Date.now();

      setState({
        polling: true,
        ready: false,
        failed: false,
        status: "processing",
      });

      setToast({
        message: "Recording is processing…",
        type: "info",
        recordingId,
      });

      const poll = async () => {
        if (activeIdRef.current !== recordingId) return;

        // Timeout check
        if (Date.now() - startTimeRef.current > timeoutMs) {
          cleanup();
          setState((s) => ({ ...s, polling: false }));
          setToast({
            message: "Recording is still processing. Check Recordings later.",
            type: "info",
            recordingId,
          });
          return;
        }

        try {
          const res = await apiFetchAuth(`/api/recordings/${recordingId}`, {}, { allowNonOk: true });
          if (!res.ok) return; // transient error, retry

          const json = await res.json();
          const status: RecordingStatus = json?.data?.status || "unknown";

          if (activeIdRef.current !== recordingId) return;

          setState((s) => ({ ...s, status }));

          if (status === "ready") {
            cleanup();
            setState({ polling: false, ready: true, failed: false, status: "ready" });
            setToast({
              message: "✅ Recording is ready! View it in your Recordings.",
              type: "success",
              recordingId,
            });
            onReadyRef.current?.(recordingId);
          } else if (status === "failed") {
            cleanup();
            setState({ polling: false, ready: false, failed: true, status: "failed" });
            setToast({
              message: "Recording failed to process.",
              type: "error",
              recordingId,
            });
            onFailedRef.current?.(recordingId);
          }
        } catch {
          // Transient network error — keep polling
        }
      };

      // First poll immediately, then every intervalMs
      poll();
      timerRef.current = setInterval(poll, intervalMs);
    },
    [cleanup, intervalMs, timeoutMs],
  );

  const stopPolling = useCallback(() => {
    cleanup();
    setState({ polling: false, ready: false, failed: false, status: "unknown" });
  }, [cleanup]);

  return { startPolling, stopPolling, toast, dismissToast, ...state };
}
