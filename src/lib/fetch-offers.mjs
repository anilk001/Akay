// Refresh the committed offline snapshot from live Airtable data.
// Run:  AIRTABLE_TOKEN=pat... npm run sync-offers
// Only overwrites the snapshot when the live fetch actually succeeds.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getOffers } from '../data/airtable.mjs';
import { updateRegistry } from './brand-registry.mjs';

const { offers, source } = await getOffers();
if (source !== 'live') {
  console.error('Refusing to overwrite snapshot — live fetch did not run (no token / no network).');
  process.exit(1);
}
const out = fileURLToPath(new URL('../data/offers-snapshot.json', import.meta.url));
writeFileSync(out, JSON.stringify({ offers, source: 'snapshot', generated: new Date().toISOString().slice(0, 10) }, null, 1));
console.log(`Wrote ${offers.length} offers to ${out}`);

// The brand registry is append-only and must be committed alongside the
// snapshot: it is the only record of brands that have sold through, and it is
// what keeps their pages returning 200 with `noindex` instead of 404 (§1).
const reg = await updateRegistry(offers);
console.log(`Brand registry: ${reg.total} slugs (${reg.added} new this refresh)`);
