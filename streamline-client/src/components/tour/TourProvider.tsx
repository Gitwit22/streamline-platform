import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import { Joyride, STATUS, ACTIONS, EVENTS } from "../../lib/vendor/reactJoyride";
import type { CallBackProps, Step } from "../../lib/vendor/reactJoyride";
import { tourMap, type TourName } from "../../tours/streamlineTours";

function cleanupTourArtifacts(): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const body = document.body;

  [root, body].forEach((node) => {
    node.style.removeProperty("overflow");
    node.style.removeProperty("pointer-events");
    node.style.removeProperty("touch-action");
    node.style.removeProperty("cursor");
  });

  document.querySelectorAll(".react-joyride__overlay, .react-joyride__spotlight, .react-joyride__tooltip, .react-joyride__beacon, [data-test-id='overlay'], [data-test-id='spotlight']").forEach((node) => {
    node.parentElement?.removeChild(node);
  });
}

/* ------------------------------------------------------------------ */
/*  Context                                                           */
/* ------------------------------------------------------------------ */

interface TourContextValue {
  /** Start the tour for the current page */
  startTour: () => void;
  /** Stop the tour and clear any blocking overlay state */
  stopTour: () => void;
  /** Whether the help dropdown is open */
  helpMenuOpen: boolean;
  /** Whether the tour is currently active */
  tourActive: boolean;
  /** Toggle the help dropdown */
  setHelpMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** The name of the active tour (if any) */
  activeTour: TourName | null;
}

const TourContext = createContext<TourContextValue>({
  startTour: () => {},
  stopTour: () => {},
  helpMenuOpen: false,
  tourActive: false,
  setHelpMenuOpen: () => {},
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

  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [tourSessionKey, setTourSessionKey] = useState(0);

  const activeSteps = useMemo(() => {
    if (typeof document === "undefined") return steps;
    return steps.filter((step) => {
      if (typeof step.target !== "string") return true;
      if (step.target === "body" || step.target === "html") return true;
      return Boolean(document.querySelector(step.target));
    });
  }, [steps, tourActive, stepIndex]);

  useEffect(() => {
    if (tourActive && activeSteps.length === 0) {
      setTourActive(false);
      setStepIndex(0);
      cleanupTourArtifacts();
    }
  }, [tourActive, activeSteps.length]);

  useEffect(() => {
    if (!tourActive) {
      cleanupTourArtifacts();
    }
  }, [tourActive]);

  useEffect(() => {
    return () => {
      cleanupTourArtifacts();
    };
  }, []);

  const stopTour = useCallback(() => {
    setTourActive(false);
    setStepIndex(0);
    cleanupTourArtifacts();
    window.requestAnimationFrame(() => cleanupTourArtifacts());
  }, []);

  const startTour = useCallback(() => {
    cleanupTourArtifacts();
    setHelpMenuOpen(false);
    setStepIndex(0);
    setTourSessionKey((current) => current + 1);
    setTourActive(false);
    window.requestAnimationFrame(() => setTourActive(true));
  }, []);

  const handleCallback = useCallback(
    (data: CallBackProps) => {
      const { status, action, type, index } = data;

      if (
        status === STATUS.FINISHED ||
        status === STATUS.SKIPPED ||
        action === ACTIONS.CLOSE ||
        type === EVENTS.TOUR_END
      ) {
        stopTour();
        return;
      }

      if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
        const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
        if (nextIndex < 0) {
          setStepIndex(0);
          return;
        }

        if (nextIndex >= activeSteps.length) {
          stopTour();
          return;
        }

        setStepIndex(nextIndex);
      }
    },
    [activeSteps.length, stopTour],
  );

  return (
    <TourContext.Provider
      value={{
        startTour,
        stopTour,
        helpMenuOpen,
        tourActive,
        setHelpMenuOpen,
        activeTour: tourActive ? tourName : null,
      }}
    >
      {children}
      {activeSteps.length > 0 && (
        <Joyride
          key={`${tourName}-${tourSessionKey}`}
          steps={activeSteps}
          run={tourActive}
          stepIndex={stepIndex}
          continuous
          showSkipButton
          showProgress
          onEvent={handleCallback}
          styles={joyrideStyles}
          disableScrolling={false}
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
