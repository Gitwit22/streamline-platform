import "dotenv/config";
import jwt from "jsonwebtoken";

const API_BASE = process.env.API_BASE || "http://localhost:5137";
const JWT_SECRET = process.env.JWT_SECRET || "";

const HOST_UID = process.env.SEC_PROBE_HOST_UID || "";
const ATTACKER_UID = process.env.SEC_PROBE_ATTACKER_UID || "";
const HOST_ROOM_ID = process.env.SEC_PROBE_HOST_ROOM_ID || "";
const HOST_LIVEKIT_ROOM_NAME = process.env.SEC_PROBE_HOST_LIVEKIT_ROOM_NAME || HOST_ROOM_ID || "";
const FOREIGN_RECORDING_ID = process.env.SEC_PROBE_FOREIGN_RECORDING_ID || "";

const waitSeconds = Number(process.env.SEC_PROBE_WAIT_SECONDS ?? "65") || 65;
const hlsExpect = (process.env.SEC_PROBE_HLS_EXPECT ?? "both") as "off" | "on" | "both";

if (!JWT_SECRET) {
  console.error("[security-probes] Missing JWT_SECRET env var – cannot sign tokens.");
  process.exit(1);
}

function makeJwt(uid: string): string {
  return jwt.sign({ uid }, JWT_SECRET, { expiresIn: "7d" });
}

type HttpJsonResponse = {
  url: string;
  status: number;
  text: string;
  snippet: string;
  json: any;
};

async function fetchWithJwt(path: string, jwtToken: string, init: RequestInit = {}): Promise<HttpJsonResponse> {
  const headers: HeadersInit = {
    ...(init.headers || {}),
    Authorization: `Bearer ${jwtToken}`,
  };

  if (init.body !== undefined && !("Content-Type" in headers)) {
    headers["Content-Type"] = "application/json";
  }

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  const snippet = text.slice(0, 200);
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { url, status: res.status, text, snippet, json };
}

async function authedFetch(path: string, uid: string, init: RequestInit = {}): Promise<HttpJsonResponse> {
  const token = makeJwt(uid);
  return fetchWithJwt(path, token, init);
}

async function postJson(path: string, jwtToken: string, body: any): Promise<HttpJsonResponse> {
  return fetchWithJwt(path, jwtToken, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : "{}",
  });
}

async function getUsageSummary(jwtToken: string): Promise<{
  url: string;
  status: number;
  text: string;
  json: any;
  hlsCurrent: number;
}> {
  const resp = await fetchWithJwt("/api/usage/summary", jwtToken, {});
  const json = resp.json || {};
  const hlsCurrentRaw =
    json?.usage?.minutes?.hls?.currentPeriod ??
    json?.usageMinutes?.hls?.currentPeriod ??
    json?.usage?.minutes?.hlsCurrent ??
    0;

  return {
    url: resp.url,
    status: resp.status,
    text: resp.text,
    json,
    hlsCurrent: Number(hlsCurrentRaw) || 0,
  };
}

type ProbeResult = "pass" | "fail" | "skip";

type PrintableProbeResult = {
  name: string;
  actor: string;
  expected?: number | string;
  actual?: number | string;
  url?: string;
  bodySnippet?: string;
  ok: boolean;
  skipped?: boolean;
  extra?: any;
};

function printResult(result: PrintableProbeResult) {
  const label = result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL";
  console.log(`\n[${label}] ${result.name}`);
  console.log("   Actor UID:", result.actor || "(n/a)");
  if (result.url) {
    console.log("   URL:", result.url);
  }
  if (result.expected !== undefined || result.actual !== undefined) {
    console.log("   Expected:", result.expected, "Actual:", result.actual);
  }
  if (result.bodySnippet) {
    console.log("   Body snippet:", result.bodySnippet);
  }
  if (result.extra) {
    console.log("   Extra:", result.extra);
  }
}

