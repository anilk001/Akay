/**
 * Tests for the "Build Parse Digest" Code node.
 *
 * Same harness as trade-terms.test.js: the node source is executed rather than
 * re-typed, so the test cannot drift from what gets pasted into n8n.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'trade-terms-digest', 'build-parse-digest.js');
const nodeFn = new Function('$input', readFileSync(SRC, 'utf8'));

function run(rows) {
  const items = rows.map((json) => ({ json }));
  return nodeFn({ all: () => items })[0].json;
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(t) { console.log(`\n--- ${t} ---`); }

const line = (over) => ({
  'Parse Status': 'Clean', 'Parse Notes': '', 'MOQ Type': 'Cases',
  'Lead Time Days': 14, 'Supplier Name': 'Alpha Trading', ...over,
});

// ── Coverage ────────────────────────────────────────────────────────────────
section('Coverage');

let d = run([
  line({}),
  line({ 'MOQ Type': '', 'Parse Status': 'Partial' }),
  line({ 'Lead Time Days': null, 'Parse Status': 'Partial' }),
  line({ 'MOQ Type': '', 'Lead Time Days': null, 'Parse Status': 'Unrecognised' }),
]);
check('lines counted', d.stats.lines, 4);
check('status tally', [d.stats.clean, d.stats.partial, d.stats.unrecognised], [1, 2, 1]);
check('MOQ coverage', d.stats.moqCoverage, 50);
check('lead time coverage', d.stats.leadTimeCoverage, 50);
check('lead time 0 counts as resolved — ex-stock is a value',
  run([line({ 'Lead Time Days': 0 })]).stats.leadTimeCoverage, 100);
check('empty week does not divide by zero', run([]).stats.moqCoverage, 0);

// ── Distinct unrecognised strings ───────────────────────────────────────────
section('Distinct unrecognised strings');

d = run([
  line({ 'Parse Notes': 'Unparsed: as per agreement', 'Supplier Name': 'Alpha Trading' }),
  line({ 'Parse Notes': 'Unparsed: as per agreement', 'Supplier Name': 'Beta Wines' }),
  line({ 'Parse Notes': 'Unparsed: AS PER AGREEMENT', 'Supplier Name': 'Alpha Trading' }),
  line({ 'Parse Notes': 'Unparsed: to be discussed', 'Supplier Name': 'Beta Wines' }),
  line({ 'Parse Notes': 'MOQ taken from the list header' }),
]);
check('grouped case-insensitively, commonest first',
  d.unrecognised.map((u) => [u.phrase, u.count]),
  [['as per agreement', 3], ['to be discussed', 1]]);
check('each string names its suppliers', d.unrecognised[0].suppliers, ['Alpha Trading', 'Beta Wines']);
check('explanatory notes are not listed as unparsed wording', d.unrecognised.length, 2);

d = run([line({ 'Parse Notes': 'Operational terms were moved out of the product name · Unparsed: min 3 mixed pallets' })]);
check('an Unparsed segment is picked out of a multi-note field',
  d.unrecognised.map((u) => u.phrase), ['min 3 mixed pallets']);

// ── Suppliers whose format changed ──────────────────────────────────────────
section('Suppliers whose format changed');

d = run([
  ...Array(6).fill(0).map(() => line({ 'Parse Status': 'Unrecognised', 'Supplier Name': 'Gamma Spirits' })),
  ...Array(4).fill(0).map(() => line({ 'Parse Status': 'Clean', 'Supplier Name': 'Gamma Spirits' })),
  ...Array(10).fill(0).map(() => line({ 'Parse Status': 'Clean', 'Supplier Name': 'Alpha Trading' })),
]);
check('flags the supplier over 50% unrecognised', d.drifting.map((s) => s.name), ['Gamma Spirits']);
check('with the ratio', [d.drifting[0].unrecognised, d.drifting[0].lines], [6, 10]);

d = run([
  line({ 'Parse Status': 'Unrecognised', 'Supplier Name': 'Tiny Supplier' }),
  line({ 'Parse Status': 'Unrecognised', 'Supplier Name': 'Tiny Supplier' }),
]);
check('two bad lines out of two is noise, not a signal', d.drifting, []);

// ── Shape ───────────────────────────────────────────────────────────────────
section('Shape');

d = run([{ fields: line({ 'Parse Notes': 'Unparsed: <b>on request</b>' }) }]);
check('accepts the raw Airtable { fields } wrapper', d.stats.lines, 1);
check('html escapes supplier-written text', /&lt;b&gt;on request&lt;\/b&gt;/.test(d.html), true);
check('subject carries the headline numbers', /MOQ 100%, lead time 100%/.test(d.subject), true);
check('text body renders', /TRADE TERMS PARSING/.test(d.text), true);

d = run([line({})]);
check('a clean week says so', /No unrecognised wording this week/.test(d.text), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
