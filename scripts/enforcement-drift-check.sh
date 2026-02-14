#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
TARGET="$ROOT/streamline-server"

echo "Running enforcement drift checks in $TARGET"

RG=(rg -n --hidden \
  --glob '!**/node_modules/**' \
  --glob '!**/dist/**' \
  --glob '!**/lib/limitErrors.ts' \
  --glob '!**/lib/permissionErrors.ts')

# 1) Plan/limit codes must not appear as raw string literals
"${RG[@]}" \
  '["'"''](limit_exceeded|usage_exhausted|feature_not_entitled)["'"'']' \
  "$TARGET" && { echo "❌ Found raw LIMIT error string literal. Use LIMIT_ERRORS.*"; exit 1; } || true

# 2) Permission codes must not appear as raw string literals
"${RG[@]}" \
  '["'"''](insufficient_role|room_token_required|room_mismatch|forbidden)["'"'']' \
  "$TARGET" && { echo "❌ Found raw PERMISSION error string literal. Use PERMISSION_ERRORS.*"; exit 1; } || true

# 3) Gate results must not use reason as an error code string literal
"${RG[@]}" \
  'reason:\s*["'"''](limit_exceeded|usage_exhausted|feature_not_entitled|insufficient_role|room_token_required|room_mismatch|forbidden)["'"'']' \
  "$TARGET" && { echo "❌ Found reason: with error-code string literal. Use LIMIT_ERRORS.* / PERMISSION_ERRORS.*"; exit 1; } || true

# 4) Disallow generic forbidden throws in routes
"${RG[@]}" \
  'throw new Error\(\s*["'"'']forbidden["'"'']\s*\)' \
  "$TARGET" && { echo "❌ Found throw new Error('forbidden'). Use typed error + PERMISSION_ERRORS"; exit 1; } || true

echo "✅ Enforcement drift check passed"
