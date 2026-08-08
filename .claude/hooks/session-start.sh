#!/bin/bash
# SessionStart hook for the AKAY offers catalogue (Astro static site).
#
# Installs npm dependencies so that `npm run build`, `npm run dev` and
# `npm run sync-offers` work immediately in a Claude Code on the web session.
# Idempotent and non-interactive: safe to run on every session start.
set -euo pipefail

# Only do work in the remote (Claude Code on the web) environment; locally the
# developer manages their own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Install dependencies. `npm install` (not `npm ci`) is deliberate: it reuses
# any cached node_modules the container already has, which is faster on warm
# starts. The build works with no AIRTABLE_TOKEN — src/data/airtable.mjs falls
# back to the committed offers-snapshot.json — so no secrets are needed here.
echo "[session-start] Installing npm dependencies..."
npm install --no-audit --no-fund

echo "[session-start] Dependencies ready. Build with: npm run build"
