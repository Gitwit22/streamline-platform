/**
 * useProgramState – React context + hook providing the shared program/output
 * state for a live room.
 *
 * Usage:
 *   <ProgramStateProvider roomId={id} roomAccessToken={token}>
 *     <YourComponent />
 *   </ProgramStateProvider>
 *
 *   const { programState, updateProgramState } = useProgramState();
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  type ProgramState,
  DEFAULT_PROGRAM_STATE,
} from "../lib/programState";
import { apiGetProgramState, apiUpdateProgramState } from "../lib/api";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface ProgramStateContextValue {
  /** Current program/output state. */
  programState: ProgramState;
  /** Merge a partial update into the program state (writes to the server). */
  updateProgramState: (patch: Partial<ProgramState>) => Promise<void>;
  /** True while the initial load is in-flight. */
  loading: boolean;
}

const ProgramStateContext = createContext<ProgramStateContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ProgramStateProviderProps {
  roomId: string;
  roomAccessToken: string;
  children: React.ReactNode;
}

export function ProgramStateProvider({
  roomId,
  roomAccessToken,
  children,
}: ProgramStateProviderProps) {
  const [state, setState] = useState<ProgramState>(DEFAULT_PROGRAM_STATE);
  const [loading, setLoading] = useState(true);
  const stateRef = useRef(state);
  stateRef.current = state;

  // -- initial load --
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGetProgramState(roomId, roomAccessToken);
        if (!cancelled && data.programState) {
          setState(data.programState);
        }
      } catch {
        // Failed to load – keep defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, roomAccessToken]);

  // -- update (optimistic + persist) --
  const updateProgramState = useCallback(
    async (patch: Partial<ProgramState>) => {
      // Optimistic local merge
      setState((prev) => ({ ...prev, ...patch }));

      try {
        const result = await apiUpdateProgramState(
          roomId,
          roomAccessToken,
          patch,
        );
        // Server may enrich (e.g. updatedAt) – authoritative merge
        setState(result.programState);
      } catch (err) {
        // Roll back to the pre-patch state
        console.error("[ProgramState] update failed, rolling back", err);
        setState(stateRef.current);
      }
    },
    [roomId, roomAccessToken],
  );

  return (
    <ProgramStateContext.Provider
      value={{ programState: state, updateProgramState, loading }}
    >
      {children}
    </ProgramStateContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProgramState(): ProgramStateContextValue {
  const ctx = useContext(ProgramStateContext);
  if (!ctx) {
    throw new Error(
      "useProgramState must be used inside <ProgramStateProvider>",
    );
  }
  return ctx;
}
