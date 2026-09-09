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

## Domain — the site is served from `akay.ie`

The catalogue moved from `offers.akay.ie` to the apex domain. Paths did not
change, so every old URL maps 1:1 onto the same path on `akay.ie`.

1. In Netlify → **Domain management**, `akay.ie` is the **primary domain**.
   Keep `offers.akay.ie` attached as a domain alias, with its DNS still
   pointing at Netlify, for at least 12 months — the 301s below only fire for
   requests that actually reach the site.
2. `netlify.toml` holds the redirects: `offers.akay.ie/*` and `www.akay.ie/*`
   → `https://akay.ie/:splat`, status 301, `force = true`.
3. A Cloudflare **Redirect Rule** can do the same at the edge (When
   `(http.host eq "offers.akay.ie")` → 301 to
   `concat("https://akay.ie", http.request.uri.path)`). Either is enough; the
   `netlify.toml` rules are the fallback if the Cloudflare rule is ever
   removed, and they cost nothing when Cloudflare answers first.
4. Verify: `curl -sI https://offers.akay.ie/about/` → `301` +
   `location: https://akay.ie/about/`.

---

## SEO

Everything below is generated at build time; there is nothing to maintain by
hand except the copy.

| Concern | Where it lives |
| --- | --- |
| Origin, site name, social profiles | `src/lib/site.mjs` — one constant, `SITE_URL` |
| `<head>` for every page | `src/components/Seo.astro` (title, description, canonical, robots, Open Graph, Twitter, GA4, JSON-LD) |
| JSON-LD | `src/lib/schema.mjs` — Organization, WebSite, Product, BreadcrumbList, CollectionPage, Article |
| Price wording in titles/cards | `src/lib/price.mjs` — reads the parsed basis so a per-bottle line never says "/case" |
| Slugs | `src/lib/slug.mjs` — `withSlugs()` is the single ordering, shared by the offer pages, sitemap and homepage |
| `sitemap.xml`, `robots.txt`, `llms.txt` | `src/pages/*.ts`, generated from the live catalogue |
| Redirects, security + cache headers | `netlify.toml` |

Crawl paths matter more than any tag here: the homepage links to every offer
page and to `/category/<name>/`, category pages cross-link their siblings, and
offer pages link back to their category. Breaking those links orphans several
thousand pages, whatever the sitemap says.

**After a deploy that changes the domain or URL structure:**

1. Add `akay.ie` as a property in Google Search Console and verify it (the
   verification token is in `src/components/Seo.astro`).
2. Submit `https://akay.ie/sitemap.xml`.
3. In the **old** `offers.akay.ie` property, use *Settings → Change of
   address* to point it at `akay.ie`. This only works while the 301s are live.
4. Check Bing Webmaster Tools the same way (it can import from GSC).

---

## Project layout

```
src/
  data/
    airtable.mjs          live fetch + normalize (public-safe fields only)
    offers-snapshot.json  offline/CI fallback sample
  lib/
    fetch-offers.mjs      refresh the snapshot from live data
  pages/
    index.astro           the catalogue (design + interactivity)
public/
  akay-bird.png           logo (hummingbird, transparent)
```
