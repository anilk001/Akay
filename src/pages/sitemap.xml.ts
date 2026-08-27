import { getOffers } from '../data/airtable.mjs';
import { generateSlug, dedupeSlug } from '../lib/slug.mjs';
import { guides } from '../data/guides.mjs';
import { groupByBrand } from '../lib/brand.mjs';

export const prerender = true;

export async function GET() {
  const { offers } = await getOffers();

  // Build slug map
  const slugMap = new Map();
  const slugs = [];
  const offersWithSlugs = [];

  for (const offer of offers) {
    let slug = generateSlug(offer.name, offer.spec);
    slug = dedupeSlug(slug, slugs);
    slugs.push(slug);
    const offerWithSlug = { ...offer, slug };
    slugMap.set(offer.id || `${offer.brand}-${offer.name}`, offerWithSlug);
    offersWithSlugs.push(offerWithSlug);
  }

  // Get unique categories
  const categories = Array.from(new Set(offersWithSlugs.map((o) => o.category))).sort();

  // Build sitemap
  const now = new Date().toISOString().split('T')[0];

  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

  // Homepage
  sitemap += `  <url>
    <loc>https://offers.akay.ie/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
`;

  // Offer pages
  for (const offer of offersWithSlugs) {
    sitemap += `  <url>
    <loc>https://offers.akay.ie/offers/${offer.slug}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
`;
  }

  // Category pages
  for (const category of categories) {
    const categorySlug = category.toLowerCase().replace(/\s+/g, '-');
    sitemap += `  <url>
    <loc>https://offers.akay.ie/category/${categorySlug}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
`;
  }

  // Brand pages — the durable surface for "<brand> wholesale" queries, so they
  // rank above the offer pages, which churn out of the catalogue within days.
  for (const group of groupByBrand(offersWithSlugs)) {
    sitemap += `  <url>
    <loc>https://offers.akay.ie/brand/${group.slug}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
`;
  }

  // Guide pages
  for (const guide of guides) {
    sitemap += `  <url>
    <loc>https://offers.akay.ie/guides/${guide.slug}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
`;
  }

  // About page
  sitemap += `  <url>
    <loc>https://offers.akay.ie/about/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`;

  sitemap += `</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
    },
  });
}
