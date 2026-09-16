// node tests/site-stats.test.js
// The Site Stats read (getSiteStats in src/data/airtable.mjs): the homepage
// prints Airtable's `Display Value` verbatim, only when `Publish` is ticked,
// and falls back to NOTHING — never a figure — when the table cannot be read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// What the committed snapshot currently carries — the fallback `statsForSnapshot`
// reaches for when a live read fails. Read it rather than hardcoding a figure:
// the refresh bot rewrites this file every few minutes.
const bakedStats = JSON.parse(
  readFileSync(new URL('../src/data/offers-snapshot.json', import.meta.url), 'utf8'),
).stats || {};

// Force the live path before the module reads its env, then stub fetch so no
// network is touched. The stub records every request for inspection.
process.env.AIRTABLE_TOKEN = 'pat00000000000000.test';
process.env.AIRTABLE_STATS_TABLE = 'tblC0Bnld4aZTv7dd';
const calls = [];
let respond = () => ({ status: 200, body: { records: [] } });
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  const { status, body } = respond(String(url));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
};

const { statsFromRecords, getSiteStats, statsForSnapshot, FORBIDDEN_FIELDS, isForbiddenField } = await import('../src/data/airtable.mjs');

let n = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1; };

// --- statsFromRecords: the rules from the brief -----------------------------
const row = (fields) => ({ id: 'rec', fields });

// Verbatim: "Over" stays, no reformatting, whitespace trimmed only.
eq(statsFromRecords([row({ 'Stat Key': 'stock_value_eur', 'Display Value': ' Over €60 million ', Publish: true })]),
  { stock_value_eur: 'Over €60 million' });

// Publish is a hard gate: unticked (false) or missing → absent.
eq(statsFromRecords([row({ 'Stat Key': 'stock_value_eur', 'Display Value': 'Over €60 million', Publish: false })]), {});
eq(statsFromRecords([row({ 'Stat Key': 'stock_value_eur', 'Display Value': 'Over €60 million' })]), {});

// Empty or missing Display Value → absent, never "" or "€0".
eq(statsFromRecords([row({ 'Stat Key': 'stock_value_eur', 'Display Value': '   ', Publish: true })]), {});
eq(statsFromRecords([row({ 'Stat Key': 'stock_value_eur', Publish: true })]), {});
// Missing key → absent.
eq(statsFromRecords([row({ 'Display Value': 'Over €60 million', Publish: true })]), {});

// Generic key/value store: several keys, first row wins on a duplicate.
eq(statsFromRecords([
  row({ 'Stat Key': 'stock_value_eur', 'Display Value': 'Over €60 million', Publish: true }),
  row({ 'Stat Key': 'pallets_shipped', 'Display Value': '1,200+', Publish: true }),
  row({ 'Stat Key': 'stock_value_eur', 'Display Value': 'Over €5 million', Publish: true }),
  row({ 'Stat Key': 'draft_stat', 'Display Value': 'not yet', Publish: false }),
]), { stock_value_eur: 'Over €60 million', pallets_shipped: '1,200+' });

// Internal columns never leak through, even if Airtable returned them.
const leaky = statsFromRecords([row({
  'Stat Key': 'stock_value_eur', 'Display Value': 'Over €60 million', Publish: true,
  'Numeric Value': 63123456.78, Detail: 'coverage note', 'Lines Counted': 2900, 'Rate Date': '2026-09-16',
})]);
eq(leaky, { stock_value_eur: 'Over €60 million' });

// Garbage in → nothing out, no throw.
eq(statsFromRecords(null), {});
eq(statsFromRecords([null, {}, { fields: null }]), {});

// The internal columns are on the forbidden list the post-build checker scans for.
for (const f of ['Numeric Value', 'Detail', 'Lines Counted', 'Lines Skipped No Qty', 'Rate Date', 'Updated At']) {
  assert.ok(FORBIDDEN_FIELDS.includes(f) && isForbiddenField(f), `"${f}" must be forbidden`);
  n += 1;
}
for (const f of ['Stat Key', 'Display Value', 'Publish']) {
  eq(isForbiddenField(f), false, `"${f}" is a public-safe stats column`);
}

