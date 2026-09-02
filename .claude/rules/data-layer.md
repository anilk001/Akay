---
paths:
  - "src/data/**"
  - "src/lib/**"
---

# Rules for the data layer (`src/data`, `src/lib`)

You are editing the code that turns Airtable rows into offer objects, or the shared
helpers every page imports. Mistakes here reach ~4,000 pages at once.

- `FIELDS` in `airtable.mjs` is a security boundary. Add a field only if it is
  public-safe (see `docs/DATA-RULES.md`). Never add supplier, cost, margin or notes.
- `amount` and `priceBasis` must come from the **same** parsed price part. Don't read
  the headline from `Price Display` and the basis from `Price Per Unit & Case`.
- Any change to `normalize()` must be mirrored in `renormalizeSnapshotOffer()` if it
  affects derived fields, so live and snapshot builds render identically.
- `amount` can be `null`; `spec`, `brand`, `terms`, `tier`, `origin` can be `''`.
  Every consumer must cope. Don't "fix" this by inventing placeholder values.
- Do not add another `getOffers()` caller or a second Airtable query. One fetch path,
  one fallback path. (Memoising `getOffers()` is welcome.)
- Keep `fetchWithRetry` semantics: retry 429/5xx/network only; never retry 401/403/422.
- `whatsapp.mjs` is the only place that knows the WhatsApp number or message shape.
- `slug.mjs`: slugs are URLs. Changing `generateSlug` changes every offer URL and
  breaks inbound links and the sitemap. Don't touch it without saying so in the
  commit body.
- Never hand-edit `offers-snapshot.json`. If your change needs new snapshot content,
  say so; the bot regenerates it after merge.
- Verify with `npm run build` plus the price/WhatsApp smoke checks in
  `docs/WORKFLOW.md`, and paste the numbers into the commit body.
