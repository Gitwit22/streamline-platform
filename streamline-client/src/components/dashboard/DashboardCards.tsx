import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/* ── StatCard ─────────────────────────────────────────────── */

type StatCardColor = "primary" | "green" | "amber" | "red";

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  trend: { value: string; up: boolean };
  color: StatCardColor;
  progress: number;
}

const colorRing: Record<StatCardColor, string> = {
  primary: "border-primary/30",
  green: "border-sl-green/30",
  amber: "border-sl-amber/30",
  red: "border-sl-red/30",
};

const colorBar: Record<StatCardColor, string> = {
  primary: "bg-primary",
  green: "bg-sl-green",
  amber: "bg-sl-amber",
  red: "bg-sl-red",
};

const colorText: Record<StatCardColor, string> = {
  primary: "text-primary",
  green: "text-sl-green",
  amber: "text-sl-amber",
  red: "text-sl-red",
};

export function StatCard({ label, value, sub, trend, color, progress }: StatCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-4 transition-colors",
        colorRing[color],
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">{value}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            trend.up
              ? "border-sl-green/20 bg-sl-green-dim/10 text-sl-green"
              : "border-sl-red/20 bg-sl-red-dim/10 text-sl-red",
          )}
        >
          {trend.up ? "↑" : "↓"} {trend.value}
        </span>
      </div>
      {/* Progress bar */}
      <div className="mt-3 h-1 rounded-full bg-border overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-700", colorBar[color])}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────── */

interface PanelProps {
  title: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}

export function Panel({ title, action, onAction, children }: PanelProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-[18px] py-3 border-b border-border">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {action && (
          <button
            onClick={onAction}
            className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors cursor-pointer"
          >
            {action}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
