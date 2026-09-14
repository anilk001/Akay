#!/bin/bash
# Launcher for the Playwright MCP server (wired up in .mcp.json).
#
# Claude Code on the web ships a pre-installed Chromium under
# $PLAYWRIGHT_BROWSERS_PATH and no branded Google Chrome. Out of the box
# @playwright/mcp fails there twice over: it defaults to the "chrome" channel
# (expects /opt/google/chrome/chrome), and --browser chromium asks for the exact
# Chromium build its own bundled Playwright pins, which is not the build the
# image carries. Point it at the browser that is actually present instead.
#
# Locally there is no such directory, so the server keeps its normal defaults
# (headed Google Chrome) and this wrapper is a no-op.
set -euo pipefail

chromium="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium"

if [ -x "$chromium" ]; then
  # Headless: the container has no display. No sandbox: it runs as root
  # without the user namespaces Chromium's sandbox needs.
  exec npx -y @playwright/mcp@latest \
    --headless \
    --no-sandbox \
    --executable-path "$chromium" \
    "$@"
fi

exec npx -y @playwright/mcp@latest "$@"
