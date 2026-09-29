// Refresh the committed offline snapshot from live Airtable data.
// Run:  AIRTABLE_TOKEN=pat... npm run sync-offers
// Only overwrites the snapshot when the live fetch actually succeeds.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getOffers, getSiteStats, statsForSnapshot, FORBIDDEN_FIELDS } from '../data/airtable.mjs';
import { readLedger, updateLedger, serialiseLedger, LEDGER_URL } from './retired-offers.mjs';

// 'live' is Airtable, 'postgres' is the akay.offers replica (OFFERS_SOURCE).
// Both are real fetches and both may write. 'snapshot' means neither ran, and
// rewriting the snapshot from the snapshot would quietly freeze the catalogue
// while every run stayed green - so that one still refuses.
const LIVE_SOURCES = new Set(['live', 'postgres']);
const { offers, delisted, source } = await getOffers();
if (!LIVE_SOURCES.has(source)) {
  console.error('Refusing to overwrite snapshot — no live fetch ran (no token / no DATABASE_URL / no network).');
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
// A FLOOR ON THE ROW COUNT. `if (offers.length)` in getOffers() accepts any
// non-zero read as good. That was tolerable against Airtable, which is
// authoritative and atomic per request. akay.offers is a REPLICA whose sync can
// be mid-run, half-applied, or filtering wrongly - and a 12-row read would be
// committed straight over an 11,598-offer snapshot, the refresh job's git diff
// would see a change, and akay.ie would ship a near-empty catalogue with every
// gate green. The in-job test gate cannot catch it either: tests must not
// depend on catalogue contents.
const SHRINK_FLOOR = 0.8;
const prevCount = (() => {
  try { return JSON.parse(readFileSync(out, 'utf8')).offers?.length || 0; } catch { return 0; }
})();
if (prevCount && offers.length < prevCount * SHRINK_FLOOR && !process.env.FORCE_SNAPSHOT_SHRINK) {
  console.error(
    `Refusing to overwrite snapshot — ${offers.length} offers is a ${Math.round((1 - offers.length / prevCount) * 100)}% drop `
    + `from ${prevCount}. That is what a partial replica read looks like. Set FORCE_SNAPSHOT_SHRINK=1 if this is a genuine bulk expiry.`,
  );
  process.exit(1);
}

// SCAN THE SNAPSHOT ITSELF. check-public-safety.mjs walks dist/ and quote/,
// which was enough while the snapshot could only hold what Airtable was asked
// for. It is baked from a database holding buy prices and supplier identity
// now, and it is committed to a PUBLIC repo permanently in git history - so it
// is the artefact with the widest blast radius and, until this, the only one
// with no check. Refuse to write rather than fail after the fact.
const body = JSON.stringify({ ...next, generated }, null, 1);
const leaksIn = (text) => [
  ...FORBIDDEN_FIELDS.filter((f) => f.includes(' ') && text.includes(f)),
  ...[/postgres(?:ql)?:\/\/[^\s"'<>]*@/i, /\bpat[A-Za-z0-9]{14}\.[a-f0-9]{64}\b/]
    .filter((re) => re.test(text)).map((re) => String(re)),
];
const leaks = leaksIn(body);
if (leaks.length) {
  console.error(`Refusing to write snapshot — it contains: ${leaks.join(', ')}`);
  process.exit(1);
}

// Offer pages this snapshot no longer builds go into the retired-offers
// ledger, so the next deploy 301s them to their brand page instead of
// serving a 404 for URLs Google has indexed (see retired-offers.mjs). Read the
// outgoing snapshot before it is overwritten. An unchanged catalogue retires
// nothing, so the ledger stays byte-identical and the refresh job still exits
// at its git diff.
let prevSnapshot = null;
try { prevSnapshot = JSON.parse(readFileSync(out, 'utf8')); } catch { /* first bake */ }
const prevLedger = readLedger();
const ledger = updateLedger(prevLedger, prevSnapshot, next, generated);

// The ledger is committed to the same public repo, so it gets the same scan.
// (If a slug ever turns out to carry something private, fixing the name in
// Airtable is not enough: delete its entry here too.)
const ledgerBody = serialiseLedger(ledger);
const ledgerLeaks = leaksIn(ledgerBody);
if (ledgerLeaks.length) {
  console.error(`Refusing to write snapshot — the retired-offers ledger contains: ${ledgerLeaks.join(', ')}`);
  process.exit(1);
}

writeFileSync(out, body);
if (ledgerBody !== serialiseLedger(prevLedger)) {
  writeFileSync(LEDGER_URL, ledgerBody);
  console.log(`[retired] ledger now holds ${Object.keys(ledger).length} retired offer URLs`);
}
console.log(`[${source}] Wrote ${offers.length} offers + ${delisted.length} delisted + ${Object.keys(stats).length} site stat(s) to ${out} (generated ${generated})`);
