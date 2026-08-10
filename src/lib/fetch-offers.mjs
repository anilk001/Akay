// Refresh the committed offline snapshot from live Airtable data.
// Run:  AIRTABLE_TOKEN=pat... npm run sync-offers
// Only overwrites the snapshot when the live fetch actually succeeds.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getOffers } from '../data/airtable.mjs';
import { withSlugs } from './slug.mjs';
import { updateRegistry } from './registry.mjs';

const { offers, source } = await getOffers();
if (source !== 'live') {
  console.error('Refusing to overwrite snapshot — live fetch did not run (no token / no network).');
  process.exit(1);
}
const out = fileURLToPath(new URL('../data/offers-snapshot.json', import.meta.url));
writeFileSync(out, JSON.stringify({ offers, source: 'snapshot', generated: new Date().toISOString().slice(0, 10) }, null, 1));
console.log(`Wrote ${offers.length} offers to ${out}`);

// Record every published slug so off-sale offers keep a live URL
// ("discontinued" page for 90 days, then 410) — see src/lib/registry.mjs.
const reg = updateRegistry(withSlugs(offers.filter((o) => o.name)));
console.log(`Slug registry now tracks ${Object.keys(reg.slugs).length} URLs`);
