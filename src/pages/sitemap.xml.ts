import { getOffers } from '../data/airtable.mjs';
import { offersWithSlugs, brandPages, categorySlug } from '../lib/slug.mjs';
import { guides } from '../data/guides.mjs';

export const prerender = true;

export async function GET() {
  const { offers } = await getOffers();
  const offersWithSlugsList = offersWithSlugs(offers);

  const categories = Array.from(new Set(offersWithSlugsList.map((o) => o.category))).sort();
  const brands = brandPages(offersWithSlugsList);

  const now = new Date().toISOString().split('T')[0];
  const url = (loc: string, changefreq: string, priority: string) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>
`;

  let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

  sitemap += url('https://offers.akay.ie/', 'daily', '1.0');

  for (const category of categories) {
    sitemap += url(`https://offers.akay.ie/category/${categorySlug(category)}/`, 'daily', '0.9');
  }

  sitemap += url('https://offers.akay.ie/brands/', 'daily', '0.8');
  for (const brand of brands) {
    sitemap += url(`https://offers.akay.ie/brands/${brand.slug}/`, 'daily', '0.7');
  }

  for (const offer of offersWithSlugsList) {
    sitemap += url(`https://offers.akay.ie/offers/${offer.slug}/`, 'daily', '0.8');
  }

  for (const guide of guides) {
    sitemap += url(`https://offers.akay.ie/guides/${guide.slug}/`, 'weekly', '0.7');
  }

  sitemap += url('https://offers.akay.ie/about/', 'monthly', '0.6');

  sitemap += `</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
    },
  });
}
