// The catalogue, resolved once per build.
//
// Before this module, four routes (index, offer, category, sitemap) each
// re-derived offer slugs with their own copy of the same loop, and each one
// called getOffers() independently — four full paginated Airtable fetches per
// build, four chances for the slug rules to drift apart. Brand pages would have
// made that six.
//
// getCatalogue() does it once and hands every route the same resolved view:
// offers with stable slugs, brands grouped through the committed alias map,
// categories, and the freshness metadata the catalogue header prints.

import { getOffers } from '../data/airtable.mjs';
import snapshot from '../data/offers-snapshot.json' with { type: 'json' };
import { generateSlug, dedupeSlug, brandSlug, categorySlug } from './slug.mjs';
import { canonicalBrand } from '../data/brand-aliases.mjs';
import { readRegistry } from './brand-registry.mjs';
import { enquiryLink } from './whatsapp.mjs';

// Astro calls getStaticPaths() once per route, in one process, so a module-level
// promise collapses all of them onto a single Airtable fetch.
let cached = null;

const STOCK_LABEL = {
  in: ['ok', 'In stock'],
  warn: ['warn', 'Limited'],
  enq: ['neu', 'Enquire'],
};

// Splits "EUR 9.24/case (12pk) · EUR 0.77/unit" into the headline basis and the
// remainder, so a card prints the number once with the right label under it.
export function priceParts(detail = '') {
  const parts = String(detail).split('·').map((s) => s.trim());
  const first = parts[0] || '';
  const basis = /\/\s*bottle/i.test(first) ? '/ btl'
    : /\/\s*case/i.test(first) ? '/ case'
    : /\/\s*unit/i.test(first) ? '/ unit' : '';
  const msg = basis === '/ btl' ? 'per bottle'
    : basis === '/ case' ? 'per case'
    : basis === '/ unit' ? 'per unit' : '';
  return { basis, other: parts.slice(1).join(' · '), msg };
}

// The single price string the RFQ payload and the XLSX both quote, so a buyer's
// enquiry says exactly what the page said.
export function priceDisplay(offer) {
  if (offer.amount == null) return 'on request';
  const { basis } = priceParts(offer.priceDetail);
  return `${offer.currency} ${offer.amount.toFixed(2)}${basis ? ` ${basis.replace('/ ', '/ ')}` : ''}`.trim();
}

function toView(offer, slug) {
  const { basis, other, msg } = priceParts(offer.priceDetail);
  const brand = canonicalBrand(offer.brand);
  return {
    ...offer,
    slug,
    url: `/offers/${slug}/`,
    brand,
    brandSlug: brand ? brandSlug(brand) : '',
    categorySlug: categorySlug(offer.category),
    basis,
    other,
    st: STOCK_LABEL[offer.stock] || STOCK_LABEL.enq,
    wa: enquiryLink(offer, msg),
    priceLabel: priceDisplay(offer),
    logistics: logisticsRows(offer),
  };
}

// §5 — the logistics fields are near-empty across the live base today (CBM and
// HS Code are at 0%). Rows are built from whatever is actually populated and
// the caller collapses the whole block when the list comes back empty, so the
// UI ships dark and lights up per-offer as the backfill lands.
export function logisticsRows(offer) {
  const rows = [
    ['MOQ', offer.moq],
    ['Lead time', offer.leadTime],
    ['Cases / pallet', offer.casesPerPallet],
    ['Pieces / pallet', offer.piecesPerPallet],
    ['Full truckload', offer.fullTruckload],
    ['Weight', offer.weightKg ? `${offer.weightKg} kg` : ''],
    ['CBM', offer.cbm],
    ['HS code', offer.hsCode],
    ['Best before', offer.bbd],
    ['EAN (unit)', offer.eanUnit],
    ['EAN (case)', offer.eanCase],
  ];
  return rows
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([label, value]) => ({ label, value: String(value).trim() }));
}