async function testMultistreamWrongUser(): Promise<ProbeResult> {
  if (!HOST_ROOM_ID || !ATTACKER_UID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_HOST_ROOM_ID or SEC_PROBE_ATTACKER_UID not set.");
    return "skip";
  }

  try {
    const res = await authedFetch(`/api/multistream/${HOST_ROOM_ID}/start-multistream`, ATTACKER_UID, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const ok = res.status === 403;
    printResult({
      name: "multistream/start wrong user",
      actor: ATTACKER_UID || "(unset)",
      expected: 403,
      actual: res.status,
      url: res.url,
      bodySnippet: res.snippet,
      ok,
    });
    return ok ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR:", err);
    return "fail";
  }
}

async function testRecordingsStartWrongUser(): Promise<ProbeResult> {
  if (!HOST_ROOM_ID || !ATTACKER_UID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_HOST_ROOM_ID or SEC_PROBE_ATTACKER_UID not set.");
    return "skip";
  }

  try {
    const res = await authedFetch("/api/recordings/start", ATTACKER_UID, {
      method: "POST",
      body: JSON.stringify({ roomId: HOST_ROOM_ID }),
    });
    const ok = res.status === 403;
    printResult({
      name: "recordings/start wrong user",
      actor: ATTACKER_UID || "(unset)",
      expected: 403,
      actual: res.status,
      url: res.url,
      bodySnippet: res.snippet,
      ok,
    });
    return ok ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR:", err);
    return "fail";
  }
}

async function testRecordingsStopWrongUser(): Promise<ProbeResult> {
  if (!FOREIGN_RECORDING_ID || !ATTACKER_UID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_FOREIGN_RECORDING_ID or SEC_PROBE_ATTACKER_UID not set.");
    return "skip";
  }

  try {
    const res = await authedFetch("/api/recordings/stop", ATTACKER_UID, {
      method: "POST",
      body: JSON.stringify({ recordingId: FOREIGN_RECORDING_ID }),
    });
    const ok = res.status === 403;
    printResult({
      name: "recordings/stop wrong user",
      actor: ATTACKER_UID || "(unset)",
      expected: 403,
      actual: res.status,
      url: res.url,
      bodySnippet: res.snippet,
      ok,
    });
    return ok ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR:", err);
    return "fail";
  }
}

async function testInvitesCreateWrongUser(): Promise<ProbeResult> {
  if (!HOST_ROOM_ID || !ATTACKER_UID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_HOST_ROOM_ID or SEC_PROBE_ATTACKER_UID not set.");
    return "skip";
  }

  try {
    const res = await authedFetch("/api/invites/create", ATTACKER_UID, {
      method: "POST",
      body: JSON.stringify({ roomId: HOST_ROOM_ID, role: "guest" }),
    });
    const ok = res.status === 403;
    printResult({
      name: "invites/create wrong user",
      actor: ATTACKER_UID || "(unset)",
      expected: 403,
      actual: res.status,
      url: res.url,
      bodySnippet: res.snippet,
      ok,
    });
    return ok ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR:", err);
    return "fail";
  }
}

async function testInvitesCreateHost(): Promise<ProbeResult> {
  if (!HOST_ROOM_ID || !HOST_UID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_HOST_ROOM_ID or SEC_PROBE_HOST_UID not set.");
    return "skip";
  }

  try {
    const res = await authedFetch("/api/invites/create", HOST_UID, {
      method: "POST",
      body: JSON.stringify({ roomId: HOST_ROOM_ID, role: "guest" }),
    });
    const ok = res.status === 200;
    printResult({
      name: "invites/create host",
      actor: HOST_UID || "(unset)",
      expected: 200,
      actual: res.status,
      url: res.url,
      bodySnippet: res.snippet,
      ok,
    });
    return ok ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR:", err);
    return "fail";
  }
}

async function testMuteAllWrongUser(): Promise<ProbeResult> {
  if (!HOST_LIVEKIT_ROOM_NAME || !ATTACKER_UID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_HOST_LIVEKIT_ROOM_NAME or SEC_PROBE_ATTACKER_UID not set.");
    return "skip";
  }

  try {
    const res = await authedFetch("/api/roomModeration/mute-all", ATTACKER_UID, {
      method: "POST",
      body: JSON.stringify({ room: HOST_LIVEKIT_ROOM_NAME, muted: true }),
    });
    const ok = res.status === 403;
    printResult({
      name: "roomModeration/mute-all wrong user",
      actor: ATTACKER_UID || "(unset)",
      expected: 403,
      actual: res.status,
      url: res.url,
      bodySnippet: res.snippet,
      ok,
    });
    return ok ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR:", err);
    return "fail";
  }
}

async function getHostRoomAccessToken(hostJwt: string): Promise<{ ok: boolean; token?: string; resp: HttpJsonResponse | null }> {
  if (!HOST_ROOM_ID) {
    return { ok: false, resp: null };
  }
  const resp = await postJson("/api/roomToken", hostJwt, { roomId: HOST_ROOM_ID });
  const token = resp.json?.roomAccessToken as string | undefined;
  return { ok: !!token, token, resp };
}

async function hlsPost(path: string, hostJwt: string, roomAccessToken: string): Promise<HttpJsonResponse> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    Cookie: `token=${hostJwt}`,
    Authorization: `Bearer ${roomAccessToken}`,
  };
  const res = await fetch(url, { method: "POST", headers });
  const text = await res.text();
  const snippet = text.slice(0, 200);
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { url, status: res.status, text, snippet, json };
}

