# quote.akay.ie — the Trade Desk front end

Mirror of the changes applied to the buyer-facing tool at **quote.akay.ie**, in
the same spirit as `n8n/`: the code runs somewhere else, this folder is the
record of what it is and how it was changed.

## What it is

A React/Vite single-page app on Netlify (project `sellnin-trade-desk`, primary
URL `https://quote.akay.ie`). Two tabs, selected by URL hash:

- `#chat` — ask about AKAY offers and prices
- `#excel` — upload a buying list and get it back priced

akay.ie links buyers straight to it: the homepage Instant Quote button, the
category pages, `about`, `llms.txt` and several guides all point here.

## Where the logic actually lives

The page is a shell. Everything of substance happens in a service at
`https://api-production-2d3f9.up.railway.app`:

| Endpoint | Method | Payload | Notes |
| --- | --- | --- | --- |
| `/api/config` | GET | — | `turnstileEnabled`, catalogue age (the "Catalog 25m old" badge) |
| `/api/health` | GET | — | catalogue loaded / last error |
| `/api/chat` | POST | `{message, history, turnstileToken}` | streams `delta` / `done` / `error`; `done` carries `text`, `queries`, `sources`, `grounded` |
| `/api/upload-excel` | POST | multipart `file` + `turnstileToken` | `.xlsx/.xls/.csv`, 8 MB cap |

Cloudflare Turnstile guards both write endpoints. Rate limits are the
service's: 10 chat messages and 3 uploads per hour.

**Two things are still open, and neither can be fixed in the page:**

1. `/api/chat` runs a live web search — that is what `queries`, `sources` and
   `grounded` in the `done` event are. A buyer can still ask it anything at all.
   Restricting it to AKAY offers, products and the company is a change to that
   service's system prompt and tool config.
2. `/api/upload-excel` matches against Airtable directly. It should read
   `https://akay.ie/search-index.json` instead — the index this repo already
   publishes, filtered to `PUBLIC_KEYS` (`src/lib/search-index-keys.mjs`) and
   re-validated by `scripts/check-public-safety.mjs` on every build. A service
   with no Airtable token cannot leak supplier identity, buy prices, margins or
   internal notes no matter how a prompt behaves.

## Why there is a patch script and not a source tree

The app was built by Claude and pushed to Netlify as a finished bundle
(`deploy_source: api`, no repo, no branch, no commit). The source was never
committed anywhere and is gone; what is published is `index.html` plus a
minified `assets/index-*.js` and `assets/index-*.css`.

`patch-bundle.py` therefore edits display strings in the built bundle. It only
touches literal text and one element tag, never logic, class names or API
calls, and it refuses to write anything unless every replacement matches
exactly once — so it fails loudly against an unexpected bundle instead of
corrupting it.

```bash
python3 quote-desk/patch-bundle.py in.js out.js
node --check out.mjs        # copy to .mjs first; must parse as an ES module
```

The patched file is deployed under a **new** filename. The original name is
content-hashed and served `immutable`, so reusing it would leave returning
buyers on the old cached bundle.

If the app is ever rebuilt properly, it belongs in a real source tree and the
Netlify project should be linked to git — then this folder can go.