// Every brand slug the site has ever published: the committed append-only
// registry, unioned with whatever the current snapshot carries.
//
// The registry is the load-bearing half. Netlify builds without an Airtable
// token, so the snapshot is always identical to the "live" data on a production
// build — comparing those two alone would never find a brand that had gone.
// The snapshot is unioned in anyway so a brand added since the last
// `sync-offers` still resolves, and so a missing registry degrades to the old
// behaviour rather than breaking the build.
function knownBrandNames() {
  const names = new Map(); // slug -> canonical name
  for (const [slug, name] of Object.entries(readRegistry())) {
    if (slug && name) names.set(slug, name);
  }
  for (const o of snapshot.offers) {
    const brand = canonicalBrand(o.brand);
    if (!brand) continue;
    const slug = brandSlug(brand);
    if (slug && !names.has(slug)) names.set(slug, brand);
  }
  return names;
}

function groupBrands(offers) {
  const bySlug = new Map();
  // Tracks which raw Airtable spellings landed on each slug, so an unintended
  // merge is reported rather than absorbed.
  const rawBySlug = new Map();

  for (const o of offers) {
    if (!o.brandSlug) continue;
    if (!bySlug.has(o.brandSlug)) {
      bySlug.set(o.brandSlug, { name: o.brand, slug: o.brandSlug, offers: [] });
    }
    bySlug.get(o.brandSlug).offers.push(o);
    if (!rawBySlug.has(o.brandSlug)) rawBySlug.set(o.brandSlug, new Set());
    rawBySlug.get(o.brandSlug).add(o.brand);
  }

  // Two DIFFERENT canonical names sharing a slug means the alias map is missing
  // a pair. Warn loudly — the brief's rule is that brands are never merged
  // silently. The pages still build (a warning must not take the site down),
  // but the log names the exact pair to add to src/data/brand-aliases.mjs.
  for (const [slug, raws] of rawBySlug) {
    if (raws.size > 1) {
      console.warn(
        `[catalogue] unlisted brand collision on /brand/${slug}/: ${[...raws]
          .map((r) => JSON.stringify(r))
          .join(' + ')} — add the pair to src/data/brand-aliases.mjs to make the merge explicit`
      );
    }
  }

  return bySlug;
}

export async function getCatalogue() {
  if (cached) return cached;
  cached = (async () => {
    const { offers: raw, source } = await getOffers();

    // Offer slugs stay on the existing rule and the existing order, so the
    // ~2,900 URLs already indexed do not move.
    const taken = [];
    const offers = raw.map((o) => {
      const slug = dedupeSlug(generateSlug(o.name, o.spec), taken);
      taken.push(slug);
      return toView(o, slug);
    });

    const brandMap = groupBrands(offers);

    // A brand page that lost its last line still renders, flagged noindex.
    const retired = [];
    for (const [slug, name] of knownBrandNames()) {
      if (!brandMap.has(slug)) retired.push({ name, slug, offers: [] });
    }

    const brands = [...brandMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (retired.length) {
      console.log(`[catalogue] ${retired.length} brand page(s) have no live line — rendering noindex`);
    }

    const catMap = new Map();
    for (const o of offers) {
      if (!catMap.has(o.categorySlug)) {
        catMap.set(o.categorySlug, { name: o.category, slug: o.categorySlug, offers: [] });
      }
      catMap.get(o.categorySlug).offers.push(o);
    }
    const categories = [...catMap.values()].sort((a, b) => b.offers.length - a.offers.length);

    // Build timestamp, printed as the catalogue's freshness stamp (§4). When the
    // snapshot is serving, the honest date is when the snapshot was baked, not
    // when Netlify happened to rebuild.
    const generatedAt = source === 'snapshot' && snapshot.generated
      ? new Date(snapshot.generated)
      : new Date();

    return {
      offers,
      brands,
      retiredBrands: retired.sort((a, b) => a.name.localeCompare(b.name)),
      categories,
      source,
      generatedAt,
      stats: {
        offers: offers.length,
        brands: brands.length,
        categories: categories.length,
        currencies: [...new Set(offers.map((o) => o.currency).filter(Boolean))].sort(),
      },
    };
  })();
  return cached;
}

// Featured lines float to the front; everything else keeps catalogue order.
export function featuredFirst(offers) {
  return [...offers].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
}
