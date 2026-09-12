// Single source of truth for what /search-index.json may contain.
// Used by the endpoint (src/pages/search-index.json.ts) to emit rows and by
// scripts/check-public-safety.mjs to reject anything else after the build.
//
// Kept deliberately lean: `terms` is always "<incoterm> <warehouse>" and the
// price basis is parsed from priceDetail in the browser, so neither ships.
// `slug` is only written when it differs from generateSlug(name, spec), i.e.
// for the handful of de-duplicated collisions — the client regenerates the rest.
export const PUBLIC_KEYS = [
  'id', 'slug', 'name', 'variants', 'brand', 'category', 'spec',
  'currency', 'amount', 'unitAmount', 'priceDetail',
  'stock', 'qty', 'tier', 'origin', 'featured',
  'volumeMl', 'pack', 'unitType', 'warehouse', 'incoterm',
  'moq', 'leadTime', 'bbd', 'note', 'offerDate', 'expiryDate',
];
