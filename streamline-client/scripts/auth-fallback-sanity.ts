// Dev sanity script: simulates stale Authorization token being cleared after cookie fallback.
// Run from streamline-client/: `npx tsx scripts/auth-fallback-sanity.ts`

import { apiFetch } from "../src/lib/api";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

async function main() {
  // Provide a minimal window/localStorage for api.ts.
  (globalThis as any).window = {
    localStorage: makeLocalStorage(),
  };

  // Put a "valid-shape" but stale token in storage.
  window.localStorage.setItem("sl_token", "a.b.c");

  // Stub fetch to emulate /api/account/me returning 200 + fallback headers.
  (globalThis as any).fetch = async (_url: string, _init: any) => {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-sl-auth-fallback": "cookie",
        "x-sl-auth-header-invalid": "1",
      },
    });
  };

  await apiFetch("/api/account/me");

  const remaining = window.localStorage.getItem("sl_token");
  if (remaining) {
    throw new Error(`Expected sl_token to be cleared, but found: ${remaining}`);
  }

  // eslint-disable-next-line no-console
  console.log("[sanity] PASS: sl_token cleared after cookie fallback");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[sanity] FAIL", err);
  process.exitCode = 1;
});
