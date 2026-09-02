## What and why

<!-- One paragraph. Quote the observed defect if this fixes one, e.g.
     "49 of 173 offers printed a per-unit figure under '/ case'". -->

## Checklist

**Build**
- [ ] `npm run build` succeeds locally without a token
- [ ] Page count is `____` (was 3983 on 2026-09-02); any change is explained above
- [ ] If offer figures changed, before/after counts against the snapshot are in the description

**Data rules** (skip if `src/data` and `src/lib` are untouched)
- [ ] No new field in `FIELDS` unless it is public-safe, with the reason stated
- [ ] Price amount and basis still come from the same price part
- [ ] Any correction in `normalize()` is mirrored in `renormalizeSnapshotOffer()`
- [ ] Snapshot regenerated with `npm run sync-offers` if the fix must reach production now

**Pages** (skip if `src/pages` is untouched)
- [ ] All WhatsApp links go through `src/lib/whatsapp.mjs`; no inline `wa.me`
- [ ] Spot-checked one case-priced and one unit-priced offer in `dist/`
- [ ] JSON-LD still generated via `src/lib/schema.mjs`
- [ ] `llms.txt` updated if a category or guide was added

**n8n** (skip if `n8n/` is untouched)
- [ ] `node n8n/tests/*.test.js` all PASS, with the new real-message case added
- [ ] Code pasted into the node and workflow **published**, or the description says it is not yet
- [ ] State column in `n8n/README.md` updated

**Deploy and secrets**
- [ ] No token, key, or `.env` content in the diff
- [ ] `refresh.yml` still targets `claude/softr-webflow-migration-50kj20` if touched
- [ ] `docs/DECISIONS.md` has an entry if this changes an approach someone could be surprised by
