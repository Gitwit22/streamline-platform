/**
 * Shared types for usage tracking and plan enforcement
 */

export type PlanDoc = {
  id?: string;
  features: {
    rtmpMultistream: boolean;
    recording: boolean;
    overagesAllowed?: boolean;
  };
  limits: {
    maxDestinations: number;
    participantMinutes: number;
    transcodeMinutes: number;
  };
};

export type UserOveragesSetting = {
  overagesEnabled: boolean;
};

export type UsageSnapshot = {
  participantMinutes: number;
  transcodeMinutes: number;
};

export type GateResult = {
  allowed: boolean;
  reason?: string;
  requiresUpgrade?: boolean;
  requiresOveragesEnabled?: boolean;
};

export type CanStartStreamParams = {
  uid: string;
  plan: PlanDoc;
  userOverages: UserOveragesSetting;
  selectedDestinationsCount: number;
  wantsRecording: boolean;
  wantsRTMP: boolean;
  currentUsage: UsageSnapshot;
};