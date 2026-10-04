/**
 * Lightweight dependency checks for the admin Operations tab
 * (GET /api/admin/monitoring/services). Each check has a hard timeout and the
 * whole result is cached for 30s so dashboard refreshes don't hammer
 * LiveKit / Stripe / R2.
 *
 *   firestore  read config/features
 *   livekit    RoomService.listRooms()
 *   stripe     balance.retrieve()
 *   r2         ListObjectsV2 (1 key) on the media bucket
 */
import { firestore } from "../firebaseAdmin";
import { getLiveKitSdk } from "./livekit";
import { stripe } from "./stripe";
import { listKeysByPrefix } from "./storageClient";
import { createTtlCache, withTimeout } from "./adminMetricsPure";

export type ServiceStatus = "operational" | "degraded" | "down" | "not_configured" | "configured" | "enabled" | "disabled";

export type ServiceCheck = {
  name: string;
  label: string;
  status: ServiceStatus;
  latencyMs: number | null;
  detail: string | null;
  checkedAt: string;
};

const CHECK_TIMEOUT_MS = 4000;
const SLOW_MS = 1500;

async function timed(
  name: string,
  label: string,
  configured: boolean,
  run: () => Promise<string | null>
): Promise<ServiceCheck> {
  const checkedAt = new Date().toISOString();
  if (!configured) return { name, label, status: "not_configured", latencyMs: null, detail: null, checkedAt };
  const t0 = Date.now();
  try {
    const detail = await withTimeout(run(), CHECK_TIMEOUT_MS);
    const latencyMs = Date.now() - t0;
    return { name, label, status: latencyMs > SLOW_MS ? "degraded" : "operational", latencyMs, detail, checkedAt };
  } catch (err: any) {
    const msg = String(err?.message || err || "error");
    return {
      name,
      label,
      status: "down",
      latencyMs: Date.now() - t0,
      // Never echo credentials; SDK messages are short and safe, but cap them.
      detail: msg === "timeout" ? `No response within ${CHECK_TIMEOUT_MS}ms` : msg.slice(0, 200),
      checkedAt,
    };
  }
}

function livekitServiceUrl(): string | null {
  const raw = process.env.LIVEKIT_URL || "";
  if (!raw) return null;
  return raw.replace(/^wss?:\/\//i, (m) => (m.toLowerCase() === "ws://" ? "http://" : "https://"));
}

async function runChecks(): Promise<ServiceCheck[]> {
  const lkUrl = livekitServiceUrl();
  const lkKey = process.env.LIVEKIT_API_KEY;
  const lkSecret = process.env.LIVEKIT_API_SECRET;
  const r2Configured = Boolean(
    process.env.R2_BUCKET &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT)
  );

  const checks = await Promise.all([
    timed("firestore", "Firestore", true, async () => {
      await firestore.collection("config").doc("features").get();
      return null;
    }),
    timed("livekit", "LiveKit", Boolean(lkUrl && lkKey && lkSecret), async () => {
      const { RoomServiceClient } = await getLiveKitSdk();
      const client = new RoomServiceClient(lkUrl, lkKey, lkSecret);
      const rooms = (await client.listRooms()) || [];
      return `${rooms.length} active LiveKit room(s)`;
    }),
    timed("stripe", "Stripe", Boolean(process.env.STRIPE_SECRET_KEY), async () => {
      const bal = await stripe.balance.retrieve();
      return bal?.livemode ? "live mode" : "test mode";
    }),
    timed("r2", "R2 storage", r2Configured, async () => {
      await listKeysByPrefix("__healthcheck__/", 1);
      return null;
    }),
  ]);

  const now = new Date().toISOString();
  checks.unshift({ name: "api_server", label: "API server", status: "operational", latencyMs: 0, detail: `uptime ${Math.round(process.uptime())}s`, checkedAt: now });
  checks.push({
    name: "webhook_hooks",
    label: "Outbound webhooks",
    status: process.env.STREAMLINE_HOOKS_ENABLED === "true" ? "enabled" : "disabled",
    latencyMs: null,
    detail: null,
    checkedAt: now,
  });
  checks.push({
    name: "horizon_bot",
    label: "Horizon bot",
    status: process.env.HORIZON_WEBHOOK_URL && process.env.HORIZON_WEBHOOK_SECRET ? "configured" : "not_configured",
    latencyMs: null,
    detail: null,
    checkedAt: now,
  });
  checks.push({
    name: "email",
    label: "Outbound email",
    status: "not_configured",
    latencyMs: null,
    detail: "No email provider is integrated; support replies are sent out of band.",
    checkedAt: now,
  });
  return checks;
}

const cache = createTtlCache<ServiceCheck[]>(30_000, 2);

export async function getServiceHealth(opts: { fresh?: boolean } = {}): Promise<ServiceCheck[]> {
  if (opts.fresh) cache.clear();
  return cache.get("services", runChecks);
}
