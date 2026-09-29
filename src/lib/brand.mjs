// One spelling per brand.
//
// Supplier sheets disagree on capitalisation, so the catalogue carries "Nivea"
// and "NIVEA", "Dove" and "DOVE" as if they were different brands. That split
// the brand count, gave Nivea two brand pages (nivea-wholesale and
// nivea-wholesale-2) and put two "Nivea" chips in the search filters. A trader
// reading duplicate brands reads an uncleaned feed.
//
// Case variants merge onto the spelling most offers already use; on a tie a
// mixed-case spelling beats an all-caps one ("Nivea" over "NIVEA"), then the
// alphabetically first wins, so the result never depends on row order.
// Only case is folded: "Procter & Gamble" and "P&G" stay separate, because
// deciding those are one company is a judgement, not a normalisation.
//
// Shared by the build (getOffers) and the browser (search.astro), so every
// page and the search facets agree on the same spelling.

const letters = (s) => s.replace(/[^A-Za-z]/g, '');
const isShouting = (s) => { const l = letters(s); return l.length > 1 && l === l.toUpperCase(); };

/** Map of lower-cased brand -> canonical spelling, over any number of offer lists. */
export function brandSpellings(...lists) {
  const counts = new Map(); // key -> Map(spelling -> n)
  for (const list of lists) {
    for (const o of list || []) {
      const b = String(o?.brand ?? '').trim();
      if (!b) continue;
      const k = b.toLowerCase();
      const m = counts.get(k) || new Map();
      m.set(b, (m.get(b) || 0) + 1);
      counts.set(k, m);
    }
  }
  const canon = new Map();
  for (const [k, m] of counts) {
    const best = [...m].sort((a, b) =>
      b[1] - a[1]
      || Number(isShouting(a[0])) - Number(isShouting(b[0]))
      || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
    canon.set(k, best);
  }
  return canon;
}

/** Copy of `offers` with every brand rewritten to its canonical spelling. */
export function withCanonicalBrands(offers, canon = brandSpellings(offers)) {
  return (offers || []).map((o) => {
    const b = String(o?.brand ?? '').trim();
    const c = b ? canon.get(b.toLowerCase()) : null;
    return c && c !== o.brand ? { ...o, brand: c } : o;
  });
}
