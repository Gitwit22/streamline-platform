import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchPendingEduCalls,
  dismissEduCall,
  updateEduCall,
  type PendingEduCall,
} from "../api/calls";

/** Polling interval in ms — checks for incoming calls every 5 seconds. */
const POLL_INTERVAL = 5_000;

/**
 * Site-wide incoming-call notification.
 * Renders a fixed overlay at the top of the viewport so it's visible
 * regardless of which tab / page the user is viewing.
 */
export default function IncomingCallBanner() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<PendingEduCall[]>([]);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevCountRef = useRef(0);

  const poll = useCallback(async () => {
    try {
      const pending = await fetchPendingEduCalls();
      setCalls(pending);
    } catch {
      /* swallow — network hiccups shouldn't break the banner */
    }
  }, []);

  useEffect(() => {
    poll(); // initial fetch
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  // Play a short ringtone pulse when new calls arrive
  useEffect(() => {
    if (calls.length > 0 && calls.length > prevCountRef.current) {
      try {
        // Use a short oscillator beep — no external audio file needed
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 440;
        gain.gain.value = 0.15;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
        // Second short beep
        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = 554.37; // C#5
        osc2.connect(gain);
        osc2.start(ctx.currentTime + 0.3);
        osc2.stop(ctx.currentTime + 0.55);
      } catch {
        /* AudioContext may not be available */
      }
    }
    prevCountRef.current = calls.length;
  }, [calls.length]);

  const handleDismiss = async (id: string) => {
    setDismissing((prev) => new Set(prev).add(id));
    try {
      await dismissEduCall(id);
      setCalls((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleAccept = async (call: PendingEduCall) => {
    setAccepting(call.id);
    try {
      await updateEduCall(call.id, { status: "active" });
      // Navigate to the Calls page on accept
      navigate("/streamline/edu/calls");
    } finally {
      setAccepting(null);
      setCalls((prev) => prev.filter((c) => c.id !== call.id));
    }
  };

  if (calls.length === 0) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex flex-col items-center gap-2 px-4 pt-3 pointer-events-none">
      {calls.map((call) => {
        const isDismissing = dismissing.has(call.id);
        const isAccepting = accepting === call.id;

        return (
          <div
            key={call.id}
            className="pointer-events-auto flex w-full max-w-lg items-center gap-4 rounded-2xl border border-orange-500/30 bg-slate-900/95 px-5 py-4 shadow-2xl shadow-orange-500/10 backdrop-blur-md animate-slide-down"
          >
            {/* Pulsing phone icon */}
            <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-red-600">
              <span className="absolute inset-0 animate-ping rounded-full bg-orange-500/30" />
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                className="relative h-5 w-5 animate-wiggle"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>

            {/* Details */}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-white truncate">
                Incoming Call
              </div>
              <div className="mt-0.5 text-xs text-slate-400 truncate">
                {call.callerName || call.createdBy || "Unknown"} is calling you
              </div>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 gap-2">
              {/* Decline */}
              <button
                onClick={() => handleDismiss(call.id)}
                disabled={isDismissing || isAccepting}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600/20 text-red-400 transition hover:bg-red-600/40 disabled:opacity-50"
                title="Decline"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
              {/* Accept */}
              <button
                onClick={() => handleAccept(call)}
                disabled={isDismissing || isAccepting}
                className="flex h-10 items-center gap-1.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-600 px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                title="Accept Call"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {isAccepting ? "Joining…" : "Accept"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
