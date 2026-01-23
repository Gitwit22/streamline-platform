// Admin-related TypeScript types

// Mirror the canonical plan ids used across the platform. This keeps
// admin-only helper types consistent with server/types/plan.ts.
export type PlanId =
  | "free"
  | "starter"
  | "pro"
  | "basic"
  | "enterprise"
  | "internal_unlimited";

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  planId: PlanId;
  billingEnabled: boolean;
  minutesUsed: number;
  bonusMinutes: number;
  createdAt: Date;
  lastActive?: Date;
  stripeCustomerId?: string;
}

export interface UsageRecord {
  userId: string;
  minutes: number;
  guestCount: number;
  description: string;
  timestamp: Date;
  roomName?: string;
}

export interface AdminAction {
  type: "grant_minutes" | "change_plan" | "toggle_billing" | "toggle_feature";
  userId: string;
  performedBy: string;
  timestamp: Date;
  details: Record<string, any>;
}

export interface UserUsageSummary {
  user: User;
  currentMonthUsage: number;
  allTimeUsage: number;
  planLimit: number;
  percentUsed: number;
  isBlocked: boolean;
  recentActivity: UsageRecord[];
}

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  affectedPlans?: PlanId[];
}

export interface AdminStats {
  totalUsers: number;
  usersByPlan: Record<PlanId, number>;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  totalMinutesUsed: number;
  averageMinutesPerUser: number;
}