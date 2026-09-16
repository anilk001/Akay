// Refresh the committed offline snapshot from live Airtable data.
// Run:  AIRTABLE_TOKEN=pat... npm run sync-offers
// Only overwrites the snapshot when the live fetch actually succeeds.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getOffers, getSiteStats } from '../data/airtable.mjs';

const { offers, delisted, source } = await getOffers();
if (source !== 'live') {
  console.error('Refusing to overwrite snapshot — live fetch did not run (no token / no network).');
  process.exit(1);
}
// Headline figures for the homepage ticker (see getSiteStats). Netlify's own
// build holds no Airtable token, so the published site can only show what is
// baked in here. A failed stats fetch bakes an empty map — the stat vanishes
// until the next refresh rather than a stale or made-up figure being shown.
const { stats } = await getSiteStats();
const out = fileURLToPath(new URL('../data/offers-snapshot.json', import.meta.url));
writeFileSync(out, JSON.stringify({ offers, delisted, stats, source: 'snapshot', generated: new Date().toISOString().slice(0, 10) }, null, 1));
console.log(`Wrote ${offers.length} offers + ${delisted.length} delisted + ${Object.keys(stats).length} site stat(s) to ${out}`);
