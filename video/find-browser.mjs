// Locate a Chromium that is already on this machine.
//
// Remotion downloads its own Chrome Headless Shell on first use, which needs
// egress to remotion.media — not available in every CI or agent sandbox. When a
// browser is already present (an explicit REMOTION_BROWSER_EXECUTABLE, or the
// Playwright headless shell shipped in the Claude Code container) reuse it.
// Returns null when there is none, which lets Remotion fall back to its download.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function findBrowser() {
  if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(base)) return null;
  const dir = readdirSync(base).find((d) => d.startsWith('chromium_headless_shell'));
  if (!dir) return null;
  const bin = path.join(base, dir, 'chrome-linux', 'headless_shell');
  return existsSync(bin) ? bin : null;
}
