import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Violation = {
  filePath: string;
  lineNumber: number;
  snippet: string;
  endpoint: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const scanRoot = path.join(repoRoot, "streamline-client", "src");
const skipFiles = new Set([
  path.join(scanRoot, "lib", "api.ts"),
]);

const allowedApiPrefixes: RegExp[] = [
  /^\/api\/public\//,
  /^\/api\/saved-embeds\/public\//,
  /^\/api\/invites\/resolve\b/,
  /^\/api\/invites\/legacy\/resolve\b/,
  /^\/api\/invites\/track-landing\b/,
  /^\/api\/rooms\/resolve\b/,
  /^\/api\/stats\/public\b/,
  /^\/api\/telemetry\//,
  /^\/api\/auth\/(login|signup)\b/,
];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function extractApiEndpoint(raw: string): string | null {
  const idx = raw.indexOf("/api/");
  if (idx === -1) return null;
  return raw.slice(idx);
}

function isAllowed(endpoint: string): boolean {
  return allowedApiPrefixes.some((re) => re.test(endpoint));
}

function findViolationsInLine(line: string): Array<{ endpoint: string; snippet: string }> {
  const matches: Array<{ endpoint: string; snippet: string }> = [];

  const patterns: RegExp[] = [
    /fetch\(\s*"([^"]*\/api\/[^\"]*)"/g,
    /fetch\(\s*'([^']*\/api\/[^']*)'/g,
    /fetch\(\s*`([^`]*\/api\/[^`]*)`/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const raw = m[1] || "";
      const endpoint = extractApiEndpoint(raw);
      if (!endpoint) continue;
      matches.push({ endpoint, snippet: m[0] });
    }
  }

  return matches;
}

function main() {
  if (!fs.existsSync(scanRoot)) {
    console.log(`[check-no-raw-api-fetch] Skip: missing ${scanRoot}`);
    return;
  }

  const files = listSourceFiles(scanRoot).filter((p) => !skipFiles.has(p));
  const violations: Violation[] = [];

  for (const filePath of files) {
    const contents = fs.readFileSync(filePath, "utf8");
    const lines = contents.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("fetch(")) continue;

      for (const hit of findViolationsInLine(line)) {
        if (isAllowed(hit.endpoint)) continue;
        violations.push({
          filePath,
          lineNumber: i + 1,
          snippet: hit.snippet.trim(),
          endpoint: hit.endpoint,
        });
      }
    }
  }

  if (violations.length) {
    console.error(`\n[check-no-raw-api-fetch] Found ${violations.length} raw /api fetch() call(s) outside the allowlist.`);
    console.error(`[check-no-raw-api-fetch] Use apiFetch()/apiFetchAuth() from streamline-client/src/lib/api.ts instead.\n`);

    for (const v of violations) {
      const rel = path.relative(repoRoot, v.filePath).replace(/\\/g, "/");
      console.error(`- ${rel}:${v.lineNumber}  ${v.endpoint}`);
      console.error(`  ${v.snippet}`);
    }

    process.exit(1);
  }

  console.log(`[check-no-raw-api-fetch] OK (no disallowed raw /api fetch() calls found)`);
}

main();
