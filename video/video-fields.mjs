// The only fields a video may ever draw.
//
// GOLDEN RULE 1 (see CLAUDE.md): getOffers() already requests nothing but the
// FIELDS allowlist in src/data/airtable.mjs; this narrows each row a second time
// to the keys a composition actually renders. Both the render CLI and the
// compositions import this one list, so there is a single place to review when
// someone wants a new field on screen — and no way for the two to drift apart.
//
// Least privilege: a field that no composition draws does not belong here, even
// when it is public-safe.

export const VIDEO_FIELDS = [
  'id', 'name', 'variants', 'brand', 'category', 'spec', 'currency', 'amount',
  'priceDetail', 'priceBasis', 'stock', 'qty', 'terms', 'tier', 'origin',
];

/** Narrow an offer row to the public-safe keys a composition may render. */
export function toVideoOffer(o) {
  return Object.fromEntries(VIDEO_FIELDS.map((k) => [k, o[k] ?? null]));
}
