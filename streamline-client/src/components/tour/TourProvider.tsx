import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { Joyride, STATUS, ACTIONS, EVENTS } from "react-joyride";
import type { CallBackProps, Step } from "react-joyride";
import { tourMap, type TourName } from "../../tours/streamlineTours";

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                              */
/* ------------------------------------------------------------------ */

const storageKey = (name: TourName) => `tour-${name}`;
const TOUR_DONE = "done";

function isTourCompleted(name: TourName): boolean {
  try {
    return localStorage.getItem(storageKey(name)) === TOUR_DONE;
  } catch {
    return false;
  }
}

function markTourCompleted(name: TourName): void {
  try {
    localStorage.setItem(storageKey(name), TOUR_DONE);
  } catch {
    /* storage unavailable – silently ignore */
  }
}

function clearTourCompleted(name: TourName): void {
  try {
    localStorage.removeItem(storageKey(name));
  } catch {
    /* storage unavailable */
  }
}

/* ------------------------------------------------------------------ */
/*  Context                                                           */
/* ------------------------------------------------------------------ */

interface TourContextValue {
  /** Restart the tour for the current page */
  restartTour: () => void;
  /** The name of the active tour (if any) */
  activeTour: TourName | null;
}

const TourContext = createContext<TourContextValue>({
  restartTour: () => {},
  activeTour: null,
});

export const useTour = () => useContext(TourContext);

/* ------------------------------------------------------------------ */
/*  Joyride style overrides (dark theme matching StreamLine UI)       */
/* ------------------------------------------------------------------ */

const joyrideStyles = {
  options: {
    zIndex: 10000,
    arrowColor: "#1f2937",
    backgroundColor: "#1f2937",
    primaryColor: "#dc2626",
    textColor: "#e5e7eb",
    overlayColor: "rgba(0, 0, 0, 0.5)",
  },
  tooltipContent: {
    fontSize: "14px",
    padding: "12px 16px",
  },
  buttonNext: {
    backgroundColor: "#dc2626",
    borderRadius: "6px",
    fontSize: "13px",
    padding: "8px 16px",
  },
  buttonBack: {
    color: "#9ca3af",
    fontSize: "13px",
  },
  buttonSkip: {
    color: "#6b7280",
    fontSize: "13px",
  },
};

/* ------------------------------------------------------------------ */
/*  Provider                                                          */
/* ------------------------------------------------------------------ */

interface TourProviderProps {
  tourName: TourName;
  children: React.ReactNode;
}

export function TourProvider({ tourName, children }: TourProviderProps) {
  const steps: Step[] = tourMap[tourName] ?? [];

  // Start automatically if tour hasn't been completed
  const [run, setRun] = useState(() => !isTourCompleted(tourName));
  const [stepIndex, setStepIndex] = useState(0);
  const [showStartBanner, setShowStartBanner] = useState(false);

  const activeSteps = useMemo(() => {
    if (typeof document === "undefined") return steps;
    return steps.filter((step) => {
      if (typeof step.target !== "string") return true;
      if (step.target === "body" || step.target === "html") return true;
      return Boolean(document.querySelector(step.target));
    });
  }, [steps, run, stepIndex]);

  useEffect(() => {
    if (run && activeSteps.length === 0) {
      setRun(false);
      setStepIndex(0);
    }
  }, [run, activeSteps.length]);

  useEffect(() => {
    if (!showStartBanner) return;
    const timeoutId = window.setTimeout(() => setShowStartBanner(false), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [showStartBanner]);

  const restartTour = useCallback(() => {
    clearTourCompleted(tourName);
    setStepIndex(0);
    setShowStartBanner(true);
    setRun(false);
    window.requestAnimationFrame(() => setRun(true));
  }, [tourName]);

  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { status, action, type, index } = data;

      // Tour finished or skipped
      if (
        status === STATUS.FINISHED ||
        status === STATUS.SKIPPED ||
        (action === ACTIONS.CLOSE && type === EVENTS.STEP_AFTER)
      ) {
        markTourCompleted(tourName);
        setRun(false);
        setStepIndex(0);
        return;
      }

      // Controlled mode must advance both on STEP_AFTER and TARGET_NOT_FOUND.
      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
        if (nextIndex < 0) {
          setStepIndex(0);
          return;
        }

        if (nextIndex >= activeSteps.length) {
          markTourCompleted(tourName);
          setRun(false);
          setStepIndex(0);
          return;
        }

        setStepIndex(nextIndex);
      }
    },
    [tourName, activeSteps.length],
  );

  return (
    <TourContext.Provider value={{ restartTour, activeTour: tourName }}>
      {children}
      {showStartBanner && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 11000,
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid rgba(220, 38, 38, 0.55)",
            background: "rgba(17, 24, 39, 0.95)",
            color: "#f9fafb",
            fontSize: "13px",
            fontWeight: 600,
            boxShadow: "0 10px 24px rgba(0, 0, 0, 0.35)",
          }}
        >
          Guided tour started
        </div>
      )}
      {activeSteps.length > 0 && (
        <Joyride
          steps={activeSteps}
          run={run}
          stepIndex={stepIndex}
          continuous
          showSkipButton
          showProgress
          callback={handleCallback}
          styles={joyrideStyles}
          locale={{
            back: "Back",
            close: "Close",
            last: "Finish",
            next: "Next",
            skip: "Skip tour",
          }}
          scrollToFirstStep
        />
      )}
    </TourContext.Provider>
  );
}
