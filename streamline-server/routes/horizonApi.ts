/**
 * Horizon Admin API — aggregated admin/monitoring endpoints.
 *
 * All routes are admin-only (requireAdmin applied at mount in index.ts).
 *
 * Sub-routers:
 *   /support/tickets   — unified ticket/incident system
 *   /support/actions   — admin support utilities (resend invite, broadcast, snapshot)
 *   /agents            — agent diagnostics, heartbeat, registration
 *   /health            — platform health metrics + time-series
 *   /diagnostics       — runtime diagnostics, env, deps
 *   /alerts            — alert rules + alert history + manual fire
 *   /skills            — agent skill/capability registry
 *   /events            — POST monitoring events into the bus
 */
import { Router } from "express";
import { logger } from "../lib/logger";
import { monitoringBus } from "../lib/horizon/monitoringBus";
import ticketRoutes from "./horizon/ticketRoutes";
import agentRoutes from "./horizon/agentRoutes";
import platformHealthRoutes from "./horizon/platformHealth";
import diagnosticsRoutes from "./horizon/diagnostics";
import alertRoutes from "./horizon/alertRoutes";
import supportActionsRoutes from "./horizon/supportActions";
import skillsIntegrationRoutes from "./horizon/skillsIntegration";
import type { MonitoringEventType } from "../lib/horizon/types";

const router = Router();

/* ── Health / status ──────────────────────────────────────────────── */

/** Basic Horizon heartbeat. */
router.get("/status", (_req, res) => {
  res.json({ ok: true, service: "horizon", ts: new Date().toISOString() });
});

/* ── Sub-routers ──────────────────────────────────────────────────── */

router.use("/support/tickets", ticketRoutes);
router.use("/support/actions", supportActionsRoutes);
router.use("/agents", agentRoutes);
router.use("/health", platformHealthRoutes);
router.use("/diagnostics", diagnosticsRoutes);
router.use("/alerts", alertRoutes);
router.use("/skills", skillsIntegrationRoutes);

/* ── POST /events — Ingest monitoring events into the bus ─────────── */

const VALID_EVENT_TYPES = new Set<string>([
  "system.alert",
  "system.log",
  "agent.error",
  "service.health",
  "ticket.created",
  "ticket.updated",
  "agent.status",
]);

router.post("/events", (req, res) => {
  try {
    const body = req.body || {};

    if (!body.type || typeof body.type !== "string") {
      return res.status(400).json({ error: "MISSING_TYPE", message: "type is required" });
    }
    if (!VALID_EVENT_TYPES.has(body.type)) {
      return res.status(400).json({
        error: "INVALID_TYPE",
        message: `type must be one of: ${[...VALID_EVENT_TYPES].join(", ")}`,
      });
    }

    monitoringBus.send(
      body.type as MonitoringEventType,
      body.source || "api",
      body.payload && typeof body.payload === "object" ? body.payload : {}
    );

    return res.json({ ok: true, message: "Event published" });
  } catch (err: any) {
    logger.error({ err: err?.message }, "POST /events failed");
    return res.status(500).json({ error: "EVENT_PUBLISH_FAILED" });
  }
});

export default router;
