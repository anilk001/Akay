// Pre-build step: write public/_redirects with a 410 Gone line for every
// offer URL that has been off-sale for more than GONE_AFTER_DAYS (SEO brief:
// keep off-sale URLs live ~90 days as "discontinued" pages, then 410).
// public/_redirects is generated, not committed — .gitignore'd.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import snapshot from '../src/data/offers-snapshot.json' with { type: 'json' };
import { withSlugs } from '../src/lib/slug.mjs';
import { loadRegistry, offSaleEntries } from '../src/lib/registry.mjs';

const liveSlugs = withSlugs(snapshot.offers.filter((o) => o.name)).map((o) => o.slug);
const { gone } = offSaleEntries(loadRegistry(), liveSlugs);

const lines = gone.map((g) => `/offers/${g.slug}/ /410.html 410`);
const out = fileURLToPath(new URL('../public/_redirects', import.meta.url));
writeFileSync(out, lines.join('\n') + (lines.length ? '\n' : ''));
console.log(`[redirects] wrote ${lines.length} 410 rule(s) to public/_redirects`);
