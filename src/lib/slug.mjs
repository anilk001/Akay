// Letters NFKD does not decompose into a base letter plus accent.
const TRANSLITERATE = { ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

// Fold accented letters to their ASCII base ("Moët" -> "moet",
// "L'Oréal" -> "l'oreal") so the URL keeps the letter instead of losing it.
// Until 2026-09-29 slugs simply dropped every non-ASCII letter, which gave
// URLs like /brands/loral-paris-wholesale/ and /brands/dom-prignon-wholesale/.
// legacySlug() keeps that old rule so the redirect map can send those URLs
// to their corrected form.
export function foldAccents(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ßøæœłđðþı]/g, (ch) => TRANSLITERATE[ch] || ch);
}

function slugify(text, fold) {
  let slug = (fold ? foldAccents(text) : String(text).toLowerCase())
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ''); // Trim hyphens

  // Truncate to 90 chars to avoid filesystem path length limits
  // (255 - /offers/ - /index.html - some buffer = ~90)
  if (slug.length > 90) {
    slug = slug.substring(0, 90).replace(/-+$/, '');
  }

  return slug;
}

// Generate URL-safe slugs from product names
export function generateSlug(name, spec = '') {
  return slugify(`${name} ${spec}`.trim(), true);
}

// The pre-2026-09-29 rule (accented letters dropped). Used only to work out
// which old URLs need a 301 to their corrected slug.
export function legacySlug(name, spec = '') {
  return slugify(`${name} ${spec}`.trim(), false);
}

// Handle slug collisions by appending -2, -3, etc
export function dedupeSlug(slug, allSlugs) {
  if (!allSlugs.includes(slug)) return slug;

  let counter = 2;
  while (allSlugs.includes(`${slug}-${counter}`)) {
    counter++;
  }
  return `${slug}-${counter}`;
}

// Brand landing pages: one per brand carrying at least `minOffers` live offers
// (single-offer brands would be thin doorway pages). Slugs take a "-wholesale"
// suffix — the search term the pages target.
//
// Airtable spells some brands several ways ("Dove" / "DOVE", "Jack Daniel's" /
// "Jack Daniels", "Moët & Chandon" / "Moet & Chandon"). Spellings that reduce to
// the same slug are one brand and get one page; before 2026-09-29 each spelling
// got its own page and the later ones a "-2" suffix. The page is named with the
// best spelling (not all capitals, then the most used, then the accented one),
// and `variants` lists every spelling so offer pages can link to it.
export function brandPages(offers, minOffers = 2) {
  const byKey = new Map();
  for (const offer of offers) {
    const brand = (offer.brand || '').trim();
    if (!brand) continue;
    const key = generateSlug(brand);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, { offers: [], counts: new Map() });
    const entry = byKey.get(key);
    entry.offers.push(offer);
    entry.counts.set(brand, (entry.counts.get(brand) || 0) + 1);
  }
  const pages = [];
  for (const [key, { offers: brandOffers, counts }] of byKey) {
    if (brandOffers.length < minOffers) continue;
    const variants = [...counts.keys()];
    pages.push({ brand: displayBrand(counts), slug: `${key}-wholesale`, offers: brandOffers, variants });
  }
  return pages.sort((a, b) => a.brand.localeCompare(b.brand));
}

function displayBrand(counts) {
  const isShouting = (b) => /[A-Z]{2}/.test(b) && b === b.toUpperCase() && b.length > 3;
  return [...counts.entries()].sort(([a, ca], [b, cb]) =>
    (isShouting(a) - isShouting(b))
    || (cb - ca)
    || (/[^\x00-\x7F]/.test(b) - /[^\x00-\x7F]/.test(a))
    || a.localeCompare(b))[0][0];
}

