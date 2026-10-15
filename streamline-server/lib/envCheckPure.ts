/**
 * Server configuration check: which environment variables a deploy is missing.
 * Read by GET /api/health/ready (public: counts + areas only), GET
 * /api/health/config (admin: variable names) and the startup log.
 *
 * Never reads or returns values — only whether each one is set (and, for
 * STREAM_KEY_SECRET_V1, whether it has the right length).
 *
 * "required": a core feature fails without it (the readiness check returns 503).
 * "recommended": a feature degrades or is off (reported, readiness stays 200).
 * Rules mirror the code that reads each variable; keep them in sync.
 */

export type EnvSeverity = "required" | "recommended";

export type EnvRequirement = {
  /** Area shown publicly (no variable names). */
  area: string;
  /** Satisfied when ANY of these is set (alternatives the code accepts). */
  anyOf: string[];
  severity: EnvSeverity;
  /** What breaks without it (admin view + startup log). */
  impact: string;
  /** Only enforced in production/staging (the code has a dev default). */
  prodOnly?: boolean;
  /** Extra check on a set value; returns a problem description or null. */
  validate?: (value: string) => string | null;
};

export type EnvProblem = {
  area: string;
  variables: string[];
  severity: EnvSeverity;
  impact: string;
  problem: "missing" | "invalid";
  detail?: string;
};

export type EnvReport = {
  ok: boolean;
  env: string;
  missingRequired: EnvProblem[];
  missingRecommended: EnvProblem[];
};

function validStreamKeySecret(v: string): string | null {
  try {
    return Buffer.from(v, "base64").length === 32 ? null : "must be 32 bytes, base64-encoded";
  } catch {
    return "must be base64";
  }
}

function validHttpsUrl(v: string): string | null {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? null : "must be an http(s) URL";
  } catch {
    return "must be an absolute URL";
  }
}

