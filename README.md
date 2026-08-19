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

## Trade assistant (chat)

A **Ask for an offer** button sits on the catalogue. A buyer types what they
want in plain English — *"Jameson 70, Monkey Shoulder and Smirnoff"* — and the
assistant answers with our live prices, then offers to send the list to their
**WhatsApp** or **email**.

```
browser  ──POST /api/chat──▶  netlify/functions/chat.mjs
                                 │  ├─ search_offers        → /offers-index.json
                                 │  ├─ send_whatsapp_quote  → wa.me deep link
                                 │  └─ request_email_quote  → n8n Chat Quote Handler
                                 └─ Claude (claude-opus-5)
```

Five things make this safe to point at a public site:

- **It cannot invent a price.** The model never sees the catalogue as free text.
  It calls `search_offers`, and every figure it repeats is copied from
  `/offers-index.json` — the same `getOffers()` data that renders the cards, so
  the chat and the page can never disagree.
- **Live offers only.** `{Public Listing}='Yes'` is the single source of truth for
  what is publishable. It is maintained in Airtable and already guarantees the row
  is live — no supplier detail, nothing expired or stale — so the query applies it
  and nothing else. There is deliberately no second gate in code: duplicating that
  rule here would just create two definitions to keep in step. The assistant reads
  the same index the cards are built from, so it cannot reach anything the site
  does not already publish.
- **No supplier, buy price or margin.** Those fields are never requested from
  Airtable, so they cannot leak. On top of that, `PUBLIC_KEYS` in
  `src/pages/offers-index.json.ts` is an explicit allowlist and the build **fails**
  if any other key reaches the published index — that guards against a future edit
  to `normalize()` quietly publishing something new, not against Airtable. The chat
  function applies the same list again when it loads the index.
- **The key stays server-side.** The site is static; the Netlify function is the
  only place `ANTHROPIC_API_KEY` exists. Conversation history arriving from the
  browser is rebuilt as plain user/assistant text, so a crafted payload cannot
  forge tool results.
- **Nothing is emailed to a buyer automatically.** `request_email_quote` posts to
  the n8n **Chat Quote Handler**, which logs a draft Enquiry in Airtable as
  *Pending Review* and notifies `ak@akay.ie` — the same review-first flow as the
  Category Request Handler. The assistant tells the buyer their quote is with the
  team, never that it has been sent.

WhatsApp needs no API: the assistant builds a `wa.me` link with the quote already
written out, and the buyer taps to send it to us.

### Turning it on

1. Set `ANTHROPIC_API_KEY` in Netlify → Site settings → Environment variables.
2. Set `AKAY_QUOTE_WEBHOOK_URL` to the Chat Quote Handler production webhook
   (`https://akay-team.app.n8n.cloud/webhook/chat-quote`).
3. Publish the **Chat Quote Handler — Akay** workflow in n8n (created inactive)
   and confirm its Airtable and Gmail credentials.

Without step 1 the widget says it is not configured. Without steps 2–3 the search
and WhatsApp paths still work; the assistant declines the email option and points
the buyer at WhatsApp instead of pretending it worked.

The search itself lives in [`src/lib/offer-search.mjs`](./src/lib/offer-search.mjs)
— plain string scoring, no dependencies. It normalises bottle sizes so "Jameson
70" matches rows written `6 x 700ml`, and when no size is given it returns one
line per pack format so a 5cl miniature does not outrank the standard bottle on
price-per-unit.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `AIRTABLE_TOKEN` | **Read-only** Personal Access Token (`data.records:read`, `schema.bases:read`). Build-time only; never shipped to the browser. |
| `AIRTABLE_BASE_ID` | Defaults to the `Akay Offers` base (`appaDSdZkAE9PGkjT`). |
| `AIRTABLE_OFFERS_TABLE` | Defaults to `Offers`. |
| `ANTHROPIC_API_KEY` | Powers the trade assistant. **Server-side only** — read by the Netlify function, never exposed to the browser. |
| `AKAY_QUOTE_WEBHOOK_URL` | n8n Chat Quote Handler webhook. Unset = the assistant declines the email option rather than silently dropping it. |
| `AKAY_WHATSAPP_NUMBER` | Defaults to `353872382368`. |

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
  lib/
    fetch-offers.mjs      refresh the snapshot from live data
  pages/
    index.astro           the catalogue (design + interactivity)
public/
  akay-bird.png           logo (hummingbird, transparent)
```
