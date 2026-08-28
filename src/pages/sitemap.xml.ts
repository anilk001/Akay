// The sitemap. Every indexable URL on the site, in one file.
//
// Kept as a route rather than switching to @astrojs/sitemap, for two reasons
// that both matter here: the integration emits sitemap-index.xml plus
// sitemap-0.xml, which would collide with this long-published /sitemap.xml and
// with the reference already in robots.txt; and brand pages with no live line
// render `noindex`, which a sitemap must not advertise. Doing it here keeps one
// file at one URL and lets the noindex set be excluded by construction.
import { getCatalogue } from '../lib/catalogue.mjs';
import { guides } from '../data/guides.mjs';
import { LOCALES, DEFAULT_LOCALE, TRANSLATED } from '../i18n/locales.mjs';
import { I18N_PAGES } from '../i18n/content.mjs';

export const prerender = true;

const SITE = 'https://offers.akay.ie';

type Entry = { loc: string; changefreq: string; priority: string; alternates?: string[] };

export async function GET() {
  const { offers, brands, retiredBrands, categories, generatedAt } = await getCatalogue();
  const lastmod = generatedAt.toISOString().split('T')[0];
  const entries: Entry[] = [];

  const add = (loc: string, changefreq: string, priority: string, alternates?: string[]) =>
    entries.push({ loc, changefreq, priority, alternates });

  add(`${SITE}/`, 'daily', '1.0');

  // Directories sit above the aggregation pages and are how a crawler reaches
  // all 691 brand pages, so they rank above the individual offers.
  add(`${SITE}/brands/`, 'daily', '0.9');
  add(`${SITE}/categories/`, 'daily', '0.9', localeSet('/categories/'));

  for (const category of categories) {
    add(`${SITE}/category/${category.slug}/`, 'daily', '0.9', localeSet(`/category/${category.slug}/`));
  }

  // Brand pages with live lines only. The retired ones return 200 and carry
  // `noindex` — listing a noindex URL here is a contradictory signal.
  for (const brand of brands) {
    add(`${SITE}/brand/${brand.slug}/`, 'daily', '0.8');
  }

  for (const offer of offers) {
    add(`${SITE}/offers/${offer.slug}/`, 'daily', '0.7');
  }

  // Trust pages: low churn, high conversion value.
  add(`${SITE}/about/`, 'monthly', '0.7');
  add(`${SITE}/trade-terms/`, 'monthly', '0.8', localeSet('/trade-terms/'));
  add(`${SITE}/customs-glossary/`, 'monthly', '0.8', localeSet('/customs-glossary/'));

  for (const guide of guides) {
    add(`${SITE}/guides/${guide.slug}/`, 'weekly', '0.6');
  }

  // Translated pages (§6).
  for (const code of TRANSLATED) {
    for (const path of I18N_PAGES) {
      add(`${SITE}/${code}${path}`, 'monthly', '0.6', localeSet(path));
    }
    for (const category of categories) {
      add(`${SITE}/${code}/category/${category.slug}/`, 'weekly', '0.6', localeSet(`/category/${category.slug}/`));
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.map((e) => `  <url>
    <loc>${e.loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>${e.alternates ? `\n${e.alternates.join('\n')}` : ''}
  </url>`).join('\n')}
</urlset>
`;

  // retiredBrands are deliberately absent; logged so a reviewer can see the
  // count rather than wonder whether the sitemap is short.
  console.log(
    `[sitemap] ${entries.length} URLs (${retiredBrands.length} noindex brand page(s) excluded)`
  );

  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}

// hreflang inside the sitemap as well as in the page head: Google accepts
// either, and the sitemap is the more reliable of the two at this page count.
function localeSet(path: string): string[] {
  return [
    ...Object.keys(LOCALES).map((code) => {
      const href = code === DEFAULT_LOCALE ? `${SITE}${path}` : `${SITE}/${code}${path}`;
      return `    <xhtml:link rel="alternate" hreflang="${code}" href="${href}" />`;
    }),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${path}" />`,
  ];
}
