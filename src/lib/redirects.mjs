// 301s for URLs the 2026-09-29 slug changes retired.
//
// Two changes moved pages:
//   1. Accented letters are now folded instead of dropped
//      (/brands/loral-paris-wholesale/ -> /brands/loreal-paris-wholesale/).
//   2. Brand spellings that reduce to the same slug share one page, so the
//      old "-2" pages (/brands/dove-wholesale-2/) fold into /brands/dove-wholesale/.
//
// Both old and new URLs are derived from the same offer list in the same
// order the pages use, so the map only ever points at a page this build made.
// An old URL that is still a live page under the new rules is never
// redirected. astro.config.mjs writes the result to dist/_redirects.
import { withSlugs, legacySlug, brandPages, legacyBrandSlugs } from './slug.mjs';

export function buildRedirects({ offers = [], delisted = [] } = {}) {
  const combined = [...offers, ...delisted];
  const current = withSlugs(combined);
  const legacy = withSlugs(combined, legacySlug);
  const livePaths = new Set(current.map((o) => `/offers/${o.slug}/`));

  const rules = new Map();
  current.forEach((offer, i) => {
    const from = `/offers/${legacy[i].slug}/`;
    const to = `/offers/${offer.slug}/`;
    if (from !== to && !livePaths.has(from)) rules.set(from, to);
  });

  const live = current.filter((o) => !o.delisted);
  const pages = brandPages(live);
  const pageBySpelling = new Map(pages.flatMap((p) => p.variants.map((v) => [v, p.slug])));
  const brandPaths = new Set(pages.map((p) => `/brands/${p.slug}/`));
  for (const { brand, slug } of legacyBrandSlugs(live)) {
    const target = pageBySpelling.get(brand);
    if (!target) continue;
    const from = `/brands/${slug}/`;
    const to = `/brands/${target}/`;
    if (from !== to && !brandPaths.has(from)) rules.set(from, to);
  }

  return [...rules.entries()].map(([from, to]) => ({ from, to }));
}

/** Netlify `_redirects` text: one "from to 301" line per rule. */
export function redirectsFile(rules) {
  const header = [
    '# Generated at build time by src/lib/redirects.mjs — do not edit by hand.',
    '# Old offer and brand URLs retired by the 2026-09-29 slug changes.',
  ];
  // Netlify matches paths with and without the trailing slash separately.
  const lines = rules.flatMap(({ from, to }) => [
    `${from} ${to} 301`,
    `${from.replace(/\/$/, '')} ${to} 301`,
  ]);
  return `${[...header, ...lines].join('\n')}\n`;
}
