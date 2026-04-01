import React, { createContext, useContext, useState, useCallback } from "react";
import { Joyride, STATUS, ACTIONS, EVENTS } from "react-joyride";
import type { CallBackProps, Step } from "react-joyride";
import { tourMap, type TourName } from "../../tours/streamlineTours";

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                              */
/* ------------------------------------------------------------------ */

const storageKey = (name: TourName) => `tour-${name}`;

function isTourCompleted(name: TourName): boolean {
  try {
    return localStorage.getItem(storageKey(name)) === "done";
  } catch {
    return false;
  }
}

function markTourCompleted(name: TourName): void {
  try {
    localStorage.setItem(storageKey(name), "done");
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

  const restartTour = useCallback(() => {
    clearTourCompleted(tourName);
    setStepIndex(0);
    setRun(true);
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

      // Normal step navigation
      if (type === EVENTS.STEP_AFTER) {
        setStepIndex(index + (action === ACTIONS.PREV ? -1 : 1));
      }
    },
    [tourName],
  );

  return (
    <TourContext.Provider value={{ restartTour, activeTour: tourName }}>
      {children}
      {steps.length > 0 && (
        <Joyride
          steps={steps}
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
          disableScrolling
        />
      )}
    </TourContext.Provider>
  );
}
