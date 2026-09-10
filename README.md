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

## Offer videos (Remotion)

Social videos — 9:16 reels, square posts, multi-offer rolls — are generated from
the same catalogue data with [Remotion](https://remotion.dev). The video
workspace lives in `video/` with its own dependencies, so the site build and the
Netlify deploy are untouched by it.

```bash
npm run video:install                        # once
npm run video:list -- corona                 # find an offer
npm run video:render -- -o "Corona Extra"    # -> video/out/OfferReel-*.mp4
npm run video                                # Remotion Studio (visual editor)
```

Full flag reference and the list of compositions: [`video/README.md`](video/README.md).

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
  pages/
    index.astro           the catalogue (design + interactivity)
public/
  akay-bird.png           logo (hummingbird, transparent)
video/                    Remotion offer videos (own package.json — see video/README.md)
```
