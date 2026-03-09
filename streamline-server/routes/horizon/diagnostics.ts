/**
 * Horizon Diagnostics routes — runtime diagnostics + log queries.
 *
 * Mounted at `/api/horizon/diagnostics` in index.ts.
 * requireAdmin is applied at the mount point.
 *
 * Routes:
 *   GET /           Runtime diagnostics snapshot
 *   GET /env        Safe environment variable overview (no secrets)
 *   GET /deps       Key dependency versions
 */
import { Router } from "express";
import { logger } from "../../lib/logger";
import { getAppEnv, getTenantFromEnv } from "../../lib/runtimeContext";

const router = Router();

/* ── Safe env keys (no secrets) ───────────────────────────────────── */

const SAFE_ENV_KEYS = [
  "NODE_ENV",
  "APP_ENV",
  "TENANT",
  "PORT",
  "CLIENT_URL",
  "LIVEKIT_URL",
  "LOG_LEVEL",
];

/* ── GET / — Runtime snapshot ─────────────────────────────────────── */

router.get("/", (_req, res) => {
  try {
    return res.json({
      ok: true,
      ts: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      appEnv: getAppEnv(),
      tenant: getTenantFromEnv(),
      env: String(process.env.NODE_ENV || "development"),
      uptime: process.uptime(),
      versions: process.versions,
      features: {
        hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
        hasLivekitUrl: !!process.env.LIVEKIT_URL,
        hasLivekitApiKey: !!process.env.LIVEKIT_API_KEY,
        hasR2Endpoint: !!process.env.R2_ENDPOINT,
        hasFirebase: !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
      },
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "GET /diagnostics failed");
    return res.status(500).json({ error: "DIAGNOSTICS_FAILED" });
  }
});

/* ── GET /env — Safe environment overview ─────────────────────────── */

router.get("/env", (_req, res) => {
  try {
    const safe: Record<string, string | undefined> = {};
    for (const key of SAFE_ENV_KEYS) {
      safe[key] = process.env[key] || "(not set)";
    }
    return res.json({ ok: true, env: safe });
  } catch (err: any) {
    logger.error({ err: err?.message }, "GET /diagnostics/env failed");
    return res.status(500).json({ error: "DIAGNOSTICS_ENV_FAILED" });
  }
});

/* ── GET /deps — Key dependency info ──────────────────────────────── */

router.get("/deps", (_req, res) => {
  try {
    return res.json({
      ok: true,
      runtime: {
        node: process.version,
        v8: process.versions.v8,
        openssl: process.versions.openssl,
      },
    });
  } catch (err: any) {
    logger.error({ err: err?.message }, "GET /diagnostics/deps failed");
    return res.status(500).json({ error: "DIAGNOSTICS_DEPS_FAILED" });
  }
});

export default router;
