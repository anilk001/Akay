// Brand grouping for the durable brand landing pages.
//
// Offer URLs are disposable by nature: across the committed snapshot history,
// 4,690 offer pages have existed and only ~2,540 are live at once, so a page
// earned for "absolut wholesale" is usually dead within days. Brand pages are
// the stable surface for exactly those queries — /brand/absolut/ survives every
// individual offer rotating out, as long as the brand is still stocked.
//
// Shared by the brand route and the sitemap so the two can never disagree about
// which brand pages exist.

// A brand needs at least this many live offers to get its own page. Below it the
// page would be a single link — thin for Google, and it disappears the moment
// that one offer sells out. Those brands are still reachable via their category.
export const MIN_OFFERS_FOR_BRAND_PAGE = 2;

export function brandSlug(brand = '') {
  return String(brand)
    .normalize('NFD')
    // Fold diacritics rather than dropping them: "Nescafé" must slug to
    // "nescafe", not "nescaf", which is what stripping the accented character
    // outright produces.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Apostrophes vanish instead of becoming separators, so "Lay's" is "lays"
    // rather than "lay-s".
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Group offers by brand slug. Brands whose names differ only in punctuation
// ("Lay's" / "Lays") slugify identically and are deliberately merged into one
// page rather than competing for the same query — that is 8 of ~620 brands.
// The display name used is the most common spelling in the catalogue.
export function groupByBrand(offers) {
  const groups = new Map();

  for (const offer of offers) {
    const brand = String(offer.brand || '').trim();
    if (!brand) continue;
    const slug = brandSlug(brand);
    if (!slug) continue;

    if (!groups.has(slug)) groups.set(slug, { slug, names: new Map(), offers: [] });
    const g = groups.get(slug);
    g.names.set(brand, (g.names.get(brand) || 0) + 1);
    g.offers.push(offer);
  }

  return Array.from(groups.values())
    .map((g) => ({
      slug: g.slug,
      // Most frequent spelling wins; ties break alphabetically so the choice is
      // stable across builds rather than depending on Airtable record order.
      name: Array.from(g.names.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
      offers: g.offers,
    }))
    .filter((g) => g.offers.length >= MIN_OFFERS_FOR_BRAND_PAGE)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
