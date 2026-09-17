// Refresh the committed offline snapshot from live Airtable data.
// Run:  AIRTABLE_TOKEN=pat... npm run sync-offers
// Only overwrites the snapshot when the live fetch actually succeeds.
import { readFileSync, writeFileSync } from 'node:fs';
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

// `generated` is the date the CATALOGUE last changed, not the date this ran.
// The refresh workflow commits whenever the file differs, so stamping today's
// date unconditionally forced a commit — and a Netlify deploy — at 00:00 UTC
// every day with nothing new in it (be69169, 2026-09-17: a one-line diff of
// the date). Keep the previous stamp when nothing else moved, so an unchanged
// catalogue produces a byte-identical file and the job exits at its git diff.
const next = { offers, delisted, stats, source: 'snapshot' };
let generated = new Date().toISOString().slice(0, 10);
try {
  const { generated: prevDate, ...prev } = JSON.parse(readFileSync(out, 'utf8'));
  if (JSON.stringify(prev) === JSON.stringify(next) && typeof prevDate === 'string') generated = prevDate;
} catch {
  // No readable previous snapshot: today's date it is.
}
writeFileSync(out, JSON.stringify({ ...next, generated }, null, 1));
console.log(`Wrote ${offers.length} offers + ${delisted.length} delisted + ${Object.keys(stats).length} site stat(s) to ${out} (generated ${generated})`);
