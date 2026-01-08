// Admin-related TypeScript types

export type PlanId = "free" | "starter" | "pro" | "enterprise";

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