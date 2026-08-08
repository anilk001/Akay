---
name: offers-catalogue
description: Work on the AKAY trade offers catalogue (offers.akay.ie) — the Astro static site that reads offers live from Airtable at build time. Use when editing offer cards, the Airtable data layer, refreshing the offline snapshot, running the build, or debugging why offers look wrong. Covers the Airtable → build → Netlify deploy pipeline and the public-safe field rules.
---

# AKAY offers catalogue

A static [Astro](https://astro.build) site (`offers.akay.ie`) that renders the
public B2B beverage catalogue. Offers are read **live from Airtable at build
time** and baked into plain HTML — the published site runs no server.

## The golden rule: only public-safe fields

The data layer requests an explicit allowlist of fields. Supplier identity, buy
prices, margins and internal notes are **never requested**, so they cannot reach
the browser. When adding a field to a card, first add it to the `FIELDS` array in
`src/data/airtable.mjs` — and only if it is genuinely public-safe.

## Where things live

```
src/
  data/
    airtable.mjs          live fetch + normalize (public-safe fields only)
    offers-snapshot.json  offline/CI fallback — committed sample data
  lib/
    fetch-offers.mjs      `npm run sync-offers` — refresh the snapshot from live data
  pages/
    index.astro           the catalogue: layout, styling, client-side search/filter/sort
public/
  akay-bird.png           logo
```

## Common tasks

### Run and preview locally
```bash
npm install
npm run dev            # http://localhost:4321  (uses snapshot unless AIRTABLE_TOKEN is set)
npm run build          # static build into dist/
```

### The build never breaks without a token
`getOffers()` in `src/data/airtable.mjs` falls back to `offers-snapshot.json`
whenever there is no `AIRTABLE_TOKEN` or the network is unavailable (e.g. a
restricted CI sandbox). A build log line `[airtable] … — using snapshot` means
the fallback ran — that is expected offline, **not** an error.

### Refresh the offline snapshot from live Airtable
```bash
AIRTABLE_TOKEN=pat... npm run sync-offers
```
This overwrites `src/data/offers-snapshot.json` **only if the live fetch
succeeds**. Commit the updated snapshot so offline/CI builds stay current.

### Change what a card shows
1. Add the Airtable field name to `FIELDS` in `src/data/airtable.mjs` (public-safe only).
2. Map it in `normalize()` to a property on the offer object.
3. Render it in `src/pages/index.astro`.
4. `npm run build` and check `dist/index.html`.

## Environment variables

| Variable | Purpose |
|---|---|
| `AIRTABLE_TOKEN` | Read-only PAT (`data.records:read`, `schema.bases:read`). Build-time only; never shipped to the browser. Falls back to snapshot when absent. |
| `AIRTABLE_BASE_ID` | Defaults to the `Akay Offers` base (`appaDSdZkAE9PGkjT`). |
| `AIRTABLE_OFFERS_TABLE` | Defaults to `Offers`. |
| `PUBLIC_GA4_ID` | Optional GA4 Measurement ID; safe to expose (the `PUBLIC_` prefix ships it to the browser). |

Never commit the token — `.env` is git-ignored.

## Deploy pipeline

The site is static, so it reflects Airtable as of the last build. Netlify
(`netlify.toml`: `npm run build` → `dist`, Node 20) redeploys on every push.
`.github/workflows/refresh.yml` pushes an empty commit on a schedule to trigger a
fresh Netlify build that re-fetches live offers — no build hook or secrets needed.

## Verification

There is no test or lint suite. The verification command is the build:
```bash
npm run build
```
A clean exit with `[build] Complete!` means the catalogue renders.