export const ENV_REQUIREMENTS: EnvRequirement[] = [
  // Core platform
  {
    area: "database",
    anyOf: ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_SERVICE_ACCOUNT_BASE64", "FIREBASE_SERVICE_ACCOUNT_PATH", "GOOGLE_APPLICATION_CREDENTIALS"],
    severity: "required",
    impact: "Firestore / Firebase Admin can't authenticate: every API call fails.",
  },
  { area: "auth", anyOf: ["JWT_SECRET"], severity: "required", impact: "Sign-in, room access and invite tokens can't be signed." },
  { area: "app", anyOf: ["CLIENT_URL"], severity: "required", impact: "CORS for the frontend, Stripe and pay-per-view return URLs." , validate: validHttpsUrl },
  { area: "jobs", anyOf: ["MAINTENANCE_KEY"], severity: "required", impact: "The jobs cron can't run (recording finalize, purges, stuck-recording sweep)." },

  // Live video
  { area: "livekit", anyOf: ["LIVEKIT_URL"], severity: "required", impact: "Rooms, streaming and recording." },
  { area: "livekit", anyOf: ["LIVEKIT_API_KEY"], severity: "required", impact: "Rooms, streaming and recording." },
  { area: "livekit", anyOf: ["LIVEKIT_API_SECRET"], severity: "required", impact: "Rooms, streaming, recording and LiveKit webhooks." },

  // Storage (lib/storageClient.ts + services/livekitEgress.ts)
  { area: "storage", anyOf: ["R2_ACCESS_KEY_ID"], severity: "required", impact: "Uploads, recordings and HLS output." },
  { area: "storage", anyOf: ["R2_SECRET_ACCESS_KEY"], severity: "required", impact: "Uploads, recordings and HLS output." },
  { area: "storage", anyOf: ["R2_BUCKET"], severity: "required", impact: "Uploads, recordings and HLS output." },
  { area: "storage", anyOf: ["R2_ENDPOINT"], severity: "required", impact: "HLS egress writes segments to this endpoint (it has no R2_ACCOUNT_ID fallback).", validate: validHttpsUrl },
  {
    area: "hls",
    anyOf: ["HLS_PUBLIC_BASE_URL"],
    severity: "required",
    prodOnly: true,
    impact: "HLS start/status fail in production (viewer playlist URLs).",
    validate: validHttpsUrl,
  },

  // Secrets that throw or 500 in production when absent
  {
    area: "destinations",
    anyOf: ["STREAM_KEY_SECRET_V1"],
    severity: "required",
    impact: "Saving stream destinations fails (stream keys can't be encrypted).",
    validate: validStreamKeySecret,
  },
  {
    area: "monetization",
    anyOf: ["MONETIZATION_CODE_SALT"],
    severity: "required",
    prodOnly: true,
    impact: "Pay-per-view access codes fail in production.",
  },

  // Billing (checkout no-ops / 500s without these; may be intentionally off)
  { area: "billing", anyOf: ["STRIPE_SECRET_KEY"], severity: "recommended", impact: "Plan checkout and the billing portal are disabled." },
  { area: "billing", anyOf: ["STRIPE_WEBHOOK_SECRET"], severity: "recommended", impact: "Stripe webhooks are rejected: payments don't update plans." },
  { area: "billing", anyOf: ["STRIPE_PRICE_STARTER"], severity: "recommended", impact: "Starter checkout returns 500." },
  { area: "billing", anyOf: ["STRIPE_PRICE_BASIC"], severity: "recommended", impact: "Basic checkout returns 500." },
  { area: "billing", anyOf: ["STRIPE_PRICE_PRO"], severity: "recommended", impact: "Pro checkout returns 500." },

  // Degraded features
  {
    area: "layouts",
    anyOf: ["EGRESS_TEMPLATE_BASE_URL", "RENDER_EXTERNAL_URL"],
    severity: "recommended",
    impact: "Streams and recordings ignore the host's layout and branding (LiveKit default layout).",
  },
  { area: "auth", anyOf: ["ROOM_ACCESS_TOKEN_SECRET"], severity: "recommended", impact: "Room tokens fall back to JWT_SECRET (works, but shares one key)." },
  { area: "support", anyOf: ["SUPPORT_TICKET_HASH_SALT"], severity: "recommended", impact: "Support tickets use a built-in default salt." },
];

function isSet(env: Record<string, string | undefined>, name: string): boolean {
  return String(env[name] ?? "").trim().length > 0;
}

export function checkEnv(env: Record<string, string | undefined>, requirements: EnvRequirement[] = ENV_REQUIREMENTS): EnvReport {
  const envName = String(env.NODE_ENV || "development").toLowerCase();
  const prodLike = envName === "production" || envName === "staging";
  const missingRequired: EnvProblem[] = [];
  const missingRecommended: EnvProblem[] = [];

  for (const r of requirements) {
    if (r.prodOnly && !prodLike) continue;
    const present = r.anyOf.find((n) => isSet(env, n));
    let problem: EnvProblem | null = null;
    if (!present) {
      problem = { area: r.area, variables: r.anyOf, severity: r.severity, impact: r.impact, problem: "missing" };
    } else if (r.validate) {
      const detail = r.validate(String(env[present]).trim());
      if (detail) problem = { area: r.area, variables: [present], severity: r.severity, impact: r.impact, problem: "invalid", detail };
    }
    if (!problem) continue;
    (r.severity === "required" ? missingRequired : missingRecommended).push(problem);
  }

  return { ok: missingRequired.length === 0, env: envName, missingRequired, missingRecommended };
}

/** Public shape: no variable names, just whether it's ready and which areas are affected. */
export function publicEnvReport(report: EnvReport): {
  ok: boolean;
  config: { missingRequired: number; missingRecommended: number; areas: string[] };
} {
  const areas = Array.from(new Set([...report.missingRequired, ...report.missingRecommended].map((p) => p.area))).sort();
  return {
    ok: report.ok,
    config: { missingRequired: report.missingRequired.length, missingRecommended: report.missingRecommended.length, areas },
  };
}
