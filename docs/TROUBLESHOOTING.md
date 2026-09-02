# Troubleshooting — errors we have already paid for

Each entry: symptom → cause → fix → how we stop it recurring. Add to this file
whenever a bug takes more than ten minutes to understand; the goal is that no
error is diagnosed twice. Newest at the top of each section.

## Build and data

### `[airtable] no AIRTABLE_TOKEN set — using snapshot`
- **Cause**: no token in the environment (always true in the remote sandbox).
- **Fix**: none needed. The build is designed to succeed from the snapshot.
- **Prevention**: don't "fix" this by adding a token to any committed file.

### `[airtable] live fetch failed (Airtable 429 ...) — using snapshot`
- **Cause**: Airtable allows 5 req/s per base. The build, the 5-minute bot and n8n
  share that budget. Each build calls `getOffers()` four times (once per route).
- **Fix**: `fetchWithRetry()` retries 429/5xx with backoff and honours `Retry-After`.
  If it still exhausts, the build quietly serves the snapshot: stale, not broken.
- **Prevention**: don't add more independent `getOffers()` callers. Memoising
  `getOffers()` at module level is the real fix (see ARCHITECTURE known debt #1).
- **Watch out**: a 401/403/422 is a config fault and is deliberately **not** retried.

### Site shows stale prices but no build failed
- **Cause**: the fallback above is quiet by design. A failed live fetch logs a
  warning and publishes the snapshot.
- **Fix**: check the latest refresh Action run and the Netlify build log for the
  `[airtable]` line. Check `generated` in the snapshot.
- **Prevention**: when adding a failure path, make the log line greppable
  (`[airtable] ...`) and never swallow the error silently.

### A per-unit price is shown or labelled as a per-case price (or vice versa)
- **History**: fixed in `d5490fd` (sort figure), `4285564` (JSON-LD `unitText`), and
  the `Price Display` vs `Price Per Unit & Case` headline mix-up before that. Still
  present in the `pageTitle`/`pageDesc` of `offers/[slug].astro`.
- **Cause**: `amount` and its basis were read from different strings, or the basis
  was hardcoded as "case".
- **Fix**: derive both from the same price part. `normalize()` exports `priceBasis`
  for exactly this. `eligibleUnitText()` in `schema.mjs` shows the correct mapping.
- **Prevention**: `.claude/rules/pages.md` forbids literal `/case` labels. Grep for
  `/case` and `per case` in `src/pages` before pushing.

### WhatsApp message contains `()` or ends `listed at EUR .`
- **History**: `4eb804d`. 24 offers have no spec; at least one has no price.
- **Cause**: optional fields interpolated without a guard.
- **Fix**: `enquiryLink()` in `whatsapp.mjs` omits each clause when its field is
  missing. All nine call sites go through it.
- **Prevention**: never build a `wa.me` URL inline. The smoke check in WORKFLOW.md
  decodes every link in `dist/` and counts blank clauses.

### Card prints the variant list twice
- **History**: `66b7d7c`.
- **Cause**: `name` still contained the variant tail after `splitVariants()` ran on
  a row that also had a `Variant` field.
- **Fix**: when `Variant` is set it wins and the name is left intact; otherwise the
  tail is split only if it has two or more commas and the head is ≥ 8 chars.
- **Prevention**: `DATA-RULES.md` documents the split rule; don't loosen it.

### Fractional stock ("12,412.3 cases")
- **Cause**: units entered in the `Stock Cases` field instead of cases.
- **Fix**: `normalize()` rounds. The real fix is upstream: run the
  `offer-data-validator` skill on the import file (check 2, whole cases).

### Fake rows in the catalogue (`TESTBRAND ...`)
- **Cause**: test records with `Public Listing = Yes`.
- **Fix**: `isTestRow()` drops names starting `testbrand`/`testproduct`. Better: fix
  the record in Airtable.

### Build output has fewer pages than expected
- Check: the snapshot has ~3,966 offers → ~3,983 pages (offers + categories + guides +
  about + index + 3 endpoints). A big drop means the live fetch returned a partial
  page set or the filter changed. `getOffers()` refuses to return a live result of
  0 rows (falls back), but it will happily return 200 rows if pagination stopped early.

### Editing `public/robots.txt` or `public/sitemap.xml` has no effect
- **Cause**: `src/pages/robots.txt.ts` and `sitemap.xml.ts` generate those paths and
  win over `public/`. Verified: `dist/robots.txt` contains the AI-crawler block from
  the route, not the two-line file from `public/`.
- **Fix**: edit the `.ts` route. Delete the `public/` copies when convenient.

## Git and CI

### Merge conflict in `src/data/offers-snapshot.json`
- **Cause**: the refresh bot committed since you branched. Happens to every PR.
- **Fix**: take the default branch's version. Exact commands in `WORKFLOW.md`.
- **Prevention**: none possible short of moving the snapshot out of git; accepted.

### Refresh Action does nothing / warns `AIRTABLE_TOKEN secret is not set`
- **Cause**: the repository secret is missing or was rotated.
- **Fix**: Settings → Secrets and variables → Actions → `AIRTABLE_TOKEN`, a read-only
  PAT with `data.records:read` + `schema.bases:read`. The Action exits 0 on purpose so
  a missing secret shows as a warning, not a red run.

### Netlify built but the site didn't change
- **Cause**: Netlify has no token; it renders the committed snapshot. If the bot
  didn't commit (no diff, or its run was cancelled by `concurrency`), nothing changes.
- **Fix**: run the refresh workflow by hand (Actions → Run workflow) and check its log.

### `git log` is unreadable
- `git log --grep='refresh catalogue snapshot' --invert-grep --oneline` hides the bot.

## Tooling and environment

### GitHub MCP server fails to connect in a remote session
- **History**: `7996572`.
- **Cause 1**: an `Authorization: Bearer ${GITHUB_MCP_PAT}` header with the variable
  unset expands to `Bearer ` and disables the OAuth fallback. Removed.
- **Cause 2**: the sandbox egress policy denies CONNECT to `api.githubcopilot.com`.
  `github.com` and `api.github.com` are allowed, so `git` works.
- **Fix**: use `git`. Don't re-add the header.

### `node --check n8n/whatsapp-offer-ingestion/extract-wa-offers.js` → "Illegal return statement"
- **Cause**: n8n Code nodes are function bodies; top-level `return` is legal there.
- **Fix**: expected. Wrap in a function to syntax-check, or run the tests instead.

### Byte comparison of `extract-wa-offers.js` against the n8n node shows two differing lines
- **Cause**: the repo writes zero-width and emoji character classes as `\uXXXX`
  escapes; n8n stores the literal characters. Same regex.
- **Fix**: expected. Keep the escapes in the repo; editors strip raw zero-width chars.

### `npm run sync-offers` → "Refusing to overwrite snapshot"
- **Cause**: no token or no network. The script only writes on a successful live fetch.
- **Fix**: expected in the sandbox. Run it from a machine with the token, or let the bot do it.

### n8n classifier / parser fixed in the repo but production behaviour unchanged
- **Cause**: node not updated in n8n, or updated but not **published**.
- **Fix**: follow the publish checklist in `WORKFLOW.md`. Check `activeVersionId`.

## Content and docs

### Docs describe a platform we don't use
- **History**: `fce0d34` (`.env.example` said Cloudflare Pages).
- **Prevention**: `netlify.toml`, `refresh.yml`, `.env.example`, `README.md` and
  `docs/` describe one pipeline. Change them together.

### Form copy claims something we can't verify
- **History**: `fce0d34`. The category-request form posts with `mode: 'no-cors'`, so
  the response is opaque and success cannot be confirmed.
- **Rule**: UI copy may say "request sent", never "you'll receive an email" unless
  the code can actually observe that outcome.
