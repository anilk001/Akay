---
paths:
  - ".github/**"
  - "netlify.toml"
  - "astro.config.mjs"
  - ".env.example"
  - ".mcp.json"
  - ".claude/hooks/**"
---

# Rules for CI, deploy and tooling config

- The pipeline is: refresh Action (has the token) → commits snapshot to the default
  branch → Netlify (no token) builds `dist/`. Four files describe it and must agree:
  `.github/workflows/refresh.yml`, `netlify.toml`, `.env.example`, `README.md`.
  Update all four and `docs/ARCHITECTURE.md` in the same commit.
- The platform is **Netlify**. Not Cloudflare Pages, not Vercel. This has drifted once.
- `refresh.yml` names the default branch twice (`ref:` and `push origin HEAD:`).
  Change both or neither.
- The Action exits 0 with a warning when `AIRTABLE_TOKEN` is missing. Keep that; a
  red run every 5 minutes for a missing secret is noise, a warning is a signal.
- Don't shorten the schedule below 5 minutes (GitHub minimum) or add parallel jobs
  that fetch Airtable; the 5 req/s budget is shared with builds and n8n.
- Node version is pinned to 20 in `netlify.toml` and `refresh.yml`. Bump both together
  and rebuild locally first.
- `.env.example` must contain no real token. `AIRTABLE_TOKEN` is read-only scope only.
- `.mcp.json`: never add an `Authorization` header that expands from an unset variable.
  `Bearer ` with no token disables OAuth. In remote sessions the GitHub MCP host is
  blocked by egress anyway; use `git`.
- `session-start.sh` must stay idempotent, non-interactive and token-free. It runs on
  every remote session start.
- Verify config changes by running `npm run build` locally and, for the Action, by
  triggering it via *Run workflow* and reading the log before merging.
