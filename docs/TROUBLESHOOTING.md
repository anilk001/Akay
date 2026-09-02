# Troubleshooting

Symptom → cause → fix. Ordered by how often each has happened.

## The site shows old prices after an Airtable edit

**Cause:** the site is static and shows the snapshot as of the last commit on
the deploy branch. The refresh Action runs every 5 minutes but only commits when
the snapshot changed, and GitHub's scheduler can lag.

**Check:** GitHub → Actions → "Scheduled catalogue refresh". A green run with
"Catalogue unchanged" means Airtable and the snapshot already agree; look at
the Airtable row itself (is `Public Listing` = Yes?). A run with a warning about
`AIRTABLE_TOKEN` means the repository secret is missing or expired.

**Fix:** Run workflow manually, or set the secret. If the token is fine and the
row is public, check whether `normalize()` drops it (test-row prefix, empty
name).

## Build log says `[airtable] … — using snapshot`

**Not an error** when there is no `AIRTABLE_TOKEN` (local, CI, Netlify). The
build falls back on purpose. It is only a problem when you expected a live fetch:
then read the rest of the line. `live fetch failed (Airtable 401…)` is a bad
token. `429` after four retries means the rate budget was exhausted by parallel
builds; wait and retry. `returned 0 rows` means the filter matched nothing.

## A per-unit price is shown under "/ case" (or the reverse)

**Cause:** an amount from one field paired with a basis from another. Rule 2 in
`docs/DATA-RULES.md`.

**Fix:** trace `parsePriceParts()` in `src/data/airtable.mjs` against the
offending `priceDetail` string. Both the amount and the basis must come from
`parts[0]`. Then check `renormalizeSnapshotOffer()` applies the same logic.

## Price sort puts case-priced offers in the wrong place

**Cause:** `unitAmount` fell back to the case figure because no pack size was
found. **Check:** the offer's `priceDetail` lacks `(Npk)`, `spec` does not start
with `N x`, and `PCS/Case` is empty or 1 in Airtable. **Fix:** fill `PCS/Case`
in Airtable. The `offer-data-validator` skill lists these rows.

## A WhatsApp message arrives with `()` or a missing price

**Cause:** an inline `wa.me` link that bypasses `enquiryLink()`.
**Fix:** `grep -rn "wa.me" src/` and route the call site through
`src/lib/whatsapp.mjs`.

## Page count dropped sharply

**Expected count:** 1 home + N offers + categories + 5 guides + 1 about. 3983
on 2026-09-02. **Causes:** the snapshot lost rows (check the last refresh
commit's diff), or `getStaticPaths()` in an offers/category page threw. Read the
build log above the summary line.

## Build fails with a path-too-long error

Slugs are truncated to 90 characters in `slug.mjs` for exactly this reason. If
it recurs, a new name/spec combination is producing a longer slug through
`dedupeSlug()`; lower the limit or shorten the spec contribution.

## Two offers have the same slug

`dedupeSlug()` appends `-2`, `-3`. Both pages exist. The slug is deterministic
by iteration order, so a new offer inserted earlier in the snapshot can swap
which one gets the bare slug. That is a known limitation; an id-based slug
would fix it at the cost of uglier URLs.

## `robots.txt` or `sitemap.xml` changes have no effect

There are two copies. `public/robots.txt` and `public/sitemap.xml` are stale
leftovers. The endpoints `src/pages/robots.txt.ts` and `src/pages/sitemap.xml.ts`
generate the files at build time and overwrite the public copies in `dist/`.
Edit the `.ts` endpoints. Deleting the `public/` copies is safe.

## The category request form says "request is in" but nothing arrives

**Cause:** the form posts to an n8n webhook with `mode: 'no-cors'`, so the
browser cannot read the response and success cannot be confirmed. The copy was
changed to say so and to point at spam folders and offers@akay.ie.
**Check:** the n8n workflow for that webhook is published and its executions
show the POST. The webhook URL is hard-coded in `src/pages/index.astro`.

## GA4 shows no traffic

The ID is hard-coded in `index.astro` (`G-FW42J5609V`) with a `PUBLIC_GA4_ID`
override. Only the home page carries the tag. Ad blockers drop it; check with a
clean profile.

## An n8n change does nothing

The workflow was edited but not **published**. n8n runs the last published
version; a draft is invisible. Open the workflow in n8n cloud and publish. Then
update the State column in `n8n/README.md`.

## `node --check n8n/whatsapp-offer-ingestion/extract-wa-offers.js` fails

Expected. An n8n Code node is a function body, so top-level `return` is legal
there and illegal in a script. Wrap it in a function to syntax-check.

## A byte comparison of `extract-wa-offers.js` against the n8n node differs on two lines

Expected. The repo keeps two regex classes as `\uXXXX` escapes; the node holds
the literal characters. Same regex, identical output. Keep the escapes in the
repo (raw zero-width characters are unreadable and some editors strip them).

## Buy-side enquiries are being filed as supplier offers

The `Classify Message` node decides on price presence alone. The `BUY_SIDE`
guard in `n8n/whatsapp-filter-layer/classify-message.buy-side-guard.js` is
deliberately narrow. Before widening it, add the real message to
`n8n/tests/buy-side-guard.test.js` in both the SELL and BUY lists and confirm
sell-side messages like "Do you need Pilsner Urquell…" still classify as offers.

## Remote Claude Code session has no `node_modules`

`.claude/hooks/session-start.sh` only runs when `CLAUDE_CODE_REMOTE=true`. Run
`npm install` by hand.

## Netlify build fails

Netlify has no token and builds from the snapshot, so a failure there is a code
or dependency failure, not an Airtable one. Reproduce with `npm run build`
locally without a `.env`. Node is pinned to 20 in `netlify.toml`; local is 22.
Both work today, but a Node-22-only API would break Netlify.
