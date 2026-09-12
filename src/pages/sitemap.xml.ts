import { getOffers } from '../data/airtable.mjs';
import { withSlugs, categorySlug, brandPages } from '../lib/slug.mjs';
import { guides } from '../data/guides.mjs';
import { SITE_URL } from '../lib/site.mjs';

export const prerender = true;

type Entry = { path: string; changefreq: string; priority: string };

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function delistedCanonicalSlugs(all: { slug: string; canonicalSlug?: string; delisted?: boolean }[]) {
  return all
    .filter((o) => o.delisted && (o.canonicalSlug || o.slug) === o.slug)
    .map((o) => o.slug);
}

export async function GET() {
  const { offers, delisted } = await getOffers();
  // Same combined list, same order, as offers/[slug].astro — live first — or
  // the dedupe suffixes drift and the sitemap points at pages that don't exist.
  const offersWithSlugs = withSlugs([...offers, ...delisted]);
  const liveOffers = offersWithSlugs.filter((o) => !o.delisted);
  // Category and brand pages are built from live stock only.
  const categories = Array.from(new Set(liveOffers.map((o) => o.category).filter(Boolean))).sort();
  const brands = brandPages(liveOffers);

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
    { path: '/brands/', changefreq: 'daily', priority: '0.8' },
    ...brands.map((brand) => ({
      path: `/brands/${brand.slug}/`,
      changefreq: 'daily',
      priority: '0.7',
    })),
    // Canonical URLs only. Listing a page whose canonical points elsewhere
    // just asks Google to crawl a URL it has been told to ignore.
    ...Array.from(new Set(liveOffers.map((o) => o.canonicalSlug || o.slug))).map((slug) => ({
      path: `/offers/${slug}/`,
      changefreq: 'daily',
      priority: '0.8',
    })),
    // Sold-out pages stay in the map so crawlers find the SoldOut state
    // instead of a 404, but at archive priority — and only the ones that are
    // their own canonical (a sold-out twin of a live line points at it).
    ...delistedCanonicalSlugs(offersWithSlugs).map((slug) => ({
      path: `/offers/${slug}/`,
      changefreq: 'monthly',
      priority: '0.3',
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
