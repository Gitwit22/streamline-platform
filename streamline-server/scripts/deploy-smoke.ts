import "dotenv/config";

type HttpResult = {
  url: string;
  status: number;
  text: string;
  json: any;
  headers: Headers;
};

const API_BASE = process.env.API_BASE || "http://localhost:5137";
const ROOM_ID = (process.env.SMOKE_ROOM_ID || "").trim();

const ROLE = (process.env.SMOKE_ROLE || "host").trim();

const EMAIL = process.env.SMOKE_EMAIL || "";
const PASSWORD = process.env.SMOKE_PASSWORD || "";
const PROVIDED_JWT = (process.env.SMOKE_JWT || "").trim();

const DO_HLS = process.env.SMOKE_HLS === "true" || process.env.SMOKE_HLS === "1";
const DO_RECORDING = process.env.SMOKE_RECORDING === "true" || process.env.SMOKE_RECORDING === "1";

function fatal(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

async function fetchJson(urlOrPath: string, init: RequestInit = {}): Promise<HttpResult> {
  const url = urlOrPath.startsWith("http") ? urlOrPath : `${API_BASE}${urlOrPath}`;
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { url, status: res.status, text, json, headers: res.headers };
}

async function loginAndGetJwt(email: string, password: string): Promise<string> {
  const resp = await fetchJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Login failed (${resp.status}): ${resp.text.slice(0, 200)}`);
  }
  const token = resp.json?.token;
  if (!token || typeof token !== "string") {
    throw new Error("Login response missing token");
  }
  return token;
}

function printStep(name: string, ok: boolean, details: string) {
  const icon = ok ? "✅" : "❌";
  console.log(`${icon} ${name}: ${details}`);
}

async function main() {
  if (!ROOM_ID) {
    fatal("Missing SMOKE_ROOM_ID (Firestore room id). Example: SMOKE_ROOM_ID=abc123");
  }

  console.log("\n=== Streamline deploy smoke checks ===");
  console.log("API_BASE:", API_BASE);
  console.log("ROOM_ID:", ROOM_ID);
  console.log("ROLE:", ROLE);

  // 1) Health endpoint without auth should be blocked.
  {
    const resp = await fetchJson("/api/health/config");
    const ok = resp.status === 401 || resp.status === 403;
    printStep("GET /api/health/config (no auth)", ok, `status=${resp.status}`);
    if (!ok) {
      console.log("  body:", resp.text.slice(0, 200));
    }
  }

  // 2) Token mint without auth should usually be 401 (auth-only).
  {
    const resp = await fetchJson(`/api/rooms/${encodeURIComponent(ROOM_ID)}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: "Smoke", displayName: "Smoke", role: ROLE }),
    });
    const grants = resp.headers.get("x-sl-token-grants") || "(missing)";
    const ok = resp.status === 401 || resp.status === 403 || resp.status === 404 || resp.status === 402 || resp.status === 409;
    printStep("POST /api/rooms/:roomId/token (no auth)", ok, `status=${resp.status} grants=${grants}`);
    if (!ok) {
      console.log("  body:", resp.text.slice(0, 200));
    }
  }

  // 3) Acquire JWT
  let jwtToken = PROVIDED_JWT;
  if (!jwtToken && EMAIL && PASSWORD) {
    console.log("\nFetching auth token via /api/auth/login...");
    jwtToken = await loginAndGetJwt(EMAIL, PASSWORD);
  }

  if (!jwtToken) {
    console.log("\nSkipping authenticated checks (set SMOKE_JWT or SMOKE_EMAIL+SMOKE_PASSWORD).\n");
    return;
  }

  // 4) Health endpoint with auth
  {
    const resp = await fetchJson("/api/health/config", {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    const ok = resp.status === 200 && resp.json && typeof resp.json === "object";
    const tokenGrants = resp.json?.tokenGrants;
    printStep("GET /api/health/config (auth)", ok, `status=${resp.status} tokenGrants=${tokenGrants ?? "(missing)"}`);
    if (!ok) {
      console.log("  body:", resp.text.slice(0, 200));
    }
  }

  // 5) Mint room token (auth)
  let roomAccessToken = "";
  let roomName = "";
  {
    const resp = await fetchJson(`/api/rooms/${encodeURIComponent(ROOM_ID)}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({ identity: "Smoke", displayName: "Smoke", role: ROLE }),
    });

    const grants = resp.headers.get("x-sl-token-grants") || "(missing)";
    const ok = resp.status === 200 && typeof resp.json?.token === "string" && typeof resp.json?.serverUrl === "string";
    printStep("POST /api/rooms/:roomId/token (auth)", ok, `status=${resp.status} grants=${grants}`);

    if (!ok) {
      console.log("  body:", resp.text.slice(0, 200));
      return;
    }

    roomAccessToken = String(resp.json?.roomAccessToken || "");
    roomName = String(resp.json?.roomName || "");

    const tokenOk = !!resp.json?.token;
    const serverUrlOk = !!resp.json?.serverUrl;
    const identityOk = typeof resp.json?.participantIdentity === "string" && !!resp.json?.participantIdentity;
    const roomAccessOk = typeof resp.json?.roomAccessToken === "string" && !!resp.json?.roomAccessToken;

    printStep("token fields", tokenOk && serverUrlOk && identityOk && roomAccessOk, `serverUrl=${resp.json?.serverUrl}`);
  }

  if (!roomAccessToken) {
    console.log("\nSkipping HLS/recording checks (no roomAccessToken in token response).\n");
    return;
  }

  // Optional: HLS start/stop
  if (DO_HLS) {
    console.log("\n--- HLS checks (optional) ---");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Cookie: `token=${jwtToken}`,
      Authorization: `Bearer ${roomAccessToken}`,
    };

    const start = await fetchJson(`/api/hls/start/${encodeURIComponent(ROOM_ID)}`, { method: "POST", headers });
    printStep("POST /api/hls/start/:roomId", start.status >= 200 && start.status < 500, `status=${start.status}`);

    const stop = await fetchJson(`/api/hls/stop/${encodeURIComponent(ROOM_ID)}`, { method: "POST", headers });
    printStep("POST /api/hls/stop/:roomId", stop.status >= 200 && stop.status < 500, `status=${stop.status}`);
  }

  // Optional: Recording start/stop (can be disruptive)
  if (DO_RECORDING) {
    console.log("\n--- Recording checks (optional; may start egress) ---");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Cookie: `token=${jwtToken}`,
      Authorization: `Bearer ${roomAccessToken}`,
    };

    const startBody = {
      roomId: ROOM_ID,
      roomName: roomName || ROOM_ID,
      layout: "grid",
      mode: "cloud",
    };

    const start = await fetchJson("/api/recordings/start", {
      method: "POST",
      headers,
      body: JSON.stringify(startBody),
    });

    const recordingId = String(start.json?.recordingId || start.json?._id || start.json?.id || "");
    printStep("POST /api/recordings/start", start.status >= 200 && start.status < 500, `status=${start.status} recordingId=${recordingId || "(none)"}`);

    if (recordingId) {
      const stop = await fetchJson("/api/recordings/stop", {
        method: "POST",
        headers,
        body: JSON.stringify({ recordingId, roomId: ROOM_ID }),
      });
      printStep("POST /api/recordings/stop", stop.status >= 200 && stop.status < 500, `status=${stop.status}`);
    }
  }

  console.log("\nDone.\n");
}

main().catch((err) => {
  console.error("\n❌ Smoke checks crashed:");
  console.error(err);
  process.exit(1);
});
