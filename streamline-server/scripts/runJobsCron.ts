/**
 * Render cron backstop for the scheduled jobs (lib/jobs).
 *
 * POSTs /api/maintenance/jobs/run-due with x-maintenance-key. The web
 * instance runs every job whose interval has elapsed (Firestore leases make
 * it safe alongside the in-process scheduler). On the free plan the web
 * service sleeps when idle; this request wakes it, so retries cover the
 * cold start.
 *
 * Env:
 *   MAINTENANCE_KEY         required (same value as the web service)
 *   MAINTENANCE_JOBS_URL    https://<backend>/api/maintenance/jobs/run-due
 *                           (optional when MAINTENANCE_BASE_URL or the legacy
 *                           MAINTENANCE_EXPIRE_URL is set: the origin is taken
 *                           from it)
 *   MAINTENANCE_BASE_URL    https://<backend> (optional)
 *   MAINTENANCE_EXPIRE_URL  legacy; only its origin is used
 *   MAINTENANCE_METER_URL   legacy; ignored (the meter sweep is a job now)
 */
import http from "http";
import https from "https";

const RUN_DUE_PATH = "/api/maintenance/jobs/run-due";

export function resolveJobsUrl(env: Record<string, string | undefined>): string | null {
  const direct = String(env.MAINTENANCE_JOBS_URL || "").trim();
  if (direct) return direct;
  for (const k of ["MAINTENANCE_BASE_URL", "MAINTENANCE_EXPIRE_URL"]) {
    const raw = String(env[k] || "").trim();
    if (!raw) continue;
    try {
      return new URL(RUN_DUE_PATH, new URL(raw).origin).toString();
    } catch {
      // try the next one
    }
  }
  return null;
}

function postJson(urlStr: string, headers: Record<string, string>, timeoutMs: number): Promise<{ status: number; body: string }> {
  const url = new URL(urlStr);
  const mod = url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        headers: { "Content-Type": "application/json", "User-Agent": "streamline-cron/run-jobs", ...headers },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += String(chunk)));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.write("{}");
    req.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const url = resolveJobsUrl(process.env);
  if (!url) throw new Error("Set MAINTENANCE_JOBS_URL (or MAINTENANCE_BASE_URL / MAINTENANCE_EXPIRE_URL)");
  const key = String(process.env.MAINTENANCE_KEY || "").trim();
  if (!key) throw new Error("Missing env var: MAINTENANCE_KEY");

  // Cold start of a sleeping free-plan instance can take ~1 min: retry 502/503/504 and network errors.
  const attempts = 4;
  for (let i = 1; i <= attempts; i++) {
    try {
      const resp = await postJson(url, { "x-maintenance-key": key }, 10 * 60_000);
      if (resp.status >= 200 && resp.status < 300) {
        console.log(resp.body);
        return;
      }
      const retryable = resp.status === 502 || resp.status === 503 || resp.status === 504 || resp.status === 0;
      console.error("run-due call failed", { attempt: i, status: resp.status, body: resp.body.slice(0, 2000) });
      if (!retryable) process.exit(1);
    } catch (e: any) {
      console.error("run-due call error", { attempt: i, error: e?.message || e });
    }
    if (i < attempts) await sleep(15_000 * i);
  }
  process.exit(1);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e?.message || e);
    process.exit(1);
  });
}
