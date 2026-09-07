# Akay offers catalogue - working rules

Akay Irl Ltd (Ireland) buys and resells branded FMCG goods in bulk. This repo
is the static offers.akay.ie catalogue that reads from the `Akay Offers`
Airtable base (`appaDSdZkAE9PGkjT`). Skills for the common jobs live in
`.claude/skills/` (price-list-intake, offer-data-validator, offers-catalogue).

## Airtable hard rules

- **Never tick `Listing Approved`** on the Offers table. It is a human-only
  gate that publishes an offer to the public site. Create and update offers
  with it blank; Anil ticks it by hand after review. If you find it ticked on
  records you created, untick it and report it.
- Never expose supplier identity, buy prices, margins or internal notes to the
  public site. Only fields in the `FIELDS` allowlist in `src/data/airtable.mjs`
  are fetched at build time.
- Run the offer-data-validator skill on a converted price list before creating
  records. Nothing is dropped silently: unpriceable rows go in the report.

## Supplier upload conventions (from the GG Concept loads)

- Offer Name: `<supplier item name> - <Supplier> <YYYY-MM-DD>`.
- Product Name is the clean line, Variant carries the flavour or scent, so
  `Public Product Description` renders as `Line — Variant`.
- Link the `Supplier` record, set `Source Sheet` to the file name, and put the
  supplier SKU, packing string and unit/case price in `Notes`.
- Prefer `Per Case` pricing when the sheet quotes case prices: `Sell Price`
  rounds to 2 dp, so per-piece pricing distorts large packs (sachets).
