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

# Install the Claude Code plugins that .claude/settings.json enables. The
# settings only declare them (extraKnownMarketplaces + enabledPlugins); a fresh
# remote container starts with none installed, so without this every session
# needs a manual `claude plugin install`. settings.json stays the single list:
# add or remove a plugin there, not here.
#
# Installed at user scope on purpose: `--scope project` rewrites
# .claude/settings.json (same content, reordered keys) and leaves the tree
# dirty on every start. Enablement already comes from the project file.
#
# Best-effort: a plugin that fails to install (network, a marketplace down)
# is logged and skipped. It must never stop the session from starting.
install_plugins() {
  command -v claude >/dev/null 2>&1 || { echo "[session-start] claude CLI not found; skipping plugins"; return 0; }

  local installed
  installed="$(claude plugin list 2>/dev/null || true)"

  # "name<TAB>repo" for each marketplace, then one "plugin@marketplace" per line.
  node -e '
    const s = require("./.claude/settings.json");
    for (const [name, m] of Object.entries(s.extraKnownMarketplaces || {}))
      if (m.source && m.source.repo) console.log("M\t" + name + "\t" + m.source.repo);
    for (const [id, on] of Object.entries(s.enabledPlugins || {}))
      if (on) console.log("P\t" + id);
  ' | while IFS=$'\t' read -r kind a b; do
    if [ "$kind" = "M" ]; then
      claude plugin marketplace add "$b" >/dev/null 2>&1 \
        || echo "[session-start] marketplace $a ($b) not added"
    elif printf '%s\n' "$installed" | grep -qF "> $a"; then
      echo "[session-start] plugin $a already installed"
    elif claude plugin install "$a" --scope user >/dev/null 2>&1; then
      echo "[session-start] plugin $a installed"
    else
      echo "[session-start] plugin $a FAILED to install (skipped)"
    fi
  done
}
install_plugins || true
