---
paths:
  - ".github/**"
  - "netlify.toml"
  - "astro.config.mjs"
  - ".claude/hooks/**"
  - ".claude/settings.json"
  - ".mcp.json"
  - ".env.example"
---

# CI, deploy and tooling rules

- The deploy branch is `claude/softr-webflow-migration-50kj20`. It appears in
  `refresh.yml` twice (checkout ref and push target). If it is ever renamed,
  change both, update Netlify's production branch, and add a decision-log entry.
- `refresh.yml` must keep: `concurrency` with cancel-in-progress, the
  `AIRTABLE_TOKEN` missing → warn and exit 0 path, and commit-only-when-changed.
  It must never commit anything except `src/data/offers-snapshot.json`.
- The refresh cadence is 5 minutes, GitHub's minimum. Do not add a second
  schedule that competes for Airtable's 5 requests/second budget.
- Netlify builds from the snapshot with no token. Do not add a build step that
  requires network access to Airtable.
- `netlify.toml` pins Node 20. Local is 22. Do not use APIs newer than Node 20.
- `astro.config.mjs` stays `output: 'static'`. A server output would need a
  token at runtime and a host to run it; that is a decision-log change.
- Secrets never go in files. `.env.example` has empty values only. The Airtable
  base id is not a secret and may stay.
- `session-start.sh` must remain idempotent and non-interactive, and must only
  do work when `CLAUDE_CODE_REMOTE=true`.
- `.mcp.json` reads credentials from the environment (`${AIRTABLE_API_KEY}`).
  Never inline a key or a Bearer header value.
