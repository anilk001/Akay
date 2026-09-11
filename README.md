# AKAY — Trade Offers (`akay.ie`)

The public B2B beverage catalogue for AKAY. A fast, static [Astro](https://astro.build)
site that reads the offers **live from Airtable at build time** and renders every
card as plain HTML — so the published site needs no server and is served globally
by Netlify.

Replaces the previous Softr page. Same Airtable base, full design control, own domain.

---

## What it shows

Only **public-safe** fields are ever read from Airtable. Supplier identity, buy
prices, margins and internal notes are **not requested**, so they cannot reach the
browser. The catalogue lists, per offer: product, pack spec, price (per the listing
basis + the complementary unit/case figure), duty tier (**T1** export / **T2** EU
duty-paid), origin, incoterm, stock status, **cases available**, and a one-tap
prefilled **WhatsApp enquiry**.

Search, category filter, and price/name sort run client-side on the pre-rendered
cards (no data round-trips).

### Search (`/search`)

Every page header carries a search box that lands on `/search/`. The page
fetches `/search-index.json` — generated at build time from the same
public-safe offer shape — and searches it in the browser with
`src/lib/search-engine.mjs`:

- typo tolerant (`guiness`, `jamson`), unit-aware (`44cl` = `440ml`, `0.7` =
  `700ml`, `24x440`), spelling-aware (draft/draught, whisky/whiskey);
- multi-select facets: category, brand, size, pack, unit type, bond (T1/T2),
  warehouse, incoterm, in-stock only, per-currency price range;
- sort by relevance, price per unit, or newest (`Offer Date`);
- the whole state lives in the URL (`/search/?q=guinness&cat=Beer&size=440ml`)
  so searches can be bookmarked and shared, and the back button works.

`npm test` runs the normaliser and engine tests against the committed snapshot,
including the acceptance case "guiness 44cl → Guinness Draught 24 x 440ml".

---

## Local development

```bash
npm install
cp .env.example .env         # then paste your read-only Airtable token into .env
npm run dev                  # http://localhost:4321
```

Without a token (or without network access) the site builds from
`src/data/offers-snapshot.json` — a committed sample — so the build never breaks.
With a token it fetches the full live catalogue.

Refresh the offline snapshot from live data:

```bash
AIRTABLE_TOKEN=pat... npm run sync-offers
```

---

## Public-safety assertion

`npm run build` runs `scripts/check-public-safety.mjs` after Astro finishes. It
fails the build if `dist/search-index.json` carries a key outside the public
allowlist, or if any generated file contains a forbidden Airtable column name
(`Supplier Name`, `Buy Price`, `Margin %`, `Trader Comment`, …) or an Airtable
token. `src/data/airtable.mjs` also refuses to load if `FIELDS` ever names a
forbidden field. CI (`.github/workflows/ci.yml`) runs the tests and the build on
every push.

## Environment variables

| Variable | Purpose |
|---|---|
| `AIRTABLE_TOKEN` | **Read-only** Personal Access Token (`data.records:read`, `schema.bases:read`). Build-time only; never shipped to the browser. |
| `AIRTABLE_BASE_ID` | Defaults to the `Akay Offers` base (`appaDSdZkAE9PGkjT`). |
| `AIRTABLE_OFFERS_TABLE` | Defaults to `Offers`. |

Never commit the token — `.env` is git-ignored.

---

## Deploy — Netlify

Build settings are pinned in [`netlify.toml`](./netlify.toml) (`npm run build` → `dist`,
Node 20), so Netlify needs almost no dashboard config.

1. **Connect the repo** in Netlify → *Add new site* → *Import an existing project* → this repo.
   Netlify auto-detects Astro and reads `netlify.toml`.
2. **Environment variables** (Site configuration → Environment variables): add `AIRTABLE_TOKEN`
   (and optionally `AIRTABLE_BASE_ID`). Build-time only; never shipped to the browser.
3. **Deploy.** Netlify builds the site; the build fetches live offers.

### Refresh when offers change
The site is static, so it reflects Airtable as of the last build. To refresh:
- Create a **Build Hook** (Site configuration → Build & deploy → Build hooks) and
  `POST` to it — from an Airtable automation when an offer changes, and/or on a schedule
  (n8n / the scheduled GitHub Action in `.github/workflows/refresh.yml`). Each hit rebuilds
  and republishes in ~1 minute.

---

## Go-live — serve the site at `akay.ie` (DNS on Cloudflare)

1. In Netlify → your site → **Domain management** → *Add a domain* → enter `akay.ie`
   and set it as the **primary domain**. Keep `offers.akay.ie` listed as a domain alias
   so Netlify still answers for it while the redirect below is live.
2. In **Cloudflare** → DNS: point the apex `akay.ie` at Netlify (`A`/`ALIAS`/flattened `CNAME`
   to the load-balancer/hostname Netlify shows), **proxied** (orange cloud). Leave the
   `offers` record in place and proxied — a Cloudflare redirect rule only runs on proxied hosts.
3. In **Cloudflare** → Rules → **Redirect Rules** → create a dynamic rule:
   - When: `(http.host eq "offers.akay.ie")`
   - Then: 301, URL = `concat("https://akay.ie", http.request.uri.path)`, preserve query string.
4. Wait for DNS + automatic HTTPS to provision (usually minutes). Verify with
   `curl -sI https://offers.akay.ie/about/` → `301` + `location: https://akay.ie/about/`.

---

## Project layout

```
src/
  data/
    airtable.mjs          live fetch + normalize (public-safe fields only)
    offers-snapshot.json  offline/CI fallback sample
  lib/
    fetch-offers.mjs      refresh the snapshot from live data
    normalise.mjs         size/pack/spelling normaliser (build + browser)
    search-engine.mjs     inverted index with exact/prefix/fuzzy matching
  components/
    SiteSearch.astro      header search form used on every page
  pages/
    index.astro           the catalogue (design + interactivity)
    search.astro          instant search with facets (/search)
    search-index.json.ts  public-safe search index endpoint
scripts/
  check-public-safety.mjs post-build forbidden-field assertion
tests/                    node tests for the normaliser and engine
public/
  akay-bird.png           logo (hummingbird, transparent)
```
