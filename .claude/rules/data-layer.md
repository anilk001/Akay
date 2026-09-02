---
paths:
  - "src/data/**"
  - "src/lib/fetch-offers.mjs"
---

# Data layer rules (src/data, sync-offers)

You are editing the only code that talks to Airtable. Full rules in
`docs/DATA-RULES.md`; the ones you must not break:

- `FIELDS` in `airtable.mjs` is an allowlist of public-safe fields. Do not add
  supplier identity, buy prices, margins, notes, or counterparty contacts. Say
  why in the commit body when you add anything.
- `amount` and `priceBasis` must come from the same part of the price string.
  Never pair an amount from `Price Display` with a basis from
  `Price Per Unit & Case`.
- Any correction added to `normalize()` must also be added to
  `renormalizeSnapshotOffer()`. Production builds from the snapshot.
- `getOffers()` must never throw. No token or a failed fetch falls back to the
  snapshot with a `[airtable]` warning.
- `fetch-offers.mjs` must keep refusing to overwrite the snapshot unless
  `source === 'live'`.
- Retry 429, 5xx and network errors only. Do not retry 401, 403, 422.
- `offers-snapshot.json` is machine-written by the refresh Action every 5
  minutes. Do not hand-edit it. Regenerate with `npm run sync-offers`.
- `guides.mjs` is content. Keep the `slug` values stable; they are public URLs
  listed in `llms.txt` and the sitemap.

After a change: `npm run build`, confirm the page count is unchanged unless you
expected it to move, and quote before/after figures against the snapshot in the
commit body when offer numbers change.
