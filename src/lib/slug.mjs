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

// Attach a deduped slug to every offer. Slugs depend on the order offers are
// processed (collisions get -2, -3 …), so every consumer — offer pages,
// category pages, brand pages, the sitemap — must derive them through this one
// function over the same getOffers() list, or links and canonicals drift apart.
export function offersWithSlugs(offers) {
  const slugs = [];
  return offers.map((offer) => {
    let slug = generateSlug(offer.name, offer.spec);
    slug = dedupeSlug(slug, slugs);
    slugs.push(slug);
    return { ...offer, slug };
  });
}

export function categorySlug(category) {
  return String(category).toLowerCase().replace(/\s+/g, '-');
}

// Brand landing pages: one per brand carrying at least `minOffers` live offers
// (single-offer brands would be thin doorway pages). Slugs take a "-wholesale"
// suffix — the search term the pages target — and are deduped in alphabetical
// brand order so every caller derives identical URLs.
export function brandPages(offers, minOffers = 2) {
  const byBrand = new Map();
  for (const offer of offers) {
    const brand = (offer.brand || '').trim();
    if (!brand) continue;
    if (!byBrand.has(brand)) byBrand.set(brand, []);
    byBrand.get(brand).push(offer);
  }
  const slugs = [];
  const pages = [];
  for (const brand of [...byBrand.keys()].sort((a, b) => a.localeCompare(b))) {
    const brandOffers = byBrand.get(brand);
    if (brandOffers.length < minOffers) continue;
    const base = generateSlug(brand);
    if (!base) continue;
    const slug = dedupeSlug(`${base}-wholesale`, slugs);
    slugs.push(slug);
    pages.push({ brand, slug, offers: brandOffers });
  }
  return pages;
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
