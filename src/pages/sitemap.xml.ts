import { getOffers } from '../data/airtable.mjs';
import { withSlugs, categorySlug } from '../lib/slug.mjs';
import { guides } from '../data/guides.mjs';
import { SITE_URL } from '../lib/site.mjs';

export const prerender = true;

type Entry = { path: string; changefreq: string; priority: string };

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function GET() {
  const { offers } = await getOffers();
  const offersWithSlugs = withSlugs(offers);
  const categories = Array.from(new Set(offersWithSlugs.map((o) => o.category).filter(Boolean))).sort();

  // The whole site is rebuilt from the Airtable snapshot, so every URL's
  // lastmod is the build date — no page is older than the build that made it.
  const lastmod = new Date().toISOString().split('T')[0];

  const entries: Entry[] = [
    { path: '/', changefreq: 'daily', priority: '1.0' },
    ...categories.map((category) => ({
      path: `/category/${categorySlug(category)}/`,
      changefreq: 'daily',
      priority: '0.9',
    })),
    // Canonical URLs only. Listing a page whose canonical points elsewhere
    // just asks Google to crawl a URL it has been told to ignore.
    ...Array.from(new Set(offersWithSlugs.map((o) => o.canonicalSlug || o.slug))).map((slug) => ({
      path: `/offers/${slug}/`,
      changefreq: 'daily',
      priority: '0.8',
    })),
    { path: '/guides/', changefreq: 'weekly', priority: '0.7' },
    ...guides.map((guide) => ({
      path: `/guides/${guide.slug}/`,
      changefreq: 'monthly',
      priority: '0.7',
    })),
    { path: '/about/', changefreq: 'monthly', priority: '0.6' },
  ];

  const urls = entries
    .map(
      (entry) => `  <url>
    <loc>${xmlEscape(`${SITE_URL}${entry.path}`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`
    )
    .join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Netlify caches the built file; a short TTL keeps a fresh catalogue
      // visible to crawlers within minutes of the 5-minute refresh commit.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
