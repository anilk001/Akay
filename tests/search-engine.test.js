// node tests/search-engine.test.js
//
// Two halves, on purpose:
//
//   1. The acceptance cases from the search brief run over a COMMITTED FIXTURE
//      (tests/fixtures/search-catalogue.json): a dozen real offer rows frozen in
//      the repo. They pin ranking, typo tolerance and unit handling against
//      rows that cannot change under the test.
//
//   2. The live snapshot is used only for what genuinely needs 11,000 rows —
//      the index-build and query-time budgets — and for a smoke check that
//      asks nothing about WHICH offers are in it.
//
// Why the split: this suite used to run the acceptance cases over the
// snapshot itself. Twice in two days a routine refresh turned it red with
// nothing wrong in the engine — first a new "Guinness 440ml" row outranked
// "Guinness Draught" (2026-09-16 13:27), then "Guinness Draught" expired at
// midnight and left the catalogue altogether (2026-09-17 00:05). The second
// one blocked the refresh job for hours: it runs this suite before it will
// commit, so akay.ie sat on a stale catalogue until a human noticed. A test
// that names a live SKU is a test that fails on the day that SKU sells out.
//
// Rule: nothing below may assert on a specific offer being present in the
// snapshot. Name a product only from the fixture.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, search, editDistance } from '../src/lib/search-engine.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const fixture = read('./fixtures/search-catalogue.json');
const snapshot = read('../src/data/offers-snapshot.json');

// Same field weighting the site uses (src/pages/search-index.json.ts).
const fields = (o) => ({
  strong: `${o.brand} ${o.name} ${o.variants || ''}`,
  weak: `${o.spec} ${o.category} ${o.tier || ''} ${o.terms || ''}`,
});

// ---------------------------------------------------------------------------
// 1. Acceptance cases — over the fixture
// ---------------------------------------------------------------------------
const index = buildIndex(fixture, fields);
const top = (query, n = 5) => {
  const rows = search(index, query);
  return rows ? rows.slice(0, n).map((r) => fixture[r.idx]) : [];
};

// The brief's headline case: a misspelt "guiness 44cl" finds a 44cl Guinness.
// Brand and size are the contract; the fixture carries two 24 x 440ml Guinness
// lines and either may win, exactly as on the live site.
{
  const [first] = top('guiness 44cl');
  assert.ok(first, 'no results for "guiness 44cl"');
  assert.equal(first.brand, 'Guinness');
  assert.equal(first.spec, '24 x 440ml');
}

// Typo tolerance
assert.equal(top('Guiness')[0].brand, 'Guinness');
assert.ok(top('Jamson').some((o) => /jameson/i.test(o.brand + o.name)), 'Jamson -> Jameson');

// Unit / spelling variants land on the same rows, in the same order
{
  const a = top('guinness 440ml').map((o) => o.id);
  const b = top('guinness 44cl').map((o) => o.id);
  const c = top('guinness 24x440').map((o) => o.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(fixture.find((o) => o.id === a[0]).spec, '24 x 440ml');
}

// "draft" -> "Draught": the fuzzy match reaches the real product name.
assert.equal(top('guinness draft')[0].name, 'Guinness Draught');

// Sizes must never fuzzy-match each other: 440ml is not 330ml
{
  const rows = search(index, 'guinness 440ml');
  const full = rows.filter((r) => r.matched === r.of).map((r) => fixture[r.idx].spec);
  assert.ok(full.length > 0, 'no full matches for "guinness 440ml"');
  assert.ok(full.every((s) => /440ml/.test(s)), `330ml leaked into 440ml results: ${full}`);
}

// Empty / stop-word query means "show everything"
assert.equal(search(index, ''), null);
assert.equal(search(index, 'x'), null);

// Partial fallback: a stray token does not blank the screen
{
  const rows = search(index, 'guinness draught zzzzqqq');
  assert.ok(rows.length > 0);
  assert.equal(fixture[rows[0].idx].name, 'Guinness Draught');
  assert.ok(rows[0].matched < rows[0].of);
}

// Edit distance sanity
assert.equal(editDistance('guiness', 'guinness', 2), 1);
assert.equal(editDistance('jamson', 'jameson', 2), 1);
assert.equal(editDistance('abc', 'xyz', 1), 2);

// ---------------------------------------------------------------------------
// 2. Live snapshot — budgets and a content-agnostic smoke check only
// ---------------------------------------------------------------------------
const offers = snapshot.offers;
assert.ok(offers.length > 0, 'snapshot carries no offers');

const t0 = Date.now();
const live = buildIndex(offers, fields);
const tBuild = Date.now() - t0;
assert.ok(tBuild < 2000, `index build took ${tBuild}ms over ${offers.length} offers`);

// Pick a query FROM the catalogue rather than naming one: whatever the first
// offer with a brand and a multi-word name is today, searching its own words
// must find it, and inside the budget.
{
  const probe = offers.find((o) => o.brand && o.name && o.name.trim().split(/\s+/).length >= 2);
  assert.ok(probe, 'no offer with a brand and a multi-word name to probe with');
  const t1 = Date.now();
  const rows = search(live, `${probe.brand} ${probe.name}`);
  const ms = Date.now() - t1;
  assert.ok(rows && rows.length > 0, `no results for a live offer's own name: "${probe.brand} ${probe.name}"`);
  assert.ok(rows.slice(0, 10).some((r) => offers[r.idx].id === probe.id),
    `"${probe.brand} ${probe.name}" (${probe.id}) is not in its own top 10`);
  assert.ok(ms < 300, `search took ${ms}ms`);
}

console.log(`search-engine: ok (${fixture.length} fixture rows; ${offers.length} live offers, index ${tBuild}ms)`);
