// Regenerates the egress compositor's copy of the program layout presets and
// resolver from lib/programPresets.ts:
//   public/egress-templates/program-layout.mjs   (ES module, same logic)
//   public/egress-templates/program-presets.json (plain data)
//
// Usage (from streamline-server/):  node scripts/gen-program-layout.mjs
// lib/programPresets.test.ts fails when these files are stale.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

export const HEADER =
  "// GENERATED from streamline-server/lib/programPresets.ts by scripts/gen-program-layout.mjs.\n" +
  "// Do not edit by hand.\n";

export function transpilePresets(source) {
  const out = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2020, removeComments: false },
  });
  return HEADER + out.outputText;
}

const src = readFileSync(path.join(root, "lib", "programPresets.ts"), "utf8");
const js = transpilePresets(src);
const outDir = path.join(root, "public", "egress-templates");
const mjsPath = path.join(outDir, "program-layout.mjs");
writeFileSync(mjsPath, js);

const mod = await import(pathToFileURL(mjsPath).href + "?t=" + Date.now());
const data = {
  LANDSCAPE_PRESETS: mod.LANDSCAPE_PRESETS,
  PORTRAIT_PRESETS: mod.PORTRAIT_PRESETS,
  SCREEN_OVERRIDE: mod.SCREEN_OVERRIDE,
  MAX_SLOTS: mod.MAX_SLOTS,
};
writeFileSync(path.join(outDir, "program-presets.json"), JSON.stringify(data, null, 2) + "\n");
console.log("[gen-program-layout] wrote program-layout.mjs and program-presets.json");