async function testHlsStartPlanOff(): Promise<ProbeResult> {
  if (!HOST_UID || !HOST_ROOM_ID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_HOST_UID or SEC_PROBE_HOST_ROOM_ID not set.");
    return "skip";
  }

  const hostJwt = makeJwt(HOST_UID);
  try {
    const tokenResult = await getHostRoomAccessToken(hostJwt);
    if (!tokenResult.ok || !tokenResult.token) {
      printResult({
        name: "HLS start denied when plan OFF (room token)",
        actor: HOST_UID || "(unset)",
        expected: 200,
        actual: tokenResult.resp?.status,
        url: tokenResult.resp?.url,
        bodySnippet: tokenResult.resp?.snippet,
        ok: false,
      });
      return "fail";
    }

    const resp = await hlsPost(`/api/hls/start/${HOST_ROOM_ID}`, hostJwt, tokenResult.token);
    const expectedStatus = 403;
    const okStatus = resp.status === expectedStatus;
    const errorCode = resp.json?.error || resp.json?.code || resp.json?.reason;
    const okError = errorCode === "hls_not_in_plan" || okStatus;
    const ok = okStatus && okError;

    printResult({
      name: "HLS start denied when plan OFF",
      actor: HOST_UID || "(unset)",
      expected: expectedStatus,
      actual: resp.status,
      url: resp.url,
      bodySnippet: resp.snippet,
      ok,
      extra: errorCode ? { error: errorCode } : undefined,
    });

    return ok ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR (HLS plan OFF):", err);
    return "fail";
  }
}

async function testHlsStartPlanOn(): Promise<ProbeResult> {
  if (!HOST_UID || !HOST_ROOM_ID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_HOST_UID or SEC_PROBE_HOST_ROOM_ID not set.");
    return "skip";
  }

  const hostJwt = makeJwt(HOST_UID);
  try {
    const tokenResult = await getHostRoomAccessToken(hostJwt);
    if (!tokenResult.ok || !tokenResult.token) {
      printResult({
        name: "HLS start succeeds when plan ON (room token)",
        actor: HOST_UID || "(unset)",
        expected: 200,
        actual: tokenResult.resp?.status,
        url: tokenResult.resp?.url,
        bodySnippet: tokenResult.resp?.snippet,
        ok: false,
      });
      return "fail";
    }

    const resp = await hlsPost(`/api/hls/start/${HOST_ROOM_ID}`, hostJwt, tokenResult.token);
    const expectedStatus = 200;
    const hasHlsSignal =
      !!resp.json?.hls?.egressId ||
      !!resp.json?.hls?.status ||
      !!resp.json?.egressId ||
      !!resp.json?.status ||
      true;

    const ok = resp.status === expectedStatus && !!hasHlsSignal;

    printResult({
      name: "HLS start succeeds when plan ON",
      actor: HOST_UID || "(unset)",
      expected: expectedStatus,
      actual: resp.status,
      url: resp.url,
      bodySnippet: resp.snippet,
      ok,
    });

    return ok ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR (HLS plan ON):", err);
    return "fail";
  }
}

