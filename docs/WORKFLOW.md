# Workflow

## Branches

| Branch | Role |
|---|---|
| `claude/softr-webflow-migration-50kj20` | **The deploy branch.** Remote HEAD. Netlify builds it. The refresh Action commits snapshots to it. Treat it as `main`. |
| `claude/<topic>-<id>` | Feature branches, one per piece of work, merged by PR. |

Do not push feature work straight to the deploy branch. The refresh bot pushes
there every few minutes when offers change, so a long-lived local checkout of
it goes stale fast. Rebase or merge before opening a PR.

## A normal change

```bash
git fetch origin claude/softr-webflow-migration-50kj20
git checkout -b claude/my-change origin/claude/softr-webflow-migration-50kj20
# edit
npm run build                    # must succeed; note the page count
# spot-check dist/ (see "Verifying" below)
git commit                       # why, not what; quote the observed defect
git push -u origin claude/my-change
# open a PR against claude/softr-webflow-migration-50kj20
```

The PR template in `.github/pull_request_template.md` lists what to confirm.

## Verifying a change

The build is the test suite. After `npm run build`:

- **Page count.** Home + offers + categories + guides + about. It was 3983 on
  2026-09-02 (1 + 3966 + 10 + 5 + 1). A big drop means offers went missing.
- **Source.** `grep -o 'data-source="[a-z]*"' dist/index.html`. Locally without
  a token this is `snapshot`, which is fine.
- **Prices on cards.** `grep -c 'EUR ' dist/index.html` style sanity checks, or
  open `dist/index.html` and look at a case-priced and a unit-priced offer.
- **WhatsApp links.** Every `wa.me` href must decode to a full sentence: no `()`
  and no `listed at EUR .` with a missing figure. A one-liner:
  ```bash
  grep -oh 'https://wa.me/[^"]*' -r dist | sort -u | head -20 | \
    while read u; do node -e 'console.log(decodeURIComponent(process.argv[1]))' "$u"; done
  ```
- **Structured data.** Pick one `dist/offers/*/index.html`, extract the
  `application/ld+json` block, and check `price`, `priceCurrency` and
  `eligibleQuantity.unitText` agree with the card.
- **n8n changes.** `node n8n/tests/*.test.js` prints PASS/FAIL per case.

## Testing against live Airtable

```bash
cp .env.example .env    # paste a READ-ONLY PAT (data.records:read, schema.bases:read)
npm run build           # log should say "[airtable] fetched N live public offers"
```

If a data-layer fix changes figures, regenerate the snapshot in the same PR so
production (which builds from the snapshot) picks it up immediately:

```bash
AIRTABLE_TOKEN=pat... npm run sync-offers
git add src/data/offers-snapshot.json
```

Otherwise the fix waits for the next refresh commit, and only then if the
refresh bot's diff happens to touch the same rows.

## Deploying

There is no deploy step. Merging into the deploy branch triggers Netlify.
Netlify builds from the snapshot with no token, in about a minute.

To force a refresh without waiting: GitHub → Actions → "Scheduled catalogue
refresh" → Run workflow. To refresh without a commit at all, create a Netlify
build hook and POST to it (it will rebuild the same snapshot, so it only helps
after a code merge, not after an Airtable edit).

## Environment variables

| Where | Variables |
|---|---|
| Local `.env` | `AIRTABLE_TOKEN` (optional), `AIRTABLE_BASE_ID`, `AIRTABLE_OFFERS_TABLE`, `PUBLIC_GA4_ID` |
| GitHub repo secret | `AIRTABLE_TOKEN` (the refresh Action needs it; without it the Action warns and exits 0) |
| Netlify | Nothing required. Optional `PUBLIC_GA4_ID`. Setting a token there would make Netlify fetch live, which also works. |

The data layer also reads `Airtable_Pat` as a legacy alias for `AIRTABLE_TOKEN`.

## Claude Code sessions

- `.claude/settings.json` runs `.claude/hooks/session-start.sh` on remote
  sessions, which does `npm install`. Local sessions manage their own deps.
- `.mcp.json` declares sequential-thinking, memory, github and airtable MCP
  servers. The airtable one reads `AIRTABLE_API_KEY` from the environment.
- Project skills live in `.claude/skills/`. Use `offers-catalogue` for site work,
  `offer-data-validator` before publishing offer rows, `price-list-intake` to
  convert a supplier price list.
- Path-scoped rules in `.claude/rules/` attach to the data layer, pages, n8n,
  and CI/deploy files.

## n8n changes

The files under `n8n/` are mirrors. The deployment step is manual: paste the
code into the Code node in n8n cloud, **publish** the workflow, then update the
"State" column in `n8n/README.md` with the publish date. An unpublished draft
runs nothing; that mistake once left ~5,000 messages unclassified for a month.
