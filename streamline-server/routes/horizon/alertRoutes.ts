/**
 * Horizon Alert routes — threshold-based alert rules + alert history.
 *
 * Mounted at `/api/horizon/alerts` in index.ts.
 * requireAdmin is applied at the mount point.
 *
 * Routes:
 *   POST   /rules            Create alert rule
 *   GET    /rules            List alert rules
 *   DELETE /rules/:id        Delete alert rule
 *   GET    /                 List fired alerts
 *   POST   /:id/ack         Acknowledge an alert
 *   POST   /fire            Manually fire an alert (testing / agent use)
 */
import crypto from "node:crypto";
import { Router } from "express";
import { logger } from "../../lib/logger";
import { monitoringBus } from "../../lib/horizon/monitoringBus";
import { globalCol } from "../../lib/dbPaths";

const router = Router();

/* ── Types ────────────────────────────────────────────────────────── */

interface AlertRule {
  id: string;
  name: string;
  metric: string;
  operator: "gt" | "lt" | "eq" | "gte" | "lte";
  threshold: number;
  severity: "low" | "medium" | "high" | "critical";
  enabled: boolean;
  createdAt: string;
}

interface Alert {
  id: string;
  ruleId?: string;
  ruleName?: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  source: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  metadata: Record<string, unknown>;
  firedAt: string;
}

/* ── In-memory stores (Firestore persistence below) ───────────────── */

const MAX_RULES = 200;
const MAX_ALERTS = 500;

let rules: AlertRule[] = [];
let alerts: Alert[] = [];

const RULES_COL = "horizonAlertRules";
const ALERTS_COL = "horizonAlerts";

function rulesCol() { return globalCol(RULES_COL); }
function alertsCol() { return globalCol(ALERTS_COL); }

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

/* ── Boot: load from Firestore ────────────────────────────────────── */

(async function loadFromFirestore() {
  try {
    const rSnap = await rulesCol().orderBy("createdAt", "desc").limit(MAX_RULES).get();
    rules = rSnap.docs.map(d => d.data() as AlertRule);
    logger.info({ count: rules.length }, "Alert rules loaded from Firestore");
  } catch { /* first run, collection may not exist */ }

  try {
    const aSnap = await alertsCol().orderBy("firedAt", "desc").limit(MAX_ALERTS).get();
    alerts = aSnap.docs.map(d => d.data() as Alert);
    logger.info({ count: alerts.length }, "Alert history loaded from Firestore");
  } catch { /* first run */ }
})();

/* ── POST /rules — Create rule ────────────────────────────────────── */

router.post("/rules", async (req, res) => {
  try {
    if (rules.length >= MAX_RULES) {
      return res.status(429).json({ error: "MAX_RULES_REACHED" });
    }
    const b = req.body || {};
    if (!b.name || !b.metric || !b.operator || b.threshold == null) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "name, metric, operator, threshold required" });
    }

    const rule: AlertRule = {
      id: genId("rule"),
      name: String(b.name).slice(0, 200),
      metric: String(b.metric).slice(0, 100),
      operator: ["gt", "lt", "eq", "gte", "lte"].includes(b.operator) ? b.operator : "gt",
      threshold: Number(b.threshold),
      severity: ["low", "medium", "high", "critical"].includes(b.severity) ? b.severity : "medium",
      enabled: b.enabled !== false,
      createdAt: new Date().toISOString(),
    };

    rules.unshift(rule);
    try { await rulesCol().doc(rule.id).set(rule); } catch (e: any) {
      logger.warn({ err: e?.message }, "Failed to persist alert rule");
    }

    return res.status(201).json({ ok: true, rule });
  } catch (err: any) {
    logger.error({ err: err?.message }, "POST /alerts/rules failed");
    return res.status(500).json({ error: "RULE_CREATE_FAILED" });
  }
});

/* ── GET /rules — List rules ──────────────────────────────────────── */

router.get("/rules", (_req, res) => {
  return res.json({ ok: true, rules });
});

/* ── DELETE /rules/:id ────────────────────────────────────────────── */

router.delete("/rules/:id", async (req, res) => {
  try {
    const idx = rules.findIndex(r => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: "RULE_NOT_FOUND" });

    rules.splice(idx, 1);
    try { await rulesCol().doc(req.params.id).delete(); } catch { /* best effort */ }

    return res.json({ ok: true, message: "Rule deleted" });
  } catch (err: any) {
    logger.error({ err: err?.message }, "DELETE /alerts/rules/:id failed");
    return res.status(500).json({ error: "RULE_DELETE_FAILED" });
  }
});

/* ── GET / — List alerts ──────────────────────────────────────────── */

router.get("/", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 50, MAX_ALERTS);
  const ackFilter = req.query.acknowledged;
  let filtered = [...alerts];
  if (ackFilter === "true") filtered = filtered.filter(a => a.acknowledged);
  if (ackFilter === "false") filtered = filtered.filter(a => !a.acknowledged);
  return res.json({ ok: true, alerts: filtered.slice(0, limit), total: filtered.length });
});

/* ── POST /:id/ack — Acknowledge alert ────────────────────────────── */

router.post("/:id/ack", async (req, res) => {
  try {
    const alert = alerts.find(a => a.id === req.params.id);
    if (!alert) return res.status(404).json({ error: "ALERT_NOT_FOUND" });

    alert.acknowledged = true;
    alert.acknowledgedBy = req.body?.by || "admin";
    alert.acknowledgedAt = new Date().toISOString();

    try { await alertsCol().doc(alert.id).set(alert); } catch { /* best effort */ }

    return res.json({ ok: true, alert });
  } catch (err: any) {
    logger.error({ err: err?.message }, "POST /alerts/:id/ack failed");
    return res.status(500).json({ error: "ALERT_ACK_FAILED" });
  }
});

/* ── POST /fire — Manually fire an alert (agents / testing) ───────── */

router.post("/fire", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.message) {
      return res.status(400).json({ error: "MISSING_MESSAGE" });
    }

    const alert: Alert = {
      id: genId("alert"),
      ruleId: b.ruleId,
      ruleName: b.ruleName,
      severity: ["low", "medium", "high", "critical"].includes(b.severity) ? b.severity : "medium",
      message: String(b.message).slice(0, 2000),
      source: b.source || "manual",
      acknowledged: false,
      metadata: b.metadata && typeof b.metadata === "object" ? b.metadata : {},
      firedAt: new Date().toISOString(),
    };

    alerts.unshift(alert);
    if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;

    try { await alertsCol().doc(alert.id).set(alert); } catch (e: any) {
      logger.warn({ err: e?.message }, "Failed to persist alert");
    }

    // Publish to monitoring stream
    monitoringBus.send("system.alert", alert.source, {
      alertId: alert.id,
      severity: alert.severity,
      message: alert.message,
      ruleId: alert.ruleId,
    });

    return res.status(201).json({ ok: true, alert });
  } catch (err: any) {
    logger.error({ err: err?.message }, "POST /alerts/fire failed");
    return res.status(500).json({ error: "ALERT_FIRE_FAILED" });
  }
});

export default router;
