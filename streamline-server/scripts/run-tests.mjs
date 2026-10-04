// Runs every compiled test file under dist/ with the Node test runner.
//
// `node --test "dist/**/*.test.js"` only expands globs on Node >= 21, and
// `node --test dist/lib` finds nothing on Node >= 21, so list the files
// explicitly to behave the same on Node 20 and 22.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] || "dist");

function collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && entry.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`[run-tests] ${root} not found; run the build first.`);
  process.exit(1);
}

const files = collect(root, []).sort();
if (files.length === 0) {
  console.error(`[run-tests] no *.test.js files under ${root}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
