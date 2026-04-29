import type { Step } from "react-joyride";

export const dashboardTour: Step[] = [
  {
    target: "body",
    content: "Tour started. Click Next to walk through the main controls.",
    placement: "center",
    disableBeacon: true,
  },
  {
    target: '[data-tour="create-room-btn"]',
    content: "Click here to create a new room.",
    placement: "bottom",
    disableBeacon: true,
  },
  {
    target: '[data-tour="usage-meter"]',
    content: "Track your available minutes and usage here.",
    placement: "bottom",
  },
  {
    target: '[data-tour="help-button"]',
    content: "Need help? Access guides and restart tours here.",
    placement: "left",
  },
];

export const studioTour: Step[] = [
  {
    target: "body",
    content: "Tour started. Click Next to walk through the studio controls.",
    placement: "center",
    disableBeacon: true,
  },
  {
    target: '[data-tour="end-room-button"]',
    content: "End the room when finished.",
    placement: "bottom",
    disableBeacon: true,
  },
  {
    target: '[data-tour="invite-button"]',
    content: "Invite guests to your room.",
    placement: "bottom",
  },
  {
    target: '[data-tour="screen-share"]',
    content: "Share your screen with participants.",
    placement: "bottom",
  },
  {
    target: '[data-tour="layout-controls"]',
    content: "Change how participants appear on screen.",
    placement: "bottom",
  },
  {
    target: '[data-tour="go-live-button"]',
    content: "Click here to go live and start broadcasting.",
    placement: "bottom",
  },
];

export type TourName = "dashboard" | "studio";

export const tourMap: Record<TourName, Step[]> = {
  dashboard: dashboardTour,
  studio: studioTour,
};