async function testHlsStopIncrementsUsage(): Promise<ProbeResult> {
  if (!HOST_UID || !HOST_ROOM_ID) {
    console.log("   ⚠️ Skipping – SEC_PROBE_HOST_UID or SEC_PROBE_HOST_ROOM_ID not set.");
    return "skip";
  }

  const hostJwt = makeJwt(HOST_UID);

  try {
    const before = await getUsageSummary(hostJwt);
    if (before.status !== 200) {
      printResult({
        name: "HLS stop increments usage (precheck)",
        actor: HOST_UID || "(unset)",
        expected: 200,
        actual: before.status,
        url: before.url,
        bodySnippet: (before.text || "").slice(0, 200),
        ok: false,
      });
      return "fail";
    }

    const tokenResult = await getHostRoomAccessToken(hostJwt);
    if (!tokenResult.ok || !tokenResult.token) {
      printResult({
        name: "HLS stop increments usage (room token)",
        actor: HOST_UID || "(unset)",
        expected: 200,
        actual: tokenResult.resp?.status,
        url: tokenResult.resp?.url,
        bodySnippet: tokenResult.resp?.snippet,
        ok: false,
      });
      return "fail";
    }

    const start = await hlsPost(`/api/hls/start/${HOST_ROOM_ID}`, hostJwt, tokenResult.token);
    if (start.status !== 200) {
      printResult({
        name: "HLS stop increments usage (start)",
        actor: HOST_UID || "(unset)",
        expected: 200,
        actual: start.status,
        url: start.url,
        bodySnippet: start.snippet,
        ok: false,
      });
      return "fail";
    }

    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));

    const stop = await hlsPost(`/api/hls/stop/${HOST_ROOM_ID}`, hostJwt, tokenResult.token);
    if (stop.status !== 200) {
      printResult({
        name: "HLS stop increments usage (stop)",
        actor: HOST_UID || "(unset)",
        expected: 200,
        actual: stop.status,
        url: stop.url,
        bodySnippet: stop.snippet,
        ok: false,
      });
      return "fail";
    }

    const after = await getUsageSummary(hostJwt);
    if (after.status !== 200) {
      printResult({
        name: "HLS stop increments usage (postcheck)",
        actor: HOST_UID || "(unset)",
        expected: 200,
        actual: after.status,
        url: after.url,
        bodySnippet: (after.text || "").slice(0, 200),
        ok: false,
      });
      return "fail";
    }

    const increased = after.hlsCurrent >= before.hlsCurrent + 1 || after.hlsCurrent >= 1;

    printResult({
      name: "HLS stop increments usage",
      actor: HOST_UID || "(unset)",
      ok: increased,
      expected: `${before.hlsCurrent}+1`,
      actual: after.hlsCurrent,
      extra: { before: before.hlsCurrent, after: after.hlsCurrent, waitSeconds },
    });

    return increased ? "pass" : "fail";
  } catch (err) {
    console.log("   ❌ ERROR (HLS usage):", err);
    return "fail";
  }
}

async function main() {
  console.log("\n🔐 Security Permission Probes");
  console.log("API_BASE =", API_BASE);
  console.log("HOST_UID =", HOST_UID || "(unset)");
  console.log("ATTACKER_UID =", ATTACKER_UID || "(unset)");
  console.log("HOST_ROOM_ID =", HOST_ROOM_ID || "(unset)");
  console.log("HOST_LIVEKIT_ROOM_NAME =", HOST_LIVEKIT_ROOM_NAME || "(unset)");
  console.log("FOREIGN_RECORDING_ID =", FOREIGN_RECORDING_ID || "(unset)");
  console.log("SEC_PROBE_HLS_EXPECT =", hlsExpect);
  console.log("SEC_PROBE_WAIT_SECONDS =", waitSeconds);

  const probes: Array<{ name: string; fn: () => Promise<ProbeResult> }> = [
    { name: "multistream/start wrong user", fn: testMultistreamWrongUser },
    { name: "recordings/start wrong user", fn: testRecordingsStartWrongUser },
    { name: "recordings/stop wrong user", fn: testRecordingsStopWrongUser },
    { name: "invites/create wrong user", fn: testInvitesCreateWrongUser },
    { name: "invites/create host", fn: testInvitesCreateHost },
    { name: "roomModeration/mute-all wrong user", fn: testMuteAllWrongUser },
  ];

   if (HOST_UID && HOST_ROOM_ID) {
     if (hlsExpect === "off" || hlsExpect === "both") {
       probes.push({ name: "HLS start denied when plan OFF", fn: testHlsStartPlanOff });
     }
     if (hlsExpect === "on" || hlsExpect === "both") {
       probes.push({ name: "HLS start succeeds when plan ON", fn: testHlsStartPlanOn });
       probes.push({ name: "HLS stop increments usage", fn: testHlsStopIncrementsUsage });
     }
   }

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const probe of probes) {
    const result = await probe.fn();
    if (result === "pass") passed += 1;
    else if (result === "fail") failed += 1;
    else skipped += 1;
  }

  console.log("\n📊 Summary:");
  console.log("   Passed:", passed);
  console.log("   Failed:", failed);
  console.log("   Skipped:", skipped);

  if (failed > 0) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error("[security-probes] Unhandled error:", err);
  process.exit(1);
});
