// Single source of truth for what /search-index.json may contain.
// Used by the endpoint (src/pages/search-index.json.ts) to emit rows and by
// scripts/check-public-safety.mjs to reject anything else after the build.
//
// Kept deliberately lean: `terms` is always "<incoterm> <warehouse>", so it
// does not ship.
// `slug` is only written when it differs from generateSlug(name, spec), i.e.
// for the handful of de-duplicated collisions — the client regenerates the rest.
export const PUBLIC_KEYS = [
  'id', 'slug', 'name', 'variants', 'brand', 'category', 'spec',
  'currency', 'amount', 'unitAmount', 'priceDetail',
  // `priceBasis` is the basis of `amount` ("case" / "unit" / "bottle" / …),
  // taken from the same price part that supplied `amount`. The browser parses
  // it back out of priceDetail, but the Trade Desk API reads this file as its
  // ONLY price source and needs the basis as structured data: without it, a
  // per-pack price gets divided by the pack size a second time. Shipping the
  // field is cheaper and safer than a second copy of the parser server-side.
  'priceBasis',
  // Barcodes, for matching a buyer's uploaded list to a SKU.
  'ean', 'eanCase',
  'stock', 'qty', 'tier', 'origin', 'featured',
  'volumeMl', 'pack', 'unitType', 'warehouse', 'incoterm',
  'moq', 'leadTime', 'bbd', 'note', 'offerDate', 'expiryDate',
  // Structured trade terms. `moqLabel` / `leadLabel` are the worded values the
  // result rows print; the buckets drive the facets. `moqEstimated` is what
  // lets a row say "typically 100 cases" instead of stating a minimum the
  // supplier never gave.
  //
  // `moqSource` is deliberately ABSENT: it is read at build time to compute
  // moqEstimated and must not reach the browser. isForbiddenField() would
  // reject the key anyway, which is the guard working as intended.
  'moqLabel', 'moqEstimated', 'moqBucket', 'leadLabel', 'leadBucket',
  'moqType', 'leadTimeDays', 'mixedLoad',
];
