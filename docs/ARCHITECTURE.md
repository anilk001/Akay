# Architecture

## One sentence

Airtable is the database, GitHub is the cache, Netlify is the CDN, and the
browser gets plain HTML.

## The pipeline

```
Airtable "Akay Offers" base, table "Offers"
   │  filterByFormula {Public Listing}='Yes', explicit fields[] allowlist
   ▼
src/data/airtable.mjs  getOffers()          ← build time only, read-only PAT
   │  normalize(): parse price parts, derive unitAmount, split variants,
   │  round case counts, drop TestBrand/TestProduct rows
   ▼
Astro 4 static build (output: 'static')
   ├─ index.astro              home catalogue, all cards pre-rendered
   ├─ offers/[slug].astro      one page per offer
   ├─ category/[category].astro
   ├─ guides/[slug].astro, about.astro
   └─ robots.txt.ts, sitemap.xml.ts, llms.txt.ts
   ▼
dist/  (3983 pages as of 2026-09-02)
   ▼
Netlify (netlify.toml: npm run build → dist, Node 20)
   ▼
https://offers.akay.ie
```

## Why static

- No server means nothing to keep alive, patch, or secure at runtime.
- Search, category filter and sort run in the browser over the pre-rendered
  cards. There are no data round-trips after page load.
- The token stays in the build environment. Nothing in `dist/` can call
  Airtable.
- `content-visibility: auto` on cards keeps the single-page catalogue fast at
  any size (it was 1,400+ cards when that decision was made and is ~4,000 now).

The cost is freshness: the site shows Airtable as of the last build. The
refresh loop below closes that gap to a few minutes.

## The two data paths and why they must agree

`getOffers()` returns `{ offers, source }` where `source` is `'live'` or
`'snapshot'`.

- **Live**: `AIRTABLE_TOKEN` is set and the fetch succeeds. `normalize()` runs
  on every record.
- **Snapshot**: no token, network blocked, fetch failed, or zero rows returned.
  `src/data/offers-snapshot.json` is loaded and every offer passes through
  `renormalizeSnapshotOffer()`, which re-applies the same corrections
  `normalize()` makes.

Netlify's build does **not** hold an Airtable token. Netlify always builds from
the snapshot. That is deliberate: the snapshot is refreshed by the GitHub Action,
and the commit is what triggers Netlify. So in production the snapshot path *is*
the site, and any correction that only lives in `normalize()` will not reach
production until the snapshot is regenerated. Keep both functions in step.

`<html data-source="live|snapshot">` on the home page tells you which path built
the page you are looking at.

## The refresh loop

`.github/workflows/refresh.yml` runs every 5 minutes and on manual dispatch:

1. Check out `claude/softr-webflow-migration-50kj20`.
2. `npm run sync-offers` with the `AIRTABLE_TOKEN` repository secret. The script
   refuses to overwrite the snapshot unless the live fetch succeeded, so a
   transient Airtable error can never blank the catalogue.
3. If `src/data/offers-snapshot.json` changed, commit as `akay-refresh-bot` and
   push to the same branch. That push triggers a Netlify build.
4. If unchanged, exit. No commit, no Netlify build minutes spent.

The retry logic in `fetchWithRetry()` exists because the build, this Action and
n8n's ingestion all share Airtable's 5 requests/second/base budget.

## Airtable field allowlist

Only these fields are ever requested. Anything else stays inside Airtable.

```
Public Product Description, Variant, Brand, Category, Public Spec,
Price Display, Currency, Price Per Unit & Case, PCS/Case,
Stock Display, Stock Cases, Public Terms,
Bond/Customs Status, Origin Country, Public Listing, Featured
```

## Normalised offer shape

Every page consumes this object, never raw Airtable fields.

| Property | Source and meaning |
|---|---|
| `id` | Airtable record id, or `snapshot-N` fallback. Key for slug maps. |
| `name`, `variants` | `Public Product Description` with trailing variant lists split off, or the `Variant` field. |
| `brand`, `category`, `spec`, `origin`, `terms`, `tier` | Direct copies. `tier` is `Bond/Customs Status` (T1 export / T2 EU duty-paid). |
| `currency`, `amount`, `priceBasis` | Headline price part from `Price Per Unit & Case` (or `Price Display`). Amount and basis always from the **same** part. |
| `unitAmount` | Per-unit figure for sorting. Case price ÷ pack size when only a case price exists. |
| `priceDetail` | The raw price string, shown on the card. |
| `stock` | `'in'` / `'warn'` / `'enq'` from `Stock Display`. |
| `qty` | `Stock Cases` rounded to whole cases. |
| `featured` | Pins the card to the front of the grid. |

## URLs

- `/offers/<slug>/` where slug = `generateSlug(name, spec)` lowercased, ASCII,
  hyphenated, truncated to 90 chars, collisions get `-2`, `-3`. Each page that
  needs slugs rebuilds the same map the same way, so they stay consistent.
- `/category/<category-lowercase-hyphenated>/`
- `/guides/<slug>/` from `src/data/guides.mjs`
- `/about/`, `/robots.txt`, `/sitemap.xml`, `/llms.txt`

## Third-party touchpoints

| Service | How it is used |
|---|---|
| Airtable | Read-only PAT at build time. Also the destination of n8n ingestion. |
| Netlify | Hosting, build, HTTPS. Config pinned in `netlify.toml`. |
| GitHub Actions | The refresh Action. Free minutes on a public repo. |
| GoDaddy | DNS for `akay.ie`. `offers` CNAME points at Netlify. |
| WhatsApp | `wa.me` click-to-chat deep links only. No API. Number in `src/lib/whatsapp.mjs`. |
| n8n cloud | Category request form on the home page posts to an n8n webhook with `mode: 'no-cors'`, so the response is opaque. Also runs the WhatsApp ingestion workflows mirrored in `n8n/`. |
| Google Analytics 4 | Tag on the home page. ID hard-coded with `PUBLIC_GA4_ID` override. |
| Google Search Console | Verification meta tag and HTML file in `public/`. |

## What is *not* here

- No lint, format, typecheck, or test runner config for the site.
- No Astro integrations or component framework. Pages are single `.astro`
  files with scoped `<style>` and inline `<script>`.
- No CMS for guides. They are a JavaScript array.
