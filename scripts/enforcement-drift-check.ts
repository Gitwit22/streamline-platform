import fs from 'node:fs/promises'
import path from 'node:path'

import {LIMIT_ERRORS} from '../streamline-server/lib/limitErrors'
import {PERMISSION_ERRORS} from '../streamline-server/lib/permissionErrors'

type Hit = {
  file: string
  line: number
  col: number
  match: string
  context: string
}

const ROOT = process.cwd()
const TARGET = path.join(ROOT, 'streamline-server')

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git'])
const EXCLUDED_FILES = new Set([
  path.join(TARGET, 'lib', 'limitErrors.ts'),
  path.join(TARGET, 'lib', 'permissionErrors.ts'),
])

function escapeRegExp(lit: string): string {
  return lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isScannableFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.cjs' || ext === '.mjs'
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, {withFileTypes: true})
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (EXCLUDED_DIRS.has(ent.name)) continue
      yield* walk(full)
    } else if (ent.isFile()) {
      yield full
    }
  }
}

function computeLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1) // '\n'
  }
  return starts
}

function findLineCol(lineStarts: number[], idx: number): {line: number; col: number} {
  // binary search for greatest start <= idx
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const s = lineStarts[mid]
    if (s <= idx) lo = mid + 1
    else hi = mid - 1
  }
  const lineIndex = Math.max(0, hi)
  const lineStart = lineStarts[lineIndex]
  return {line: lineIndex + 1, col: idx - lineStart + 1}
}

function getLine(text: string, lineStarts: number[], line: number): string {
  const idx = Math.max(1, Math.min(line, lineStarts.length)) - 1
  const start = lineStarts[idx]
  const end = idx + 1 < lineStarts.length ? lineStarts[idx + 1] - 1 : text.length
  return text.slice(start, end).trimEnd()
}

async function scanFile(filePath: string, patterns: Array<{label: string; re: RegExp}>): Promise<Hit[]> {
  if (EXCLUDED_FILES.has(filePath)) return []
  if (!isScannableFile(filePath)) return []

  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch {
    return []
  }

  const rel = path.relative(ROOT, filePath).split(path.sep).join('/')
  const lineStarts = computeLineStarts(text)

  const hits: Hit[] = []
  for (const {re} of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const idx = m.index
      const {line, col} = findLineCol(lineStarts, idx)
      hits.push({
        file: rel,
        line,
        col,
        match: m[0],
        context: getLine(text, lineStarts, line),
      })
    }
  }
  return hits
}

async function main() {
  console.log(`Running enforcement drift checks in ${path.relative(ROOT, TARGET)}`)

  const limitCodes = new Set(Object.values(LIMIT_ERRORS))
  const permissionCodes = new Set(Object.values(PERMISSION_ERRORS))

  // Legacy/banned historical codes we still want to prevent re-introducing.
  // These may not exist in PERMISSION_ERRORS anymore but still must not appear as raw literals.
  const legacyPermissionCodes = new Set(['insufficient_role', 'forbidden'])

  const allBannedStringCodes = new Set<string>([
    ...limitCodes,
    ...permissionCodes,
    ...legacyPermissionCodes,
  ])

  const bannedAlternation = [...allBannedStringCodes]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join('|')

  // 1) Raw error-code string literals anywhere in code (except canonical definition files)
  const rawStringLiteralRE = new RegExp(String.raw`(["'])(?:${bannedAlternation})\1`, 'g')

  // 2) Specifically disallow throw new Error('forbidden') (legacy)
  const throwForbiddenRE = new RegExp(String.raw`throw\s+new\s+Error\(\s*(["'])forbidden\1\s*\)`, 'g')

  // 3) Specifically disallow reason: '<error-code>' (only when value is a banned code)
  const reasonLiteralRE = new RegExp(String.raw`reason\s*:\s*(["'])(?:${bannedAlternation})\1`, 'g')

  const patterns = [
    {label: 'rawStringLiteral', re: rawStringLiteralRE},
    {label: 'throwForbidden', re: throwForbiddenRE},
    {label: 'reasonLiteral', re: reasonLiteralRE},
  ]

  const allHits: Hit[] = []
  for await (const filePath of walk(TARGET)) {
    const hits = await scanFile(filePath, patterns)
    allHits.push(...hits)
  }

  if (allHits.length > 0) {
    console.error(`❌ Enforcement drift check failed: found ${allHits.length} banned literal(s).`) 
    for (const h of allHits) {
      console.error(`${h.file}:${h.line}:${h.col}: ${h.match}`)
      console.error(`  ${h.context}`)
    }
    process.exitCode = 1
    return
  }

  console.log('✅ Enforcement drift check passed')
}

main().catch((err) => {
  console.error('❌ Enforcement drift check crashed')
  console.error(err)
  process.exitCode = 1
})
