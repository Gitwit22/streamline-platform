import https from "https";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function postJson(urlStr: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const url = new URL(urlStr);

  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: "POST",
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "streamline-cron/expire-emergency",
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += String(chunk)));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );

    req.on("error", reject);
    req.write("{}");
    req.end();
  });
}

async function main() {
  const url = requireEnv("MAINTENANCE_EXPIRE_URL");
  const key = process.env.MAINTENANCE_KEY;

  const headers: Record<string, string> = {};
  if (key) headers["x-maintenance-key"] = key;

  const resp = await postJson(url, headers);
  let failed = false;
  if (resp.status < 200 || resp.status >= 300) {
    console.error("cron call failed", { status: resp.status, body: resp.body });
    failed = true;
  } else {
    console.log(resp.body);
  }

  // Optional: streaming meter sweep (bills running outputs, closes outputs
  // that ended without a stop call, enforces monthly/session caps).
  const meterUrl = process.env.MAINTENANCE_METER_URL;
  if (meterUrl) {
    const meterResp = await postJson(meterUrl, headers);
    if (meterResp.status < 200 || meterResp.status >= 300) {
      console.error("meter sweep call failed", { status: meterResp.status, body: meterResp.body });
      failed = true;
    } else {
      console.log(meterResp.body);
    }
  }

  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
