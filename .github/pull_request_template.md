## What changed

<!-- One paragraph. What was observed, what this does about it. -->

## How it was verified

- [ ] `npm run build` finished with `[build] Complete!` (page count: ____)
- [ ] Price/WhatsApp smoke checks from `docs/WORKFLOW.md` run, if the data layer or pages changed (blank clauses: ____)
- [ ] `node n8n/tests/*.test.js` pass, if `n8n/` changed
- [ ] No new hardcoded `/case` or `per case` label next to a price
- [ ] No new field added to `FIELDS` in `src/data/airtable.mjs`, or it is public-safe and listed in `docs/DATA-RULES.md`
- [ ] `offers-snapshot.json` not hand-edited (conflicts resolved by taking the default branch's copy)

## Docs kept in sync

- [ ] `README.md` / `.env.example` / `netlify.toml` / `refresh.yml` still describe the same pipeline
- [ ] `docs/TROUBLESHOOTING.md` has an entry if this fixes a bug that took more than ten minutes to understand
- [ ] `n8n/README.md` publish state updated, if `n8n/` changed (published: yes / no / n/a)
