import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// lib/programPresets.ts is the single source of truth for program layouts.
// streamline-client/src/lib/programPresets.ts must be a byte-for-byte copy so
// the in-room stage renders exactly like the egress compositor.

// Works from lib/ (tsx) and dist/lib/ (compiled tests).
const SERVER_ROOT = [path.resolve(__dirname, "..", ".."), path.resolve(__dirname, ".."), process.cwd()].find((p) =>
  fs.existsSync(path.join(p, "lib", "programPresets.ts")),
);

test("client programPresets.ts is identical to the server copy", (t) => {
  if (!SERVER_ROOT) {
    t.skip("server lib/programPresets.ts not found");
    return;
  }
  const serverFile = path.join(SERVER_ROOT, "lib", "programPresets.ts");
  const clientFile = path.resolve(SERVER_ROOT, "..", "streamline-client", "src", "lib", "programPresets.ts");
  if (!fs.existsSync(clientFile)) {
    t.skip("streamline-client not checked out next to streamline-server");
    return;
  }
  const a = fs.readFileSync(serverFile, "utf8");
  const b = fs.readFileSync(clientFile, "utf8");
  assert.ok(
    a === b,
    "streamline-client/src/lib/programPresets.ts differs from streamline-server/lib/programPresets.ts; " +
      "copy the server file over the client file (cp streamline-server/lib/programPresets.ts streamline-client/src/lib/programPresets.ts)",
  );
});