// The brand-page URLs the site published before 2026-09-29, one per raw
// spelling, deduped with -2/-3 in alphabetical order exactly as the old code
// did. Only the redirect map uses this.
export function legacyBrandSlugs(offers, minOffers = 2) {
  const byBrand = new Map();
  for (const offer of offers) {
    const brand = (offer.brand || '').trim();
    if (!brand) continue;
    byBrand.set(brand, (byBrand.get(brand) || 0) + 1);
  }
  const slugs = [];
  const out = [];
  for (const brand of [...byBrand.keys()].sort((a, b) => a.localeCompare(b))) {
    if (byBrand.get(brand) < minOffers) continue;
    const base = legacySlug(brand);
    if (!base) continue;
    const slug = dedupeSlug(`${base}-wholesale`, slugs);
    slugs.push(slug);
    out.push({ brand, slug });
  }
  return out;
}

// Build a map of offer ID -> slug for routing
export function buildSlugMap(offers) {
  const slugs = [];
  const map = new Map();

  for (const offer of offers) {
    let slug = generateSlug(offer.name, offer.spec);
    slug = dedupeSlug(slug, slugs);
    slugs.push(slug);
    map.set(offer.id || `${offer.brand}-${offer.name}`, slug);
  }

  return map;
}

// Reverse map: slug -> offer
export function buildOfferBySlug(offers, slugMap) {
  const map = new Map();
  for (const offer of offers) {
    const key = offer.id || `${offer.brand}-${offer.name}`;
    const slug = slugMap.get(key);
    if (slug) {
      map.set(slug, { ...offer, slug });
    }
  }
  return map;
}

// Attach a stable `slug` to every offer, in catalogue order.
// Every page that links to /offers/<slug>/ must derive slugs the same way,
// or the links point at pages the build never generated. This is the one
// place that ordering lives — getStaticPaths, the sitemap and the homepage
// all call it so a dedupe suffix (-2, -3) can never drift between them.
//
// It also marks each offer's `canonicalSlug`. Airtable carries the same
// product as several rows (different lot, supplier or stock position), which
// generates near-identical pages differing only in a case count. Pointing
// them all at one representative URL keeps the pages working for anyone
// holding a direct link while giving search engines a single page per
// product instead of two or three competing ones.
// (The search index and the page routes both call this; it replaced a second,
// slug-only copy of withSlugs() that the search work added in parallel.)
export function withSlugs(offers, slugFn = generateSlug) {
  const seen = [];
  const withSlug = offers.map((offer) => {
    const slug = dedupeSlug(slugFn(offer.name, offer.spec), seen);
    seen.push(slug);
    return { ...offer, slug };
  });

  // Group by the pre-dedupe slug: that is exactly "same name and pack size".
  const groups = new Map();
  for (const offer of withSlug) {
    const key = slugFn(offer.name, offer.spec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }

  // The representative is the row a buyer would rather land on: in stock
  // first, then the deepest stock, then the keenest price.
  const STOCK_RANK = { in: 0, warn: 1 };
  // Delisted (sold-out archive) rows rank below every live row: their stock
  // fields are frozen from before the sale, so they must never win the
  // canonical over a live listing of the same product.
  const rank = (o) => [
    o.delisted ? 1 : 0,
    STOCK_RANK[o.stock] ?? 2,
    -(o.qty ?? 0),
    o.amount ?? Number.POSITIVE_INFINITY,
  ];

  const canonicalOf = new Map();
  for (const [, group] of groups) {
    const best = [...group].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      for (let i = 0; i < ra.length; i += 1) {
        if (ra[i] !== rb[i]) return ra[i] - rb[i];
      }
      return 0;
    })[0];
    for (const offer of group) canonicalOf.set(offer.slug, best.slug);
  }

  return withSlug.map((offer) => ({
    ...offer,
    canonicalSlug: canonicalOf.get(offer.slug) || offer.slug,
  }));
}

// Category name -> URL segment used by /category/<slug>/.
export function categorySlug(category = '') {
  return category.toLowerCase().trim().replace(/\s+/g, '-');
}
