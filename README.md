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
src/
  data/
    airtable.mjs          live fetch + normalize (public-safe fields only)
    offers-snapshot.json  offline/CI fallback sample
    slug-registry.json    every offer URL ever published (drives "discontinued" pages)
  lib/
    fetch-offers.mjs      refresh the snapshot + slug registry from live data
    slug.mjs              URL slugs (brand-product-packsize) + category slugs
    registry.mjs          off-sale URL bookkeeping (discontinued vs 410)
  layouts/
    Site.astro            shared head/nav/footer + Organization JSON-LD
  pages/
    index.astro           the catalogue (design + interactivity)
    offers/[slug].astro   one page per offer (Product/Offer JSON-LD, breadcrumbs)
    category/[cat].astro  one page per category (ItemList JSON-LD)
    guides/*.astro        T1/T2, incoterms, how-to-buy, requirement lists
    about.astro           company entity page
    sitemap.xml.ts        build-time sitemap (offers + categories + guides)
    llms.txt.ts           AI-crawler site map
scripts/
  gen-redirects.mjs       410s for offers off-sale >90 days (runs before build)
public/
  akay-bird.png           logo (hummingbird, transparent)
  robots.txt              open to all crawlers incl. AI bots, names sitemap
  410.html                target page for long-gone offer URLs
```

---

## SEO / AI-search architecture

Implemented per the SEO brief (Aug 2026): the site is citable by AI answer
engines and rankable for long-tail wholesale queries.

- **Every live offer has its own URL** — `/offers/<brand-product-packsize>/`,
  generated at build time. Slugs contain **no supplier identity, ever**.
- **Off-sale offers never 404.** The slug registry remembers every published
  URL; off-sale pages render "no longer available" (schema availability:
  `Discontinued`) with a link to the category, and only return **410** after
  ~90 days (via the generated `public/_redirects`).
- **Structured data**: `Organization` (every page), `Product` + `Offer` with
  `eligibleCustomerType: Business` (offer pages — prevents consumer
  shopping-comparison misclassification), `ItemList` (categories),
  `FAQPage`/`Article` (guides), `BreadcrumbList`.
- **Freshness**: the scheduled GitHub Action re-bakes the snapshot every
  5 minutes and commits only on change; every commit redeploys Netlify, so
  sitemap `lastmod`, prices and `priceValidUntil` stay honest automatically.

### Post-deploy checklist (manual, once)

1. Verify the site in **Google Search Console** (DNS TXT on akay.ie) and
   submit `https://offers.akay.ie/sitemap.xml`.
2. Submit the same in **Bing Webmaster Tools** (feeds ChatGPT search + Copilot).
3. Validate 2–3 offer pages in Google's **Rich Results Test**.
4. Confirm `/robots.txt` and `/llms.txt` resolve.
5. Optionally add the CRO number + VAT number to the Organization schema
   (`src/layouts/Site.astro` and `src/pages/index.astro`) — they materially
   increase AI trust for B2B recommendations.
