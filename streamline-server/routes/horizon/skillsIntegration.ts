/**
 * Horizon Skills Integration routes — agent skill/capability registry.
 *
 * Mounted at `/api/horizon/skills` in index.ts.
 * requireAdmin is applied at the mount point.
 *
 * Routes:
 *   POST   /register         Register a skill
 *   GET    /                 List registered skills
 *   GET    /:id              Get skill details
 *   DELETE /:id              Deregister skill
 *   POST   /:id/invoke      Invoke a skill (placeholder)
 */
import crypto from "node:crypto";
import { Router } from "express";
import { logger } from "../../lib/logger";

const router = Router();

/* ── Types ────────────────────────────────────────────────────────── */

interface Skill {
  id: string;
  name: string;
  description: string;
  agentId: string;
  category: string;
  version: string;
  enabled: boolean;
  registeredAt: string;
  metadata: Record<string, unknown>;
}

/* ── In-memory registry ───────────────────────────────────────────── */

const MAX_SKILLS = 200;
const skills = new Map<string, Skill>();

function genId(): string {
  return `skill_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

/* ── POST /register — Register skill ──────────────────────────────── */

router.post("/register", (req, res) => {
  try {
    if (skills.size >= MAX_SKILLS) {
      return res.status(429).json({ error: "MAX_SKILLS_REACHED" });
    }

    const b = req.body || {};
    if (!b.name || !b.agentId) {
      return res.status(400).json({ error: "MISSING_FIELDS", message: "name and agentId required" });
    }

    const skill: Skill = {
      id: genId(),
      name: String(b.name).slice(0, 200),
      description: String(b.description || "").slice(0, 1000),
      agentId: String(b.agentId),
      category: String(b.category || "general"),
      version: String(b.version || "1.0.0"),
      enabled: b.enabled !== false,
      registeredAt: new Date().toISOString(),
      metadata: b.metadata && typeof b.metadata === "object" ? b.metadata : {},
    };

    skills.set(skill.id, skill);
    logger.info({ skillId: skill.id, name: skill.name }, "Skill registered");

    return res.status(201).json({ ok: true, skill });
  } catch (err: any) {
    logger.error({ err: err?.message }, "POST /skills/register failed");
    return res.status(500).json({ error: "SKILL_REGISTER_FAILED" });
  }
});

/* ── GET / — List skills ──────────────────────────────────────────── */

router.get("/", (req, res) => {
  const list = Array.from(skills.values());
  const agentId = req.query.agentId ? String(req.query.agentId) : null;
  const filtered = agentId ? list.filter(s => s.agentId === agentId) : list;
  return res.json({ ok: true, skills: filtered, total: filtered.length });
});

/* ── GET /:id — Skill details ─────────────────────────────────────── */

router.get("/:id", (req, res) => {
  const skill = skills.get(req.params.id);
  if (!skill) return res.status(404).json({ error: "SKILL_NOT_FOUND" });
  return res.json({ ok: true, skill });
});

/* ── DELETE /:id — Deregister skill ───────────────────────────────── */

router.delete("/:id", (req, res) => {
  if (!skills.delete(req.params.id)) {
    return res.status(404).json({ error: "SKILL_NOT_FOUND" });
  }
  return res.json({ ok: true, message: "Skill deregistered" });
});

/* ── POST /:id/invoke — Invoke skill (placeholder) ───────────────── */

router.post("/:id/invoke", (req, res) => {
  const skill = skills.get(req.params.id);
  if (!skill) return res.status(404).json({ error: "SKILL_NOT_FOUND" });

  if (!skill.enabled) {
    return res.status(403).json({ error: "SKILL_DISABLED" });
  }

  // TODO: actual invocation pipeline (dispatch to agent, track execution)
  logger.info({ skillId: skill.id, name: skill.name }, "Skill invoked (placeholder)");

  return res.json({
    ok: true,
    message: "Skill invocation accepted (placeholder)",
    skill: { id: skill.id, name: skill.name },
  });
});

export default router;
