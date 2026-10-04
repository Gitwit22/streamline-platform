/** Types and formatting helpers for SystemJobsPanel (kept separate for fast refresh). */

export type JobRunSummary = {
  id?: string | null;
  startedAtMs: number;
  durationMs?: number;
  status: "success" | "error" | "skipped";
  processed?: number;
  details?: Record<string, unknown>;
  error?: string | null;
  trigger?: string;
  instance?: string;
};

export type SystemJob = {
  name: string;
  title: string;
  description?: string | null;
  intervalMs: number;
  enabled: boolean;
  highlight?: string | null;
  running: boolean;
  runningInstance?: string | null;
  lastRunAtMs: number | null;
  lastStatus: "success" | "error" | "skipped" | null;
  lastProcessed: number | null;
  lastDetails: Record<string, unknown> | null;
  lastError: string | null;
  lastDurationMs: number | null;
  lastTrigger?: string | null;
  nextRunAtMs: number | null;
  runCount: number;
  errorCount: number;
  recentRuns: JobRunSummary[];
};

export type JobsResponse = { nowMs: number; schedulerRunning: boolean; instance?: string; jobs: SystemJob[] };

export function formatRelative(ms: number | null | undefined, nowMs: number = Date.now()): string {
  if (!ms) return "";
  const diff = ms - nowMs;
  const abs = Math.abs(diff);
  const unit =
    abs < 60_000
      ? `${Math.max(1, Math.round(abs / 1000))}s`
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function formatInterval(ms: number): string {
  if (!ms) return "manual only";
  if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `every ${Math.round(ms / 3_600_000)} h`;
  return `every ${Math.round(ms / 86_400_000)} d`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return "Never";
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleString();
}

export function label(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** "Stopped: 1" style summary of the job's key detail (falls back to processed). */
export function highlightText(job: Pick<SystemJob, "highlight" | "lastDetails">): string | null {
  const key = job.highlight;
  if (!key || !job.lastDetails) return null;
  const v = job.lastDetails[key];
  if (typeof v !== "number") return null;
  return `${label(key)}: ${v}`;
}
