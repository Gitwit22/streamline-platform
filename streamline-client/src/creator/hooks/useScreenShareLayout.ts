/**
 * useScreenShareLayout — centralized hook for consuming the current
 * screen share layout mode and the active screen share track.
 *
 * Combines `useActiveScreenShare()` with the layout mode prop to give
 * consumers a single source of truth about what to render.
 */

import { useMemo } from "react";
import { useActiveScreenShare, type ActiveScreenShare } from "./useActiveScreenShare";
import type { ScreenShareRouteMode } from "../components/ScreenShareRouter";

export interface ScreenShareLayoutState {
  /** Current layout mode: off, main, or popout */
  mode: ScreenShareRouteMode;
  /** The active screen share, if any */
  activeShare: ActiveScreenShare | null;
  /** Whether a screen share surface should be rendered on the main stage */
  showOnMainStage: boolean;
  /** Whether the popout window should be open */
  showPopout: boolean;
  /** Name of the person sharing, if any */
  sharerName: string | null;
}

/**
 * Hook that combines screen share layout mode with active track detection.
 *
 * @param mode - The current ScreenShareRouteMode from room controls
 */
export function useScreenShareLayout(mode: ScreenShareRouteMode): ScreenShareLayoutState {
  const activeShare = useActiveScreenShare();

  return useMemo((): ScreenShareLayoutState => {
    const hasActiveShare = !!activeShare;
    return {
      mode,
      activeShare,
      showOnMainStage: mode === "main" && hasActiveShare,
      showPopout: mode === "popout",
      sharerName: activeShare?.participantName ?? null,
    };
  }, [mode, activeShare]);
}
