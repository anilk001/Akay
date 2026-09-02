# CLAUDE.md — project memory for the AKAY offers catalogue

Read this first. It is the short version; the long version lives in `docs/`.
Path-scoped rules in `.claude/rules/` load automatically when you touch the
matching files.

## What this repo is

`offers.akay.ie` — the public B2B trade catalogue of **Akay Irl Ltd** (Shannon,
Ireland). Akay buys branded FMCG, spirits, beer and soft drinks in bulk and
resells in bulk. The site is a **static Astro 4 build**: at build time it reads
the `Offers` table of the `Akay Offers` Airtable base, bakes every offer into
plain HTML, and Netlify serves the result. There is no server at runtime.

Also in the repo, but **not** part of the site: `n8n/` holds mirrors of the
JavaScript inside n8n Code nodes that ingest WhatsApp supplier offers into
Airtable. Editing those files changes nothing until the code is pasted into the
node and the workflow is published in n8n cloud.

## The rules that matter most

1. **Only public-safe fields leave Airtable.** `FIELDS` in `src/data/airtable.mjs`
   is an explicit allowlist. Supplier identity, buy prices, margins and internal
   notes are never requested, so they can never reach the browser. Adding a field
   to a card means adding it there first, and only if it is genuinely public.
2. **Price amount and price basis come from the same string.** Never pair an
   amount from one Airtable field with a "/ case" or "/ unit" label from another.
   This bug shipped once (49 of 173 offers wrong). See `docs/DATA-RULES.md`.
3. **Every WhatsApp link goes through `src/lib/whatsapp.mjs`.** No inline
   `wa.me` strings. The builder omits missing clauses instead of printing blanks.
4. **The build must never fail without a token.** No `AIRTABLE_TOKEN` means the
   committed `src/data/offers-snapshot.json` is used. A log line
   `[airtable] … — using snapshot` is expected offline, not an error.
5. **The deploy branch is `claude/softr-webflow-migration-50kj20`.** It is the
   remote HEAD, what Netlify builds, and what the refresh Action commits to. It is
   not called `main`. Feature work goes on its own branch and is merged by PR.
6. **Never commit `.env` or a token.** `.env*` is git-ignored except `.env.example`.

## Commands

```bash
npm install                       # deps (the SessionStart hook does this remotely)
npm run dev                       # http://localhost:4321, snapshot unless token set
npm run build                     # static build into dist/ — currently 3983 pages
AIRTABLE_TOKEN=pat... npm run sync-offers   # refresh the snapshot from live Airtable
node n8n/tests/split-quantity.test.js       # n8n parser checks (plain node, no framework)
node n8n/tests/buy-side-guard.test.js
```

There is no linter, formatter, or test runner for the site. The build is the
check: run it, confirm the page count, and spot-check `dist/`.

## Where things live

| Path | Role |
|---|---|
| `src/data/airtable.mjs` | Live fetch, retry, `normalize()`, snapshot fallback. The data layer. |
| `src/data/offers-snapshot.json` | Committed catalogue. Rewritten every 5 minutes by the refresh Action. |
| `src/data/guides.mjs` | Static content for the five `/guides/` pages. |
| `src/lib/whatsapp.mjs` | WhatsApp number and enquiry-link builder. Single source of truth. |
| `src/lib/slug.mjs` | Offer URL slugs and collision handling. |
| `src/lib/schema.mjs` | JSON-LD builders (Organization, Product/Offer, Breadcrumb, ItemList, Article). |
| `src/lib/fetch-offers.mjs` | The `sync-offers` script. |
| `src/pages/index.astro` | Home catalogue: cards, client-side search/filter/sort, category request form, GA4. |
| `src/pages/offers/[slug].astro` | One page per offer (3966 today). |
| `src/pages/category/[category].astro` | One page per category (10 today). |
| `src/pages/guides/[slug].astro`, `about.astro` | Content pages. |
| `src/pages/{robots.txt,sitemap.xml,llms.txt}.ts` | Generated SEO endpoints. These win over the stale copies in `public/`. |
| `n8n/` | Mirrors of n8n Code nodes plus their tests. See `n8n/README.md`. |
| `.github/workflows/refresh.yml` | Every-5-minutes Airtable → snapshot → commit → Netlify redeploy. |
| `.claude/skills/` | Project skills: `offers-catalogue`, `offer-data-validator`, `price-list-intake`, `structured-reasoning`. |

## Docs index

- `docs/ARCHITECTURE.md` — how data flows from Airtable to the browser, and why it is static.
- `docs/WORKFLOW.md` — branches, the refresh loop, deploying, verifying a change.
- `docs/DATA-RULES.md` — the invariants on offer data and the bugs they prevent.
- `docs/TROUBLESHOOTING.md` — symptoms, causes, fixes.
- `docs/DECISIONS.md` — decision log with dates and reasons.

## Working style for this repo

- Commit messages explain the *why* and quote the observed defect where there
  was one. Read `git log` on `src/data/airtable.mjs` for the house style.
- When a fix changes offer figures, state the before/after count against the
  snapshot in the commit body (for example "price/basis mismatches 49 -> 0").
- Prefer refusing to guess over guessing on money: a price the parser cannot
  settle goes to review, not into a quote.
- Keep the offline snapshot and live paths producing identical output. Any
  correction applied in `normalize()` must also be applied in
  `renormalizeSnapshotOffer()` until the snapshot is regenerated.
