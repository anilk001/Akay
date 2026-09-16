// Refresh the committed offline snapshot from live Airtable data.
// Run:  AIRTABLE_TOKEN=pat... npm run sync-offers
// Only overwrites the snapshot when the live fetch actually succeeds.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getOffers, getSiteStats, statsForSnapshot } from '../data/airtable.mjs';

const { offers, delisted, source } = await getOffers();
if (source !== 'live') {
  console.error('Refusing to overwrite snapshot — live fetch did not run (no token / no network).');
  process.exit(1);
}
// Headline figures for the homepage ticker (see getSiteStats). Netlify's own
// build holds no Airtable token, so the published site can only show what is
// baked in here. An unticked Publish removes the figure on the next refresh; a
// failed fetch keeps the one already baked rather than dropping it for a cycle
// (see statsForSnapshot).
const stats = statsForSnapshot(await getSiteStats());
const out = fileURLToPath(new URL('../data/offers-snapshot.json', import.meta.url));
writeFileSync(out, JSON.stringify({ offers, delisted, stats, source: 'snapshot', generated: new Date().toISOString().slice(0, 10) }, null, 1));
console.log(`Wrote ${offers.length} offers + ${delisted.length} delisted + ${Object.keys(stats).length} site stat(s) to ${out}`);
