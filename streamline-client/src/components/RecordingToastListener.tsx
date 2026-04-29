/**
 * RecordingToastListener — Global bridge between the recording event bus and the toast system.
 *
 * Mount once near the app root (inside ToastProvider + BrowserRouter).
 * Subscribes to recording.processing / recording.ready / recording.failed
 * and surfaces toasts with optional action buttons (Download, View Project).
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../lib/toast";
import { recordingEvents, type RecordingEventType } from "../lib/recordingEvents";

export function RecordingToastListener() {
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => {
    const types: RecordingEventType[] = [
      "recording.processing",
      "recording.ready",
      "recording.failed",
    ];

    const unsubs = types.map((type) =>
      recordingEvents.on(type, (evt) => {
        switch (evt.type) {
          case "recording.processing":
            toast.show({
              title: "Recording processing",
              description: evt.message || "Your recording is being processed…",
              variant: "default",
              duration: 8000,
            });
            break;

          case "recording.ready":
            toast.show({
              title: "Recording ready!",
              description: evt.message || "Your recording is ready to download.",
              variant: "success",
              duration: 12000,
              action: evt.downloadUrl
                ? {
                    label: "Download",
                    onClick: () => {
                      try {
                        window.open(evt.downloadUrl!, "_blank", "noopener,noreferrer");
                      } catch {
                        window.open(evt.downloadUrl!, "_blank");
                      }
                    },
                  }
                : {
                    label: "View Projects",
                    onClick: () => nav("/projects"),
                  },
            });
            break;

          case "recording.failed":
            toast.show({
              title: "Recording issue",
              description: evt.message || "There was a problem with your recording.",
              variant: "destructive",
              duration: 10000,
              action: {
                label: "Check Usage",
                onClick: () =>
                  nav("/settings/billing", {
                    state: { openTab: "usage" },
                  }),
              },
            });
            break;
        }
      })
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [toast, nav]);

  return null;
}
