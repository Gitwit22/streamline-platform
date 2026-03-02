import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const ROOT = process.cwd();
const HOOK = path.join(ROOT, "streamline-client", "src", "hooks", "useDestinationsStartPayload.ts");
const BASELINE = path.join(ROOT, "scripts", "destinations-anchors.out.txt");

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function dedent(text) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length);
  if (!nonEmpty.length) return text;

  const indents = nonEmpty.map((l) => {
    const m = l.match(/^[ \t]*/);
    return m ? m[0].length : 0;
  });
  const minIndent = Math.min(...indents);
  const out = lines.map((l) => (l.length >= minIndent ? l.slice(minIndent) : l));
  return out.join("\n");
}

function findNeedle(source, needle, fromIndex = 0) {
  const variants = [needle];
  if (needle.includes("\n")) variants.push(needle.replaceAll("\n", "\r\n"));
  if (needle.includes("\r\n")) variants.push(needle.replaceAll("\r\n", "\n"));

  for (const v of variants) {
    const idx = source.indexOf(v, fromIndex);
    if (idx >= 0) return { idx, used: v };
  }
  return { idx: -1, used: needle };
}

function sliceFromNeedleToNeedleInclusive(source, startNeedle, endNeedle) {
  const startHit = findNeedle(source, startNeedle);
  if (startHit.idx < 0) throw new Error(`Missing start: ${startNeedle}`);

  const startLineIdx = Math.max(0, source.lastIndexOf("\n", startHit.idx) + 1);

  const endHit = findNeedle(source, endNeedle, startHit.idx + startHit.used.length);
  if (endHit.idx < 0) throw new Error(`Missing end: ${endNeedle}`);

  return source.slice(startLineIdx, endHit.idx + endHit.used.length);
}

function sliceBetweenInner(source, startNeedle, endNeedle) {
  const startHit = findNeedle(source, startNeedle);
  if (startHit.idx < 0) throw new Error(`Missing start: ${startNeedle}`);
  const startInner = startHit.idx + startHit.used.length;

  const endHit = findNeedle(source, endNeedle, startInner);
  if (endHit.idx < 0) throw new Error(`Missing end: ${endNeedle}`);

  return source.slice(startInner, endHit.idx);
}

function parseBaseline(text) {
  const blocks = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    const mBlock = line.match(/^([a-zA-Z0-9_]+):\s+([0-9a-f]{64})$/);
    if (mBlock) {
      blocks[mBlock[1]] = mBlock[2];
    }
  }

  return { blocks };
}

function assertIncludesExact(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    const previewNeedle = needle.replace(/\s+/g, " ").slice(0, 220);
    throw new Error(`Missing exact snippet for ${label}: ${previewNeedle}...`);
  }
}

async function main() {
  const baselineText = await fs.readFile(BASELINE, "utf8");
  const hookText = await fs.readFile(HOOK, "utf8");

  const { blocks: BASE } = parseBaseline(baselineText);

  const slices = {
    modalBuilder: sliceFromNeedleToNeedleInclusive(
      hookText,
      "const sessionKeyPayload: Record<string, { rtmpUrlBase?: string; streamKey?: string }> = {};",
      "setPlatformState(nextPlatformState);"
    ),

    modalValidation: sliceFromNeedleToNeedleInclusive(
      hookText,
      "if (!hasSelection) {\n        setStartError(\"Add at least one stream destination or custom RTMP key.\");",
      "if (hasErrors) {\n        setStartError(\"Fix the highlighted destinations before starting.\");\n        return;\n      }"
    ),

    modalStartPayloadInner: sliceBetweenInner(
      hookText,
      "computedPayload = {",
      "\n      };"
    ),

    roomNormalize: sliceFromNeedleToNeedleInclusive(
      hookText,
      "const destinationInputs = Array.isArray(keys.destinations) ? keys.destinations : [];",
      "    presetId: selectedPresetId,\n  };"
    ),
  };

  const requiredBlocks = Object.keys(slices);
  for (const k of requiredBlocks) {
    const expected = BASE[k];
    if (!expected) throw new Error(`Missing baseline hash for ${k} in destinations-anchors.out.txt`);
    const got = sha256(dedent(slices[k]));
    if (got !== expected) {
      throw new Error(`Drift: ${k} hash mismatch (expected ${expected} != hook ${got})`);
    }
  }

  const requiredMessages = [
    "Add at least one stream destination or custom RTMP key.",
    "Fix the highlighted destinations before starting.",
    "RTMP URL required.",
    "Stream key required.",
    "RTMP URL must start with rtmp:// or rtmps://.",
    "Add a stream key (or full RTMP URL).",
    "RTMP ingest URL required.",
    "No stream key set.",
  ];

  requiredMessages.forEach((m) => assertIncludesExact(hookText, m, `error message ${m}`));

  // Debug output guards: ensure compute exposes both startError and an errors array.
  assertIncludesExact(hookText, "errors,", "compute returns errors");
  assertIncludesExact(hookText, "startError,", "compute returns startError");

  console.log("✅ useDestinationsStartPayload audit passed");
  console.log(
    "Hashes:",
    requiredBlocks.map((k) => `${k}:${BASE[k].slice(0, 8)}`).join(" ")
  );
}

main().catch((err) => {
  console.error("❌ useDestinationsStartPayload audit failed");
  const msg = err?.message;
  if (msg) {
    console.error(msg);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