// --- getSiteStats: live path ------------------------------------------------
respond = () => ({ status: 200, body: { records: [
  row({ 'Stat Key': 'stock_value_eur', 'Display Value': 'Over €60 million', Publish: true }),
] } });
calls.length = 0;
eq(await getSiteStats(), { stats: { stock_value_eur: 'Over €60 million' }, source: 'live' });
eq(calls.length, 1);
const u = new URL(calls[0].url);
assert.ok(u.pathname.endsWith('/appaDSdZkAE9PGkjT/tblC0Bnld4aZTv7dd'), `reads the Site Stats table by id: ${u.pathname}`); n += 1;
// Only the three public columns are ever requested.
eq(u.searchParams.getAll('fields[]'), ['Stat Key', 'Display Value', 'Publish']);
eq(u.searchParams.get('filterByFormula'), '{Publish}=TRUE()');
eq(calls[0].init.headers.Authorization, 'Bearer pat00000000000000.test');

// Pagination is followed (a generic store may one day exceed a page).
respond = (url) => url.includes('offset=page2')
  ? { status: 200, body: { records: [row({ 'Stat Key': 'b', 'Display Value': '2', Publish: true })] } }
  : { status: 200, body: { records: [row({ 'Stat Key': 'a', 'Display Value': '1', Publish: true })], offset: 'page2' } };
eq((await getSiteStats()).stats, { a: '1', b: '2' });

// Unticked in Airtable → the key is gone (acceptance check 2).
respond = () => ({ status: 200, body: { records: [] } });
eq(await getSiteStats(), { stats: {}, source: 'live' });

// Nonexistent table / bad config → no stat, no throw (acceptance check 5).
// 404 is not retried, so this is immediate.
respond = () => ({ status: 404, body: { error: { type: 'TABLE_NOT_FOUND' } } });
eq(await getSiteStats(), { stats: {}, source: 'none' });
respond = () => ({ status: 403, body: { error: 'NOT_AUTHORIZED' } });
eq(await getSiteStats(), { stats: {}, source: 'none' });

// Malformed response body → nothing, no throw.
respond = () => ({ status: 200, body: { nope: true } });
eq(await getSiteStats(), { stats: {}, source: 'live' });

// --- statsForSnapshot: what `npm run sync-offers` bakes ---------------------
// A successful read always wins, so the Publish checkbox stays a kill switch:
// an empty live map removes the figure from the snapshot, and therefore the site.
eq(statsForSnapshot({ stats: { stock_value_eur: 'Over €65 million' }, source: 'live' },
  { stock_value_eur: 'Over €60 million' }), { stock_value_eur: 'Over €65 million' });
eq(statsForSnapshot({ stats: {}, source: 'live' }, { stock_value_eur: 'Over €60 million' }), {});

// A FAILED read keeps what the snapshot already carried: Airtable answers 429
// often enough that a five-minute refresh will hit one, and the figure must not
// drop off the homepage for a cycle because of it.
eq(statsForSnapshot({ stats: {}, source: 'none' }, { stock_value_eur: 'Over €60 million' }),
  { stock_value_eur: 'Over €60 million' });
// Nothing published before + a failed read is still nothing. Never invented.
eq(statsForSnapshot({ stats: {}, source: 'none' }, {}), {});
// Omitting `previous` — and passing `undefined`, which JS treats identically —
// is the DEFAULT path: a failed read falls back to whatever the committed
// snapshot already carries. Compare against the snapshot itself, not a literal.
// This asserted `{}` and only passed while the snapshot happened to carry no
// stats; the first refresh to bake a real figure in (2026-09-16, "Over €60
// million") turned it red with nothing wrong in the code it covers.
eq(statsForSnapshot({ stats: {}, source: 'none' }, undefined), bakedStats);
// No arguments at all is not a failed read — there is no source, so there is
// nothing to keep, and the answer is empty however full the snapshot is.
eq(statsForSnapshot(), {});

// The render path is unchanged by all this: a failed read still renders nothing,
// which is what an Astro build sees (acceptance check 5).
respond = () => ({ status: 404, body: { error: { type: 'TABLE_NOT_FOUND' } } });
eq((await getSiteStats()).stats, {});

console.log(`site-stats: ${n} assertions passed`);
