# AKAY Trade Desk — quote.akay.ie

The buyer-facing pricing tool the catalogue links to. Two tabs, both hash
routed, so every link into it is a plain URL:

| Tab | URL | What it does |
| --- | --- | --- |
| Ask AKAY | `https://quote.akay.ie/#chat` | Chat against the live offers — streams answers with the offers it used |
| Upload your list | `https://quote.akay.ie/#excel` | Buyer drops an .xlsx/.xls/.csv buying list and downloads it back with our price on every line |

An unknown hash falls back to `#chat`, so a stale link never lands on a blank
screen. `src/lib/site.mjs` in the catalogue builds these URLs (`quoteUrl()`) —
that is the one place the origin and the tab ids are written down.

## What is in this folder

A **pre-built** Vite/React bundle — `index.html` plus the hashed files in
`assets/`. It is not built from this repository; it is checked in so that what
is live at quote.akay.ie is reviewable and reproducible, and so a patched build
is a diff rather than an untracked zip on someone's laptop.

To update the tool, replace `index.html` and `assets/` with the new build
(delete the old hashed assets — they are content-addressed, so stale ones just
accumulate), keep the files below, and deploy.

| File | Why it is here |
| --- | --- |
| `_redirects` | `/* /index.html 200` — SPA fallback so `#chat` deep links and refreshes resolve |
| `_headers` | `noindex, nofollow` on every path, `nosniff`, a strict referrer policy, and a one-year immutable cache on `/assets/*` |
| `robots.txt` | Keeps crawlers off the SPA shell. Without a real file the fallback rewrite would answer `/robots.txt` with the app's HTML |
| `netlify.toml` | Publishes this folder as-is (no build command) |

## Deploying

The Netlify project is **sellnin-trade-desk** (`quote.akay.ie`). It is not
connected to this repo — it has always been fed by zip upload — so
[`.github/workflows/deploy-quote.yml`](../.github/workflows/deploy-quote.yml)
does the upload instead:

- **Push a new build into `quote/` on the site branch and it goes live.** The
  workflow runs only when something under `quote/` changed (or from the Actions
  tab, *Run workflow*). It needs one repository secret, `NETLIFY_AUTH_TOKEN`
  (Netlify → User settings → Applications → Personal access tokens); without it
  the run fails loudly rather than pretending to deploy.
- **A pull request that touches `quote/` gets a draft deploy** on a throwaway
  URL, printed in the run summary, so a patched bundle can be clicked through
  before it replaces the live one.

Two ways to do it without the workflow, if you ever need them: drag the
*contents* of this folder (not the folder itself) onto the project's Deploys
tab, or connect the project to this repo with **Base directory `quote`**, no
build command, publish directory `.` — it then reads this folder's
`netlify.toml`. The catalogue's own project (`thunderous-florentine`) keeps
building `dist/` from the repo root and never sees this folder either way.

## What has to be true outside this repo

The bundle is static; everything it does is a call to the API, so two settings
outside Netlify decide whether it works:

1. **API CORS.** Every request goes to `https://api-production-2d3f9.up.railway.app`
   (`/api/config`, `/api/health`, `/api/chat`, `/api/upload-excel`) — a
   different origin, so that service must allow `https://quote.akay.ie`.
   Nothing on the page can work around a missing CORS header.
2. **Turnstile domain.** The widget uses sitekey `0x4AAAAAAExSkDh41lDC1Ves`
   (public by design — it is in the bundle). `quote.akay.ie` must be listed on
   that key in Cloudflare, or verification fails and chat and upload both
   refuse to send. The API's `/api/config` response decides whether the widget
   renders at all (`turnstileEnabled`).

No secrets belong in this folder: it is shipped to the browser in full.
