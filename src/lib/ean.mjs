// Barcode lookup for the search box.
//
// Traders identify stock by EAN, so pasting one barcode, or several, into
// search should land on exactly those SKUs. Barcodes are deliberately kept
// OUT of the fuzzy text index: one digit off is a different product, and the
// engine's typo tolerance would happily "correct" it to a neighbour.
//
// Leading zeros are dropped before comparing, so a 12-digit UPC matches the
// same code stored as a 13-digit EAN ("0012345678905" === "12345678905").

const CODE = /^\d{8,14}$/;

/** Comparable form of a stored barcode, or '' if it is not one. */
export function eanKey(value) {
  const s = String(value ?? '').replace(/\s+/g, '');
  return CODE.test(s) ? s.replace(/^0+/, '') : '';
}

/**
 * When a query is nothing but barcodes (separated by spaces, commas,
 * semicolons or new lines), the set of their keys; otherwise null so the
 * caller runs the normal text search.
 */
export function eanQuery(q) {
  const parts = String(q ?? '').split(/[\s,;]+/).filter(Boolean);
  if (!parts.length || !parts.every((p) => CODE.test(p))) return null;
  return new Set(parts.map(eanKey));
}

/** True when the offer's unit or case barcode is in `keys`. */
export function matchesEan(offer, keys) {
  const u = eanKey(offer?.ean);
  const c = eanKey(offer?.eanCase);
  return (u !== '' && keys.has(u)) || (c !== '' && keys.has(c));
}
