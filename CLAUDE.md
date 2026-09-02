# CLAUDE.md — project memory for the AKAY offers catalogue

Read this first in every session. It is the short version; the detail lives in
`docs/` and in the path-scoped rules under `.claude/rules/` (loaded automatically
when you touch matching files). Keep this file under ~150 lines — move detail out,
don't pile it in.

## What this repo is

`offers.akay.ie` — the public B2B trade catalogue of **Akay Irl Ltd** (Shannon,
Ireland). Akay buys branded FMCG, spirits and beer in bulk and resells in bulk.
The site is a **static Astro build** that reads offers from **Airtable at build
time** and is served by **Netlify**. There is no server, no database, no API of
our own. The WhatsApp buttons are plain `wa.me` deep links.

Two systems are mirrored here but do NOT run from here:
- `n8n/` — source of the JavaScript inside n8n Code nodes (WhatsApp ingestion).
  Editing a file here changes nothing until pasted into n8n and **published**.
- `.claude/skills/` — offer validation and price-list intake scripts (Python).

## Tech stack

| Thing | Value |
|---|---|
| Framework | Astro `^4.16` (`output: 'static'`), the only npm dependency |
| Runtime | Node 20 on Netlify and in CI (`netlify.toml`, `refresh.yml`); Node 22 works locally |
| Language | Plain ESM JavaScript in `.mjs`; `.astro` pages; `.ts` only for the three endpoint routes |
| Data | Airtable base `appaDSdZkAE9PGkjT`, table `Offers`, filter `{Public Listing}='Yes'` |
| Hosting | Netlify, deploys on every push to the default branch |
| Lint / tests | None for the site. `n8n/tests/*.test.js` run with plain `node` |

## Commands

```bash
npm install                     # already done by the SessionStart hook in remote sessions
npm run build                   # THE verification step. ~15s, ~4,000 pages, works offline
npm run dev                     # http://localhost:4321 (not useful in a headless remote session)
npm run preview                 # serve dist/ locally
AIRTABLE_TOKEN=pat... npm run sync-offers   # refresh src/data/offers-snapshot.json from live
node n8n/tests/split-quantity.test.js       # n8n parsing tests
node n8n/tests/buy-side-guard.test.js       # n8n classifier tests
```

A build log line `[airtable] no AIRTABLE_TOKEN set — using snapshot` is **expected**
in the sandbox, not an error. `[build] Complete!` is the pass signal.

## Hard rules (each one exists because it was broken once)

1. **Only public-safe fields leave Airtable.** The `FIELDS` allowlist in
   `src/data/airtable.mjs` is the only thing fetched. Never add supplier names,
   buy prices, margins or internal notes. See `docs/DATA-RULES.md`.
2. **A price and its basis come from the same string.** Never print an amount
   under a hardcoded "/case" or "per case" label. Use `offer.priceBasis` and the
   `priceParts()` helper. This bug has been fixed three times; do not add a fourth.
3. **Every Airtable field is optional.** Guard before interpolating. Omit the clause,
   never render `()` or `EUR ` with no figure. WhatsApp links go through
   `enquiryLink()` in `src/lib/whatsapp.mjs` — never hand-build a `wa.me` URL.
4. **Never hand-edit `src/data/offers-snapshot.json`.** A bot regenerates it every
   5 minutes on the default branch. On merge conflict, take the default branch's
   copy. See `docs/WORKFLOW.md`.
5. **Never commit a token.** `.env` is git-ignored; `.env.example` has empty values.
6. **n8n changes are not live until published in n8n.** Say so in the commit
   message. Record the published version id in `n8n/README.md` once it is live.
7. **Docs must match the deploy.** The platform is Netlify. If you change
   `netlify.toml`, `refresh.yml`, env vars or the branch model, update `README.md`,
   `.env.example` and `docs/` in the same commit.
8. **Don't add dependencies, frameworks or a test runner** without a stated reason.
   The single-dependency build is deliberate (`docs/DECISIONS.md`).

## Coding standards

- 2-space indent, single quotes, semicolons, ESM imports with file extensions.
- Comments explain **why** and cite the observed failure when the code guards against
  one (see `whatsapp.mjs` for the house style). No comments that restate the code.
- Shared logic lives in `src/lib/`. If two pages need the same helper, move it there
  before adding a second copy. Known debt: `priceParts()` is duplicated in two pages,
  and the slug-map loop is duplicated in four files while `buildSlugMap()` in
  `src/lib/slug.mjs` sits unused. Use the lib version when you touch those files.
- Numbers: `amount` may be `null`. Never call `.toFixed()` without a null check.
  Currency codes are uppercase ISO (`EUR`, `GBP`, `USD`). Stock is whole cases.
- Airtable field names are exact, case-sensitive strings (`'Price Per Unit & Case'`,
  `'PCS/Case'`). Copy them from `FIELDS`, do not retype them.
- Astro: `is:inline` scripts only for third-party tags (GA4). Build-time values
  reach the browser only via `PUBLIC_*` env vars or `define:vars`.

## Before you push (the checklist)

1. `npm run build` exits 0 and prints `[build] Complete!`.
2. If you touched the data layer, pages or `whatsapp.mjs`, run the smoke checks in
   `docs/WORKFLOW.md` (no `()` in WhatsApp links, no `/case` next to a per-unit price).
3. If you touched `n8n/`, run both node tests.
4. If you touched `.claude/skills/*.py`, run the script once against a sample.
5. Commit message: `type(scope): what` + a body saying what was observed, what
   changed, and how it was verified. Types seen here: `fix`, `feat`, `chore`, `docs`.
6. Push to your `claude/<topic>-<id>` branch. The default branch is
   `claude/softr-webflow-migration-50kj20` (it *is* production; see WORKFLOW).

## Where to look

| Question | File |
|---|---|
| How does data flow Airtable → HTML → Netlify? | `docs/ARCHITECTURE.md` |
| Branches, commits, PRs, the refresh bot, conflicts | `docs/WORKFLOW.md` |
| "I've seen this error before" | `docs/TROUBLESHOOTING.md` |
| Offer field semantics, price basis, pack rules | `docs/DATA-RULES.md` |
| Why is it built this way? | `docs/DECISIONS.md` |
| n8n node code, publish state, tests | `n8n/README.md` |
| Catalogue editing walkthrough | `.claude/skills/offers-catalogue/SKILL.md` |

## Environment notes for remote sessions

- The SessionStart hook runs `npm install`. No token is present; builds use the snapshot.
- The GitHub MCP server host (`api.githubcopilot.com`) is blocked by the egress
  policy. `git push` to `origin` works. Do not add an `Authorization` header to the
  github entry in `.mcp.json` — an empty `Bearer ` header disables OAuth entirely.
- Airtable is reachable from GitHub Actions runners but not from this sandbox
  without a token, so `npm run sync-offers` will refuse to run here. That is correct.
