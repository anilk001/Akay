# Akay — project memory for Claude sessions

Akay Irl Ltd (Ireland) buys and resells branded FMCG in bulk. This repo is the
**source of truth for two automations** that share one Airtable base:

1. **offers.akay.ie** — the public trade catalogue (Astro static site, Netlify).
2. **Offer dispatch** — sales offers emailed to clients through the n8n workflow
   `Offer Dispatch — Akay`, with a human approval gate.

The n8n workflows themselves live in n8n Cloud (`akay-team.app.n8n.cloud`). This repo
holds their Code-node sources, tests and runbooks. **A file here changes nothing until
it is pasted into the node AND the workflow is published.**

Read next, in this order, before touching anything:
- `docs/SYSTEMS.md` — every workflow, table, credential and external service, with IDs.
- `docs/INCIDENTS.md` — what has already broken, why, and the recurring patterns.
- `docs/N8N-CHANGE-PROTOCOL.md` — the only allowed way to change a workflow.
- `.claude/skills/offer-dispatch/SKILL.md` — how a send actually works, gate by gate.
- `.claude/skills/offers-catalogue/SKILL.md` — the website pipeline.

## Tech stack and commands

| What | Detail |
|---|---|
| Site | Astro `^4.16`, Node 20, static output to `dist/`, deployed by Netlify from `netlify.toml` |
| Data | Airtable base `appaDSdZkAE9PGkjT` ("Akay Offers"), read at build time via `src/data/airtable.mjs` (public-safe field allowlist) |
| Snapshot | `src/data/offers-snapshot.json` — offline fallback, refreshed by `.github/workflows/refresh.yml` every 5 min on branch `claude/softr-webflow-migration-50kj20` |
| Automation | n8n Cloud workflows; Code nodes mirrored under `.claude/skills/offer-dispatch/n8n/` and `n8n/` |
| Email | Resend, from `Akay Irl Ltd <offers@akay.ie>`; approvals and alerts go to `ak@akay.ie` |

```bash
npm install
npm run dev                      # http://localhost:4321 (snapshot unless AIRTABLE_TOKEN set)
npm run build                    # the site's only verification: expect "[build] Complete!"
AIRTABLE_TOKEN=pat... npm run sync-offers   # refresh the snapshot from live Airtable
node .claude/skills/offer-dispatch/test-nodes.cjs   # 38 tests over the dispatch Code nodes
node n8n/tests/split-quantity.test.js && node n8n/tests/buy-side-guard.test.js   # WhatsApp parser
```

There is no lint or formatter. Plain JS/ESM, 2-space indent, single quotes, no build step for
node code. n8n Code nodes are function *bodies*: a top-level `return` is legal there, so
`node --check` on those files fails by design — wrap in a function to syntax-check.

## Hard rules (each one is a scar; see docs/INCIDENTS.md)

1. **Never edit an n8n workflow while a send is queued or in flight.** Fix the cause
   (credential, credits, data), re-queue. Workflow changes happen on a non-send day.
2. **Never edit a Code node in the n8n UI.** Edit the repo file → run the tests → paste via
   `update_workflow` → `publish_workflow` → read back and assert
   `versionId === activeVersionId`. A draft is invisible to production.
3. **Never build a one-shot send workflow.** Every audience goes through
   `Offer Dispatch — Akay` via the `Queued for Dispatch` flag. Missing targeting → add a
   field to the workflow, from the repo, on a non-send day.
4. **One dispatch run at a time.** Do not trigger a second while one awaits approval.
5. **Public-safe fields only** reach the site or an email: never `Offer Name`, `Notes`,
   `Trader Comment`, `Delivery Info Source`, `Supplier Name`, `Buy Price`, `Margin %`.
   Prices must state their basis (`Price Per Unit & Case`, never bare `Price Display`).
6. **No metered third-party API in a formatting or gating path.** HTML is rendered
   deterministically (`render-html.js`); the Anthropic step was removed 2026-09-02.
7. **Do not say an offer "went out"** until the execution is `success`,
   `Reconcile._summary` reads `Dispatch complete — N/N sent`, and `Offers Sent Log` has N
   rows with `Dispatch Status = Sent`.
8. **Never commit tokens.** `.env` is git-ignored; Airtable PAT is read-only, build-time only.
9. **Do not enable `Supersede Supplier Price Lists`** (`x09qSkS0XdDPoSXr`) without Anil's OK.
10. **Do not tick `Listing Approved` to make a send work** — it is the website gate, human-only.

## Before you start a session that touches dispatch

- Is a run in flight? `search_workflow_executions` on `dAYMAj6mZD3hTV4T` with status
  `running`/`waiting` (ignore the stale 2026-07-31 `waiting` execution 5144).
- Is today's `Backup Registry` row `Verified`? The backup lands ~05:05 UTC; nothing dispatches before it.
- Does the Resend key still work? The last run's `Send via Resend` items carry an `id` if so.
- Read the **published** version (`get_workflow_version(activeVersionId)`), not the draft.

## n8n facts that have cost real sends

- The HTTP Request node **replaces item JSON with the response**; read send metadata from
  the node that built it (`$('Build Sends')`), paired by index.
- The Airtable node returns `{id, createdTime, fields:{...}}` — fields are **nested**.
- n8n fires the error workflow for **production** executions only; manual runs fail silently.
- n8n Cloud Code nodes: no `require('zlib')`; keep per-item payloads small (an HTML body
  per item OOM-crashed a 1,232-recipient run).
- The instance timezone is Asia/Shanghai; pin `Europe/Dublin` in workflow settings.
- Gmail returns **404**, not 403, for a thread in another mailbox: a wrong credential looks
  like a missing thread. Six `gmailOAuth2` credentials exist; the API hides which node uses which.
- Airtable rejects a whole create batch on one unknown field name; deleting a field that a
  workflow writes silently kills every record in that batch.

## Reporting to Anil

Lead with what happened to clients (sent / partially sent / nothing sent), then the cause,
then what was changed and how it was verified. Execution ids and record ids, not adjectives.
