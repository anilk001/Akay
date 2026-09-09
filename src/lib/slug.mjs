// Generate URL-safe slugs from product names
export function generateSlug(name, spec = '') {
  // Combine name and spec for the slug
  const combined = `${name} ${spec}`.trim();

  // Convert to lowercase and remove non-ASCII
  let slug = combined
    .toLowerCase()
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

// Handle slug collisions by appending -2, -3, etc
export function dedupeSlug(slug, allSlugs) {
  if (!allSlugs.includes(slug)) return slug;

  let counter = 2;
  while (allSlugs.includes(`${slug}-${counter}`)) {
    counter++;
  }
  return `${slug}-${counter}`;
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
export function withSlugs(offers) {
  const seen = [];
  const withSlug = offers.map((offer) => {
    const slug = dedupeSlug(generateSlug(offer.name, offer.spec), seen);
    seen.push(slug);
    return { ...offer, slug };
  });

  // Group by the pre-dedupe slug: that is exactly "same name and pack size".
  const groups = new Map();
  for (const offer of withSlug) {
    const key = generateSlug(offer.name, offer.spec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }

  // The representative is the row a buyer would rather land on: in stock
  // first, then the deepest stock, then the keenest price.
  const STOCK_RANK = { in: 0, warn: 1 };
  const rank = (o) => [
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
