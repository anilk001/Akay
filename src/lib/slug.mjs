// URL slugs for offers and categories.
//
// Slug convention (SEO brief §1): brand-product-packsize, lowercase, hyphenated,
// ASCII only — e.g. "Absolut Vodka Original" + "6 x 100cl x 40% alc"
// → absolut-vodka-original-6x100cl. Derived ONLY from public-safe fields
// (Public Product Description + Public Spec); supplier identity never reaches
// a URL. Collisions are de-duped with -2, -3 in encounter order.

export function slugify(s = '') {
  return String(s)
    .normalize('NFKD')                 // Jägermeister → Jagermeister
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[&/]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

// "6 x 100cl x 40% alc" → "6x100cl"; "15 x 75ml" → "15x75ml"; else ''.
export function packFromSpec(spec = '') {
  const m = String(spec).match(/(\d+(?:\s*x\s*\d+)*)\s*x\s*([\d.,]+)\s*(cl|ml|ltr|l|kg|g)\b/i);
  if (!m) return '';
  return `${m[1].replace(/\s*x\s*/gi, 'x')}x${m[2]}${m[3].toLowerCase()}`;
}

// Keep slugs comfortably under filesystem/URL limits — some public
// descriptions are whole assortment lists. Cut at a hyphen boundary.
const MAX_SLUG = 80;
function clamp(slug) {
  if (slug.length <= MAX_SLUG) return slug;
  const cut = slug.slice(0, MAX_SLUG);
  const at = cut.lastIndexOf('-');
  return (at > 40 ? cut.slice(0, at) : cut).replace(/-+$/, '');
}

export function offerSlugBase(offer) {
  const pack = packFromSpec(offer.spec);
  const name = slugify(offer.name);
  if (!pack) return clamp(name);
  const packSlug = slugify(pack);
  // Don't repeat the pack if the product name already carries it verbatim.
  return clamp(name.includes(packSlug) ? name : `${name}-${packSlug}`);
}

// Assign unique slugs to a list of offers (stable within one build).
// Returns a new array of { ...offer, slug }.
export function withSlugs(offers) {
  const seen = new Map();
  return offers.map((o) => {
    const base = offerSlugBase(o) || 'offer';
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return { ...o, slug: n === 1 ? base : `${base}-${n}` };
  });
}

// Category slugs pinned to the brief's URL set; anything new falls back to slugify.
const CATEGORY_SLUGS = {
  'Spirits': 'spirits',
  'Beer': 'beer',
  'Soft Drinks': 'soft-drinks',
  'Grocery': 'grocery',
  'Toiletries': 'toiletries',
  'Confectionery': 'confectionery',
  'Champagne': 'champagne',
  'Other FMCG': 'other-fmcg',
  'Other': 'other',
};

export function categorySlug(category = 'Other') {
  return CATEGORY_SLUGS[category] || slugify(category) || 'other';
}
