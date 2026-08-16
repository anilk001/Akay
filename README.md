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

## Claude Code tooling (MCP)

[`.mcp.json`](./.mcp.json) registers only the two **local, credential-free** MCP
servers — `sequential-thinking` and `memory`. They need no tokens and no network
access, so they work in every session.

**Airtable and GitHub are deliberately not in `.mcp.json`.** They are provided as
account-level connectors instead, which is why no `AIRTABLE_API_KEY` or
`GITHUB_MCP_PAT` variable is needed anywhere:

| Capability | Where it comes from | Why not `.mcp.json` |
|---|---|---|
| Airtable | Airtable connector (`mcp__Airtable__*`) | The `npx airtable-mcp-server` entry could never work in a Claude Code on the web session — `api.airtable.com` is outside the network egress allowlist. |
| GitHub | Managed GitHub integration (`mcp__github__*`) | Already authenticated per session; the `${GITHUB_MCP_PAT}` http entry was a duplicate that shadowed nothing and authenticated nobody. |

Both were removed because they were inert *and* because each one duplicated a
working toolset — two Airtable namespaces differing only by capitalisation
(`mcp__airtable__*` vs `mcp__Airtable__*`) is an easy way to reach for the broken one.

Note: the `memory` server persists its graph inside the ephemeral `npx` cache, so
in a web session it is forgotten when the container is reclaimed. Treat it as
within-session scratch memory, not durable storage.

> **Airtable write access.** The Airtable connector holds `create` permission on
> the live `Akay Offers` base. That is broader than the read-only PAT this site's
> build uses (`data.records:read`, `schema.bases:read`) — an agent session can
> write to the production catalogue. Keep that in mind when granting it.

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
