#!/usr/bin/env node
/**
 * Copies MediaPipe's vision WASM (used by @livekit/track-processors for
 * camera background blur / replacement) into public/mediapipe/wasm so it is
 * served from our own origin. By default the library fetches it from
 * cdn.jsdelivr.net, which some school/corporate networks block; then the
 * effect silently can't start. Output is gitignored and rebuilt on every
 * dev/build from the installed package version.
 */
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = path.join(__dirname, "..", "public", "mediapipe", "wasm");

if (!fs.existsSync(src)) {
  console.error(`[copy-mediapipe-wasm] ${src} not found. Run npm install first.`);
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(src)) {
  if (!/\.(js|wasm)$/.test(f)) continue;
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
  n++;
}
if (n === 0) {
  console.error("[copy-mediapipe-wasm] no WASM files copied");
  process.exit(1);
}
console.log(`[copy-mediapipe-wasm] copied ${n} files to public/mediapipe/wasm`);
