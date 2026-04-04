import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TourProvider, useTour } from "../TourProvider";

const mockJoyride = vi.fn();

vi.mock("../../../lib/vendor/reactJoyride", () => {
  const React = require("react") as typeof import("react");

  const ACTIONS = {
    CLOSE: "close",
    NEXT: "next",
    PREV: "prev",
  } as const;

  const EVENTS = {
    STEP_AFTER: "step:after",
    TARGET_NOT_FOUND: "error:target_not_found",
    TOUR_END: "tour:end",
  } as const;

  const STATUS = {
    FINISHED: "finished",
    SKIPPED: "skipped",
    RUNNING: "running",
  } as const;

  function Joyride(props: any) {
    mockJoyride(props);

    if (!props.run) return null;

    const step = props.steps[props.stepIndex];
    if (!step) return null;

    return React.createElement(
      "div",
      { "data-testid": "joyride-step" },
      React.createElement("div", null, step.content),
      React.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            props.onEvent?.({
              action: ACTIONS.NEXT,
              index: props.stepIndex,
              status: STATUS.RUNNING,
              type: EVENTS.STEP_AFTER,
            });
          },
        },
        "Next"
      )
    );
  }

  return {
    ACTIONS,
    EVENTS,
    Joyride,
    STATUS,
  };
});

function Harness() {
  const { startTour } = useTour();

  return (
    <>
      <button type="button" onClick={() => startTour()}>
        Start tour
      </button>
      <div data-tour="create-room-btn">Create room target</div>
      <div data-tour="usage-meter">Usage target</div>
      <div data-tour="help-button">Help target</div>
    </>
  );
}

describe("TourProvider", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  beforeEach(() => {
    mockJoyride.mockClear();
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
  });

  it("advances to the next step after the intro step", async () => {
    render(
      <TourProvider tourName="dashboard">
        <Harness />
      </TourProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Start tour" }));

    await screen.findByText("Tour started. Click Next to walk through the main controls.");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(screen.getByText("Click here to create a new room.")).toBeInTheDocument();
    });
  });
});