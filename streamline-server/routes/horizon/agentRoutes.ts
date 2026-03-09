/**
 * Horizon Agent Routes — agent registration, heartbeat, and diagnostics.
 *
 * Mounted at `/api/horizon/agents` in index.ts.
 * requireAdmin is applied at the mount point.
 *
 * Routes:
 *   GET    /status           Full agent diagnostics snapshot
 *   GET    /:id              Single agent info
 *   POST   /heartbeat        Agent heartbeat (register / keep-alive)
 *   DELETE /:id              Deregister agent
 */
import { Router } from "express";
import { logger } from "../../lib/logger";
import {
  agentHeartbeat,
  deregisterAgent,
  getAgentDiagnostics,
  getAgent,
} from "../../lib/horizon/agentRegistry";
import { monitoringBus } from "../../lib/horizon/monitoringBus";

const router = Router();

/* ── GET /status — Full diagnostics snapshot ──────────────────────── */

router.get("/status", (_req, res) => {
  try {
    const diagnostics = getAgentDiagnostics();
    return res.json({ ok: true, ...diagnostics });
  } catch (err: any) {
    logger.error({ err: err?.message }, "GET /agents/status failed");
    return res.status(500).json({ error: "AGENT_DIAGNOSTICS_FAILED" });
  }
});

/* ── GET /:id — Single agent info ─────────────────────────────────── */

router.get("/:id", (req, res) => {
  try {
    const agent = getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: "AGENT_NOT_FOUND" });
    }
    return res.json({ ok: true, agent });
  } catch (err: any) {
    logger.error({ err: err?.message, agentId: req.params.id }, "GET /agents/:id failed");
    return res.status(500).json({ error: "AGENT_FETCH_FAILED" });
  }
});

/* ── POST /heartbeat — Register or refresh agent ──────────────────── */

router.post("/heartbeat", (req, res) => {
  try {
    const body = req.body || {};

    if (!body.id || typeof body.id !== "string") {
      return res.status(400).json({ error: "MISSING_AGENT_ID", message: "id is required" });
    }

    const agent = agentHeartbeat({
      id: body.id,
      name: body.name,
      status: body.status,
      taskQueue: body.taskQueue,
      latencyMs: body.latencyMs,
      errors: body.errors,
      metadata: body.metadata,
    });

    // Broadcast status change to monitoring stream
    monitoringBus.send("agent.status", agent.id, {
      agentId: agent.id,
      name: agent.name,
      status: agent.status,
      taskQueue: agent.taskQueue,
      latencyMs: agent.latencyMs,
    });

    return res.json({ ok: true, agent });
  } catch (err: any) {
    if (err?.message === "Agent registry full") {
      return res.status(429).json({ error: "AGENT_REGISTRY_FULL" });
    }
    logger.error({ err: err?.message }, "POST /agents/heartbeat failed");
    return res.status(500).json({ error: "AGENT_HEARTBEAT_FAILED" });
  }
});

/* ── DELETE /:id — Deregister agent ───────────────────────────────── */

router.delete("/:id", (req, res) => {
  try {
    const removed = deregisterAgent(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: "AGENT_NOT_FOUND" });
    }

    monitoringBus.send("agent.status", req.params.id, {
      agentId: req.params.id,
      status: "stopped",
      event: "deregistered",
    });

    return res.json({ ok: true, message: `Agent ${req.params.id} deregistered` });
  } catch (err: any) {
    logger.error({ err: err?.message, agentId: req.params.id }, "DELETE /agents/:id failed");
    return res.status(500).json({ error: "AGENT_DEREGISTER_FAILED" });
  }
});

export default router;
