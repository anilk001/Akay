// Build-time sitemap (SEO brief §3): homepage, every category, every live
// offer page, recently off-sale (discontinued) pages, guides and about.
// lastmod = the snapshot's generated date when known (the refresh job commits
// a new snapshot only when the catalogue actually changed, so it is an honest
// freshness signal), falling back to build date.
import { getOffers } from '../data/airtable.mjs';
import snapshot from '../data/offers-snapshot.json' with { type: 'json' };
import { withSlugs, categorySlug } from '../lib/slug.mjs';
import { loadRegistry, offSaleEntries } from '../lib/registry.mjs';

const SITE = 'https://offers.akay.ie';

export async function GET() {
  const { offers } = await getOffers();
  const slugged = withSlugs(offers.filter((o) => o.name));
  const categories = Array.from(new Set(slugged.map((o) => o.category))).sort();
  const { discontinued } = offSaleEntries(loadRegistry(), slugged.map((o) => o.slug));

  const lastmod = (snapshot as { generated?: string }).generated || new Date().toISOString().slice(0, 10);

  const urls: { loc: string; lastmod: string }[] = [
    { loc: `${SITE}/`, lastmod },
    ...categories.map((c) => ({ loc: `${SITE}/category/${categorySlug(c)}/`, lastmod })),
    ...slugged.map((o) => ({ loc: `${SITE}/offers/${o.slug}/`, lastmod })),
    ...discontinued.map((d) => ({ loc: `${SITE}/offers/${d.slug}/`, lastmod: d.lastSeen })),
    { loc: `${SITE}/about/`, lastmod },
    { loc: `${SITE}/guides/t1-vs-t2-duty-status/`, lastmod },
    { loc: `${SITE}/guides/incoterms-exw-dap-cfr/`, lastmod },
    { loc: `${SITE}/guides/how-to-buy-wholesale-spirits-eu/`, lastmod },
    { loc: `${SITE}/guides/requirement-list-format/`, lastmod },
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod></url>`).join('\n') +
    `\n</urlset>\n`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
