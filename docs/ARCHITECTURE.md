# Architecture

One sentence: **Airtable is the database, `npm run build` is the query, Netlify is
the cache.** Everything else follows from that.

## Data flow

```
Airtable "Akay Offers" base, table "Offers"
   │  filterByFormula {Public Listing}='Yes', fields[] = FIELDS allowlist only
   │  read-only PAT, 100 records/page, retry on 429/5xx
   ▼
src/data/airtable.mjs  getOffers()
   │  normalize(): parse price parts, derive unitAmount, split variants, round qty
   │  falls back to src/data/offers-snapshot.json when no token / no network
   ▼
Astro pages (build time only)
   ├─ src/pages/index.astro            catalogue grid, client-side search/filter/sort
   ├─ src/pages/offers/[slug].astro    one page per offer + Product/Offer JSON-LD
   ├─ src/pages/category/[category].astro
   ├─ src/pages/guides/[slug].astro    static content from src/data/guides.mjs
   ├─ src/pages/about.astro
   └─ src/pages/{sitemap.xml,robots.txt,llms.txt}.ts   prerendered endpoints
   ▼
dist/  (~4,000 HTML files)  →  Netlify serves it. No server, no runtime fetches.
```

Every "WhatsApp Enquiry" button is a `https://wa.me/<number>?text=...` link built
by `src/lib/whatsapp.mjs`. There is no WhatsApp API integration on the site.

## How the site stays fresh

The site can only show what was fetched at build time. Freshness comes from
`.github/workflows/refresh.yml`:

1. Every 5 minutes, a GitHub Action checks out the **default branch**, runs
   `npm run sync-offers` with the `AIRTABLE_TOKEN` repository secret.
2. If `offers-snapshot.json` changed, it commits `chore: refresh catalogue snapshot
   from Airtable` and pushes.
3. That push triggers a Netlify build. Netlify itself holds **no** Airtable token, so
   Netlify builds always render from the committed snapshot.

Consequences you must remember:
- The snapshot is production data, not a sample. Its `generated` date tells you how
  stale it is.
- ~95% of commits on the default branch are bot snapshot commits. Filter them out
  when reading history: `git log --grep='refresh catalogue snapshot' --invert-grep`.
- Any feature branch older than five minutes will conflict on the snapshot when
  merged. See `docs/WORKFLOW.md` for the resolution recipe.

## Source layout

```
src/
  data/
    airtable.mjs          fetch + normalize. FIELDS allowlist lives here. Read it before touching prices.
    offers-snapshot.json  bot-maintained. Never hand-edit.
    guides.mjs            long-form guide content (T1/T2, incoterms, how to buy)
  lib/
    whatsapp.mjs          WA_NUMBER, WA_LINK, enquiryLink(offer, basisMsg)
    schema.mjs            JSON-LD builders (Organization, Product/Offer, Breadcrumb, ItemList, Article)
    slug.mjs              generateSlug, dedupeSlug, buildSlugMap, buildOfferBySlug
    fetch-offers.mjs      `npm run sync-offers` entry point
  pages/                  see data flow above
  env.d.ts                Astro type reference only
public/
  akay-bird.png           logo, referenced by every page and by JSON-LD
  google*.html            Search Console verification, keep
  robots.txt, sitemap.xml DEAD. Shadowed by the .ts routes in src/pages (route wins; verified in dist/). Safe to delete.
n8n/                      mirrors of n8n Code nodes + plain-node tests. See n8n/README.md.
.claude/
  hooks/session-start.sh  npm install on remote session start
  rules/*.md              path-scoped memory, auto-loaded when matching files are edited
  skills/*/               offers-catalogue, offer-data-validator, price-list-intake, structured-reasoning
.github/workflows/refresh.yml   the 5-minute snapshot bot
netlify.toml              build cmd, publish dir, Node 20, cache headers
astro.config.mjs          site URL, static output, assets dir
```

## The offer object (what pages receive)

Produced by `normalize()` in `airtable.mjs`. Field-level rules are in `DATA-RULES.md`.

| Property | Type | Notes |
|---|---|---|
| `id` | string | Airtable record id, or `snapshot-<i>` when missing |
| `name` | string | product description with any trailing variant list split off |
| `variants` | string | comma list, may be `''` |
| `brand`, `category`, `spec`, `terms`, `tier`, `origin` | string | all may be `''`. `category` defaults to `'Other'` |
| `currency` | string | `'EUR'`, `'GBP'`, `'USD'` or `''` |
| `amount` | number or **null** | headline price, in the unit given by `priceBasis` |
| `priceBasis` | string | `'case'`, `'pack'`, `'unit'`, `'btl'`, `'bottle'`, `'can'`, `'piece'`, `'jar'` or `''` (unknown) |
| `unitAmount` | number or null | per-unit figure used for sorting; derived from case ÷ pack when needed |
| `priceDetail` | string | the raw `Price Per Unit & Case` string, e.g. `EUR 9.24/case (12pk) · EUR 0.77/unit` |
| `stock` | `'in'` / `'warn'` / `'enq'` | from `Stock Display` text |
| `qty` | integer or null | whole cases available |
| `featured` | boolean | pins the card to the front |

## Known structural debt (documented, not yet fixed)

Listed so nobody rediscovers them from scratch. Fix them when you are already in
the file; do not open a PR just to fix one unless asked.

1. `getOffers()` is called independently by four routes, so a live build makes four
   full passes over Airtable (~40 requests each). This is a real contributor to the
   429s that `fetchWithRetry` exists to absorb. A module-level memo would fix it.
2. The slug-map loop is copy-pasted in `offers/[slug].astro`, `category/[category].astro`
   and `sitemap.xml.ts`. `buildSlugMap()` in `slug.mjs` already does it and is unused.
   Any drift between the copies breaks internal links silently.
3. `priceParts()` is duplicated in `index.astro` and `offers/[slug].astro`.
4. `offers/[slug].astro` still hardcodes `/case` in `pageTitle` and `pageDesc` (lines
   ~68-69). This is the exact bug class fixed in the JSON-LD in commit `4285564`.
5. Slugs depend on Airtable record order for `-2`, `-3` dedupe suffixes, so a reorder
   can move a URL. Acceptable for now; noted so nobody is surprised.
6. `public/robots.txt` and `public/sitemap.xml` are dead files (see layout above).
