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

// ---------------------------------------------------------------------------
// Aggregation-page slugs (brands, categories).
//
// Deliberately NOT generateSlug(): that rule strips accents to nothing
// ("Nescafé" -> "nescaf") and is already baked into ~2,900 indexed offer URLs,
// so it must not change. Brand and category routes are new, so they get the
// rule the brief specifies — lowercase, & -> and, punctuation stripped, spaces
// -> hyphens — with accents transliterated rather than deleted.
// ---------------------------------------------------------------------------

// "Moët" -> "Moet", "Nescafé" -> "Nescafe". NFD splits a letter from its
// diacritic; the range strips the combining marks and leaves the base letter.
export function deaccent(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function brandSlug(name) {
  return deaccent(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’ʼ]/g, '') // apostrophes vanish: Dewar's -> dewars
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Category slugs are already live at /category/<slug>/ under this exact rule.
// Kept byte-identical so existing URLs and inbound links survive.
export function categorySlug(name) {
  return String(name).toLowerCase().replace(/\s+/g, '-');
}
