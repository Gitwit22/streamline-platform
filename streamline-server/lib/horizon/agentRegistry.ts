/**
 * Horizon Agent Registry — in-memory registry of connected agents.
 *
 * Agents (Horizon AI agent, external monitors, automation bots)
 * register themselves via heartbeat POSTs. The registry tracks
 * their status, latency, task queues, and errors so the dashboard
 * can display a real-time agent overview.
 *
 * Agents that miss 3 heartbeat windows are marked "failed".
 */
import { logger } from "../logger";
import type { AgentInfo, AgentDiagnostics, AgentStatus } from "./types";

/* ── Configuration ────────────────────────────────────────────────── */

/** How often we expect a heartbeat (ms). */
const HEARTBEAT_INTERVAL_MS = 30_000; // 30s

/** After this many missed intervals we mark the agent failed. */
const MAX_MISSED_HEARTBEATS = 3;

/** Maximum number of registered agents (DoS guard). */
const MAX_AGENTS = 100;

/* ── Store ────────────────────────────────────────────────────────── */

const agents = new Map<string, AgentInfo>();

/* ── Sweep ────────────────────────────────────────────────────────── */

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, agent] of agents) {
      const lastBeat = new Date(agent.lastHeartbeat).getTime();
      const elapsed = now - lastBeat;
      if (elapsed > HEARTBEAT_INTERVAL_MS * MAX_MISSED_HEARTBEATS) {
        if (agent.status === "running" || agent.status === "idle") {
          agent.status = "failed";
          logger.warn({ agentId: id, elapsed }, "Agent missed heartbeats — marked failed");
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/* ── Public API ───────────────────────────────────────────────────── */

export interface AgentHeartbeat {
  id: string;
  name?: string;
  status?: AgentStatus;
  taskQueue?: number;
  latencyMs?: number;
  errors?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Register or update an agent heartbeat.
 * Returns the current agent info.
 */
export function agentHeartbeat(hb: AgentHeartbeat): AgentInfo {
  startSweep(); // lazy start

  if (agents.size >= MAX_AGENTS && !agents.has(hb.id)) {
    throw new Error("Agent registry full");
  }

  const existing = agents.get(hb.id);
  const now = new Date().toISOString();

  const info: AgentInfo = {
    id: hb.id,
    name: hb.name ?? existing?.name ?? hb.id,
    status: hb.status ?? existing?.status ?? "running",
    lastHeartbeat: now,
    taskQueue: hb.taskQueue ?? existing?.taskQueue ?? 0,
    latencyMs: hb.latencyMs ?? existing?.latencyMs ?? 0,
    errors: hb.errors ?? existing?.errors ?? 0,
    upSince: existing?.upSince ?? now,
    metadata: hb.metadata ?? existing?.metadata,
  };

  agents.set(hb.id, info);
  return info;
}

/**
 * Remove an agent from the registry (clean shutdown).
 */
export function deregisterAgent(id: string): boolean {
  return agents.delete(id);
}

/**
 * Get full agent diagnostics snapshot.
 */
export function getAgentDiagnostics(): AgentDiagnostics {
  const list = Array.from(agents.values());

  let running = 0;
  let idle = 0;
  let failed = 0;
  let stopped = 0;
  let totalQueue = 0;
  let totalLatency = 0;

  for (const a of list) {
    switch (a.status) {
      case "running":
        running++;
        break;
      case "idle":
        idle++;
        break;
      case "failed":
        failed++;
        break;
      case "stopped":
        stopped++;
        break;
    }
    totalQueue += a.taskQueue;
    totalLatency += a.latencyMs;
  }

  return {
    ts: new Date().toISOString(),
    agents: list,
    summary: {
      total: list.length,
      running,
      idle,
      failed,
      stopped,
      totalTaskQueue: totalQueue,
      avgLatencyMs: list.length > 0 ? Math.round(totalLatency / list.length) : 0,
    },
  };
}

/**
 * Get a single agent's info.
 */
export function getAgent(id: string): AgentInfo | undefined {
  return agents.get(id);
}
