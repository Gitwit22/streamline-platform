/**
 * ScreenSharePopout — manages a pop-out browser window that displays
 * the active screen share video track.
 *
 * Rendered inside <LiveKitRoom> so it has access to the room context.
 * Returns null (invisible side-effect component).
 */
import { useEffect, useRef, useCallback } from "react";
import type { ScreenShareRouteMode } from "./ScreenShareRouter";
import { useActiveScreenShare, type ActiveScreenShare } from "../hooks/useActiveScreenShare";
import { useToast } from "../../lib/toast";

interface ScreenSharePopoutProps {
  mode: ScreenShareRouteMode;
  onActiveSharerChange?: (name: string | null) => void;
}

const POPOUT_NAME = "sl-screenshare-popout";
const POPOUT_FEATURES = "width=960,height=540,resizable=yes,scrollbars=no,status=no,toolbar=no,menubar=no";

function writePopoutDocument(win: Window, title: string) {
  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Screen Share — ${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    #sl-popout-root {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
    }
    #sl-popout-root video {
      max-width: 100%; max-height: 100%;
      object-fit: contain;
    }
    .sl-popout-waiting {
      color: #9ca3af; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-align: center;
    }
    .sl-popout-waiting h2 { font-size: 18px; font-weight: 600; color: #e5e7eb; margin-bottom: 6px; }
    .sl-popout-waiting p { font-size: 13px; }
    .sl-popout-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3b82f6;
      margin-right: 8px; animation: sl-pulse 1.5s ease-in-out infinite; }
    @keyframes sl-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
  </style>
</head>
<body><div id="sl-popout-root"></div></body>
</html>`);
  win.document.close();
}

function showWaitingState(win: Window) {
  const root = win.document.getElementById("sl-popout-root");
  if (!root) return;
  root.innerHTML = `
    <div class="sl-popout-waiting">
      <h2><span class="sl-popout-dot"></span>Waiting for screen share</h2>
      <p>The screen share will appear here when someone starts sharing.</p>
    </div>`;
}

function showEndedState(win: Window) {
  const root = win.document.getElementById("sl-popout-root");
  if (!root) return;
  root.innerHTML = `
    <div class="sl-popout-waiting">
      <h2>Screen share ended</h2>
      <p>Waiting for a new screen share…</p>
    </div>`;
}

export default function ScreenSharePopout({ mode, onActiveSharerChange }: ScreenSharePopoutProps) {
  const activeShare = useActiveScreenShare();
  const toast = useToast();
  const popoutRef = useRef<Window | null>(null);
  const attachedVideoRef = useRef<HTMLVideoElement | null>(null);
  const prevModeRef = useRef<ScreenShareRouteMode>(mode);
  const prevActiveRef = useRef<ActiveScreenShare | null>(null);

  // Report active sharer name to parent
  useEffect(() => {
    onActiveSharerChange?.(activeShare?.participantName ?? null);
  }, [activeShare?.participantName, onActiveSharerChange]);

  const closePopout = useCallback(() => {
    if (attachedVideoRef.current) {
      try {
        const track = attachedVideoRef.current.srcObject as MediaStream | null;
        if (track) {
          track.getTracks().forEach((t) => t.stop());
        }
        attachedVideoRef.current.srcObject = null;
      } catch {
        // ignore
      }
      attachedVideoRef.current = null;
    }
    if (popoutRef.current && !popoutRef.current.closed) {
      try {
        popoutRef.current.close();
      } catch {
        // ignore
      }
    }
    popoutRef.current = null;
  }, []);

  // Toasts for mode transitions
  useEffect(() => {
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (prev === mode) return;

    if (mode === "main") {
      toast.show({ title: "Screen share → main feed", variant: "default", duration: 3000 });
    } else if (mode === "popout") {
      toast.show({ title: "Screen share → pop-out window", variant: "default", duration: 3000 });
    } else if (mode === "off" && prev !== "off") {
      toast.show({ title: "Screen share display off", variant: "default", duration: 3000 });
    }
  }, [mode, toast]);

  // Toast when a share starts/stops
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeShare;

    if (activeShare && !prev) {
      toast.show({
        title: `${activeShare.participantName} started screen sharing`,
        variant: "success",
        duration: 4000,
      });
    } else if (!activeShare && prev) {
      toast.show({
        title: "Screen share ended",
        variant: "default",
        duration: 3000,
      });
    }
  }, [activeShare, toast]);

  // Main effect: manage popout window lifecycle
  useEffect(() => {
    // If mode is not popout, close any popout window
    if (mode !== "popout") {
      closePopout();
      return;
    }

    // Mode is popout — ensure window exists
    if (!popoutRef.current || popoutRef.current.closed) {
      const win = window.open("", POPOUT_NAME, POPOUT_FEATURES);
      if (!win) {
        toast.show({
          title: "Pop-up blocked",
          description: "Allow pop-ups for this site to use the screen share pop-out.",
          variant: "destructive",
          duration: 6000,
        });
        return;
      }
      popoutRef.current = win;
      writePopoutDocument(win, "StreamLine");

      // Listen for the user manually closing the popout
      const onUnload = () => {
        popoutRef.current = null;
        attachedVideoRef.current = null;
      };
      win.addEventListener("pagehide", onUnload);
    }

    const win = popoutRef.current;
    if (!win || win.closed) return;

    // If no active screen share, show waiting state
    if (!activeShare?.publication.track) {
      // Detach old video if any
      if (attachedVideoRef.current) {
        try {
          attachedVideoRef.current.srcObject = null;
        } catch { /* ignore */ }
        attachedVideoRef.current = null;
      }
      showWaitingState(win);
      return;
    }

    // Attach the screen share track to a video element in the popout
    const track = activeShare.publication.track;
    const root = win.document.getElementById("sl-popout-root");
    if (!root) return;

    // Create video element if needed or reuse
    let video = attachedVideoRef.current;
    if (!video || !root.contains(video)) {
      root.innerHTML = "";
      video = win.document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = false; // Let audio through
      root.appendChild(video);
      attachedVideoRef.current = video;
    }

    // Use LiveKit's track.mediaStreamTrack to build a stream
    const mediaTrack = track.mediaStreamTrack;
    if (mediaTrack) {
      const stream = new MediaStream([mediaTrack]);
      video.srcObject = stream;
      video.play().catch(() => {
        // Autoplay may be blocked; mute and retry
        video!.muted = true;
        video!.play().catch(() => { /* give up silently */ });
      });
    }
  }, [mode, activeShare, closePopout, toast]);

  // When screen share ends while in popout mode, show ended state
  useEffect(() => {
    if (mode !== "popout") return;
    if (!activeShare && popoutRef.current && !popoutRef.current.closed) {
      showEndedState(popoutRef.current);
    }
  }, [mode, activeShare]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closePopout();
    };
  }, [closePopout]);

  return null;
}
