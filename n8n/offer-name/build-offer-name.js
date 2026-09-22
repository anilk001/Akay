/**
 * Offer Name builder — shared helper inside the "Build Airtable Payload" Code
 * node of all four ingestion workflows (Excel, Email Body, PDF/Image, WhatsApp).
 *
 * This is a FRAGMENT, not a whole node: paste the two functions below over the
 * existing `buildOfferName` in each node. The call sites differ slightly — Excel
 * and PDF/Image pass a supplier name string, Email Body and WhatsApp pass a ctx
 * object — so `buildOfferName` takes the name itself and each node keeps its own
 * call (`buildOfferName(offer, run.supplierName)` vs `(offer, ctx.supplierName)`).
 *
 * The bug this fixes: the old version was
 *
 *     const parts = [offer.brand, offer.productName, offer.variant].filter(Boolean);
 *
 * with no overlap check, so a Product Name that already spells out the brand got
 * it twice, and a Variant echoed by the Product Name got it twice again:
 *
 *     Jameson         + Jameson                      -> "Jameson Jameson 700ml"
 *     Bushmills       + Bushmills Original 40%
 *                     + Original                     -> "Bushmills Bushmills Original 40% Original 1000ml"
 *     Monkey Shoulder + Monkey Shoulder Blended Malt
 *                     + Blended Malt                 -> "Monkey Shoulder Monkey Shoulder Blended Malt Blended Malt 700ml"
 *
 * Offer Name is the primary field in the Offers table, so it is what every
 * internal view, digest and Offers Sent Log row shows. It is not a public field
 * and never reaches the snapshot or akay.ie — the site renders Brand and Product
 * Name separately.
 */

function buildOfferName(offer, supplierName) {
  const parts = dedupeNameParts([offer.brand, offer.productName, offer.variant]);
  const spec = offer.volumeMl ? `${offer.volumeMl}ml` : '';
  const supplier = supplierName ? ` - ${supplierName}` : '';
  return `${parts.join(' ')}${spec ? ' ' + spec : ''}${supplier} ${new Date().toISOString().slice(0, 10)}`.trim();
}

/**
 * Drops any name part another part already spells out, so the brand is not
 * repeated inside the product name and a variant echoed by it is not repeated
 * either. Longer wins ("Jim Beam" + "Jim Beam Apple" keeps the Apple); for two
 * parts that say exactly the same thing, the first one wins. Parts that share no
 * words are all kept, so "Diageo" + "Smirnoff Red" still reads as before.
 */
function dedupeNameParts(parts) {
  const clean = (parts || []).map((p) => String(p ?? '').trim()).filter(Boolean);
  const keys = clean.map(nameKey);
  return clean.filter((part, i) => {
    if (!keys[i]) return false;
    const covered = clean.some((_, j) => {
      if (i === j || !keys[j]) return false;
      if (!` ${keys[j]} `.includes(` ${keys[i]} `)) return false;
      return keys[j].length > keys[i].length || j < i;
    });
    return !covered;
  });
}

/** Word-comparison key: case, punctuation and spacing are not differences. */
function nameKey(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
