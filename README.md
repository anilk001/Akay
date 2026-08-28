# AKAY — Trade Offers (`offers.akay.ie`)

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

## Go-live — point `offers.akay.ie` (domain at GoDaddy)

1. In Netlify → your site → **Domain management** → *Add a domain* → enter `offers.akay.ie`.
   Netlify shows the target hostname.
2. In **GoDaddy** → your domain → **DNS** → add a **CNAME**:
   - Type `CNAME`, Name `offers`, Value = the `*.netlify.app` hostname Netlify gave you.
3. Wait for DNS + automatic HTTPS to provision (usually minutes). Done.

---

## Project layout

```
scripts/
  assert-public-safe.mjs    build gate: fails if a denied Airtable field ID or
                            label reaches dist/ (brief §0)
  build-stock-list.mjs      bakes dist/downloads/akay-stock-list.xlsx from the
                            public-safe column allow-list (§4)
src/
  data/
    airtable.mjs            live fetch + normalize (public-safe fields only)
    offers-snapshot.json    committed snapshot; what Netlify actually builds from
    brand-registry.json     append-only record of every brand slug ever
                            published, so a sold-through brand's page goes
                            noindex instead of 404 (§1)
    brand-aliases.mjs       committed brand merge map; the build warns on any
                            unlisted slug collision
    company.mjs             registered identity for the credibility block (§2);
                            TBC values render "On request" and warn at build
    guides.mjs              long-form guide content
  i18n/
    locales.mjs             the five locales and their direction
    content.mjs             translated copy for the trust pages (§6)
  lib/
    catalogue.mjs           getCatalogue() — the resolved catalogue, once per
                            build: slugs, brands, categories, freshness
    slug.mjs                offer slugs (unchanged, URLs are live) + brand and
                            category slugs
    aggregation-intro.mjs   brand/category intro prose, composed only from data
                            on the page's own offers
    glossary.mjs            customs statuses and Incoterms (§3, §3a)
    stock-list.mjs          XLSX path + the public-safe column allow-list
    brand-registry.mjs      read/append the brand registry
    schema.mjs              JSON-LD builders
    whatsapp.mjs            click-to-chat links
    fetch-offers.mjs        refresh the snapshot + registry from live data
  layouts/
    BaseLayout.astro        shared shell: tokens, header, hreflang, footer
  components/
    OfferCard.astro         the one offer card, used by index/brand/category
    SiteFooter.astro        §2 credibility block, on every page
    RfqBasket.astro         §4 basket, RFQ form and stock-list gate
  pages/
    index.astro             the catalogue
    offers/[slug].astro     one page per offer (~2,890)
    brand/[slug].astro      one page per brand (~671)
    category/[category].astro
    brands.astro            brand directory
    categories.astro        category directory
    trade-terms.astro       §3
    customs-glossary.astro  §3a
    about.astro             §2
    [lang]/                 pt/es/fr/ar trust pages and category pages (§6)
    sitemap.xml.ts          every indexable URL, with hreflang
public/
  akay-bird.png             logo (hummingbird, transparent)
```

---

## Build

`npm run build` runs three steps in order, and any of them failing stops the deploy:

1. `astro build` — renders the static site into `dist/`
2. `npm run build:stock-list` — writes `dist/downloads/akay-stock-list.xlsx`
3. `npm run verify:public-safe` — scans `dist/` for private Airtable data

### The data-safety gate

`scripts/assert-public-safe.mjs` is the backstop for brief §0. The data layer
only ever *requests* public-safe fields, so supplier identity, buy prices and
margins never enter the process — but a future page could still serialise a raw
record, or someone could paste an internal field ID into a comment. The gate
reads what was actually written to `dist/` and exits non-zero on a match, before
Netlify or GitHub Actions can publish it.

The XLSX is a binary zip that the text scan cannot see inside, so
`build-stock-list.mjs` checks its own sheet headers against the allow-list in
`src/lib/stock-list.mjs` and refuses to write a workbook carrying anything else.

### Refreshing the catalogue

`npm run sync-offers` re-fetches from Airtable and writes **two** files:
`offers-snapshot.json` and `brand-registry.json`. The scheduled refresh workflow
commits both together — the registry is what keeps a sold-through brand's page
alive at `noindex` rather than 404, and Netlify builds without an Airtable token
so the snapshot alone cannot tell the build what has gone.

### RFQ submissions

The basket POSTs JSON straight from the browser to an n8n webhook
(`PUBLIC_RFQ_WEBHOOK_URL`, see `.env.example`). No Netlify Forms, no Netlify
Functions — the site stays fully static. The request and response contract is
Appendix A of the build brief; the client mirrors its validation rules so a buyer
gets the rejection immediately rather than a 400 a few seconds later.
