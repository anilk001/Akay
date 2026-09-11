// node tests/search-engine.test.js
// Runs the engine over the committed catalogue snapshot so the acceptance
// cases in the search brief are checked against real data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, search, editDistance } from '../src/lib/search-engine.mjs';

const snapshot = JSON.parse(readFileSync(new URL('../src/data/offers-snapshot.json', import.meta.url), 'utf8'));
const offers = snapshot.offers;

const fields = (o) => ({
  strong: `${o.brand} ${o.name} ${o.variants || ''}`,
  weak: `${o.spec} ${o.category} ${o.tier || ''} ${o.terms || ''}`,
});

const t0 = Date.now();
const index = buildIndex(offers, fields);
const tBuild = Date.now() - t0;
assert.ok(tBuild < 2000, `index build took ${tBuild}ms`);

function top(query, n = 5) {
  const rows = search(index, query);
  return rows ? rows.slice(0, n).map((r) => offers[r.idx]) : [];
}

// --- Acceptance test from the brief -----------------------------------------
{
  const t1 = Date.now();
  const [first] = top('guiness 44cl');
  const ms = Date.now() - t1;
  assert.ok(first, 'no results for "guiness 44cl"');
  assert.equal(first.name, 'Guinness Draught');
  assert.equal(first.spec, '24 x 440ml');
  assert.ok(ms < 300, `search took ${ms}ms`);
}

// Typo tolerance
assert.equal(top('Guiness')[0].brand, 'Guinness');
assert.ok(top('Jamson').some((o) => /jameson/i.test(o.brand + o.name)), 'Jamson -> Jameson');

// Unit / spelling variants land on the same rows
{
  const a = top('guinness 440ml').map((o) => o.id);
  const b = top('guinness 44cl').map((o) => o.id);
  const c = top('guinness 24x440').map((o) => o.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.equal(offers.find((o) => o.id === a[0]).spec, '24 x 440ml');
}
assert.equal(top('guinness draft')[0].name, 'Guinness Draught');

// Sizes must never fuzzy-match each other: 440ml is not 330ml
{
  const rows = search(index, 'guinness 440ml');
  const names = rows.filter((r) => r.matched === r.of).map((r) => offers[r.idx].spec);
  assert.ok(names.every((s) => /440ml/.test(s)), `330ml leaked into 440ml results: ${names}`);
}

// Empty / stop-word query means "show everything"
assert.equal(search(index, ''), null);
assert.equal(search(index, 'x'), null);

// Partial fallback: a stray token does not blank the screen
{
  const rows = search(index, 'guinness draught zzzzqqq');
  assert.ok(rows.length > 0);
  assert.equal(offers[rows[0].idx].name, 'Guinness Draught');
  assert.ok(rows[0].matched < rows[0].of);
}

// Edit distance sanity
assert.equal(editDistance('guiness', 'guinness', 2), 1);
assert.equal(editDistance('jamson', 'jameson', 2), 1);
assert.equal(editDistance('abc', 'xyz', 1), 2);

console.log(`search-engine: ok (${offers.length} offers, index ${tBuild}ms)`);
