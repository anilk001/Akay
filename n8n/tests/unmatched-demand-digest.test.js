/**
 * Tests for the "Build Demand Digest" Code node.
 *
 * Same harness as trade-terms-digest.test.js: the node source is executed
 * rather than re-typed, so the test cannot drift from what gets pasted into
 * n8n. `$now` is faked so "this week" is a fixed date and the windows can be
 * asserted rather than guessed at.
 *
 * The assertion that matters most is the last one. This digest carries client
 * names and target prices because it is internal, and the Wanted table's own
 * rule is that a supplier-facing report may carry neither — so the block meant
 * for forwarding is checked for both, every run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'unmatched-demand-digest', 'build-demand-digest.js');
const nodeFn = new Function('$input', '$now', readFileSync(SRC, 'utf8'));

const TODAY = '2026-09-17';
const NOW = { toISODate: () => TODAY };

/** N days before the fixed "today". */
function daysAgo(n) {
  const d = new Date(TODAY + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function run(rows) {
  return nodeFn({ all: () => rows.map((json) => ({ json })) }, NOW)[0].json;
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

const want = (over) => ({
  'Wanted ID': 'W-1',
  Brand: 'Jameson',
  'Product Name': 'Jameson 12 x 70cl',
  'Volume ML': 700,
  Category: 'Spirits',
  Qty: 100,
  'Qty Unit': 'Cases',
  'Bond/Customs Status': 'T2',
  Status: 'Open',
  'Match Count': 0,
  'Client Name (Cache)': 'Buyer Wholesale Ltd',
  'Created Date': daysAgo(1),
  Source: 'Enquiry',
  ...over,
});

// ── Coverage ────────────────────────────────────────────────────────────────
section('Coverage');

let d = run([
  want({}),
  want({ Brand: 'Smirnoff', 'Match Count': 2, Status: 'Matched' }),
  want({ Brand: 'Absolut', 'Match Count': 0, Status: 'Offered' }),
  want({ Brand: 'Tanqueray' }),
]);
check('demand captured this week', d.stats.rows, 4);
check('matched counts the ones the matcher found', d.stats.matched, 2);
check('a status of Offered counts as matched even at zero', d.stats.unmatched, 2);
check('match rate', d.stats.coverage, 50);
check('distinct products behind the unmatched rows', d.stats.groups, 2);

// ── Windows ─────────────────────────────────────────────────────────────────
section('Windows');

d = run([
  want({ 'Created Date': daysAgo(2) }),
  want({ 'Created Date': daysAgo(20), 'Wanted ID': 'W-old' }),
  want({ 'Created Date': daysAgo(40), 'Wanted ID': 'W-ancient' }),
]);
check('only the reporting week is counted', d.stats.rows, 1);
check('but an earlier ask marks the product as a repeat', d.groups[0].repeat, true);
check('and says how many times', d.groups[0].priorCount, 1);
check('anything past the query window is ignored entirely', d.groups.length, 1);

d = run([want({ 'Created Date': daysAgo(2) })]);
check('a product asked for the first time is not a repeat', d.groups[0].repeat, false);

d = run([want({ 'Created Date': '' })]);
check('a row with no date is skipped rather than inflating the week', d.stats.rows, 0);

// ── Grouping ────────────────────────────────────────────────────────────────
section('Grouping');

// The extractor turned "70cl", "0.7L" and "700ml" into the same Volume ML at
// capture, so all three are one product to buy.
d = run([
  want({ 'Product Name': 'Jameson 70cl', 'Client Name (Cache)': 'A Ltd' }),
  want({ 'Product Name': 'Jameson 0.7L', 'Client Name (Cache)': 'B Ltd' }),
  want({ 'Product Name': 'Jameson 700ml', 'Client Name (Cache)': 'C Ltd' }),
]);
check('one product, however it was written', d.groups.length, 1);
check('three buyers behind it', d.groups[0].buyers, 3);
check('and the asks add up', d.groups[0].count, 3);
check('quantities are summed', d.groups[0].qty, 300);
check('labelled by brand, size and bond', d.groups[0].label, 'Jameson · 700ml · T2');

// T1 and T2 are different things to buy, so they must not merge.
d = run([
  want({ 'Bond/Customs Status': 'T1' }),
  want({ 'Bond/Customs Status': 'T2' }),
]);
check('bond status splits a brand into two lines', d.groups.length, 2);

// ── Ranking ─────────────────────────────────────────────────────────────────
section('Ranking');

// Four buyers asking once is a market; one buyer asking four times is an
// account. The brief is for buying decisions, so the market ranks first.
d = run([
  want({ Brand: 'OneBuyer', 'Volume ML': 500, 'Client Name (Cache)': 'A Ltd' }),
  want({ Brand: 'OneBuyer', 'Volume ML': 500, 'Client Name (Cache)': 'A Ltd' }),
  want({ Brand: 'OneBuyer', 'Volume ML': 500, 'Client Name (Cache)': 'A Ltd' }),
  want({ Brand: 'OneBuyer', 'Volume ML': 500, 'Client Name (Cache)': 'A Ltd' }),
  want({ Brand: 'ManyBuyers', 'Volume ML': 750, 'Client Name (Cache)': 'B Ltd' }),
  want({ Brand: 'ManyBuyers', 'Volume ML': 750, 'Client Name (Cache)': 'C Ltd' }),
]);
check('more distinct buyers outranks more asks', d.groups[0].brand, 'ManyBuyers');
check('even though the other was asked for more often', d.groups[1].count, 4);

// ── Buyers ──────────────────────────────────────────────────────────────────
section('Buyers');

d = run([
  want({ Client: [{ name: 'Linked Ltd' }], 'Client Name (Cache)': '' }),
]);
check('a resolved link is used when the cache is empty', d.groups[0].clients, ['Linked Ltd']);

d = run([
  want({ Client: ['recABCDEFGHIJKLMN'], 'Client Name (Cache)': '' }),
]);
check('a bare record id is not shown as a buyer name', d.groups[0].clients, []);
check('and the row still counts as demand', d.stats.unmatched, 1);

// Wanted has no client-name column of its own, so a quote-tool row carries
// the buyer in the notes the extractor stamped. Without this the digest would
// rank everything at zero buyers.
d = run([
  want({ 'Client Name (Cache)': '', 'Trader Notes': 'Source: Instant Quote (quote.akay.ie) — IQ-1\nBuyer: Stamped Ltd' }),
]);
check('the buyer stamped into the notes is read', d.groups[0].clients, ['Stamped Ltd']);

d = run([
  want({ 'Client Name (Cache)': '', 'Trader Notes': 'Source: Instant Quote — IQ-1\nBuyer: unattributed' }),
]);
check('an unattributed upload names nobody', d.groups[0].clients, []);
check('but still counts as an ask', d.groups[0].count, 1);

d = run([
  want({ Brand: 'Jameson', 'Client Name (Cache)': 'A Ltd' }),
  want({ Brand: 'Smirnoff', 'Volume ML': 1000, 'Client Name (Cache)': 'A Ltd' }),
  want({ Brand: 'Tanqueray', 'Volume ML': 500, 'Client Name (Cache)': 'B Ltd' }),
]);
check('buyers waiting are listed once each', d.stats.clientsWaiting, 2);
check('with everything they asked for', d.clientsWaiting[0].items.length, 2);

// ── Targets ─────────────────────────────────────────────────────────────────
section('Targets');

d = run([
  want({ 'Target Price': 17.5, Currency: 'EUR' }),
  want({ 'Target Price': 19, Currency: 'EUR' }),
]);
check('a target range across the buyers who stated one', d.groups[0].target, 'EUR 17.50–19.00');

d = run([want({ 'Target Price': 17.5, Currency: 'EUR' })]);
check('a single target is not rendered as a range', d.groups[0].target, 'EUR 17.50');

d = run([want({})]);
check('no target stated, nothing invented', d.groups[0].target, '');

// ── Where it came from ──────────────────────────────────────────────────────
section('Source');

// Wanted.Source has no "Instant Quote" option, so the extractor stamps the
// origin in Trader Notes and this is what the count reads.
d = run([
  want({ 'Trader Notes': 'Source: Instant Quote (quote.akay.ie) — IQ-20260917-090000' }),
  want({ Brand: 'Other', 'Trader Notes': 'Phoned in' }),
]);
check('quote-tool demand is counted separately', d.stats.fromInstantQuote, 1);

d = run([want({ Source: 'Instant Quote' })]);
check('and by the Source field too, once that option exists', d.stats.fromInstantQuote, 1);

// ── The quiet week ──────────────────────────────────────────────────────────
section('The quiet week');

d = run([]);
check('no rows at all is not an error', d.stats.unmatched, 0);
check('the text says so in words', d.text.includes('Nothing went unsourced'), true);
check('and the html agrees', d.html.includes('Nothing went unsourced'), true);

d = run([want({ 'Match Count': 3, Status: 'Matched' })]);
check('a fully matched week reports 100%', d.stats.coverage, 100);
check('and lists nothing to source', d.groups.length, 0);

// ── What may be forwarded ───────────────────────────────────────────────────
section('What may be forwarded');

// The Wanted table's rule: supplier demand reports aggregate by
// Brand/Volume/Bond only — no client names, no target prices. The supplierSafe
// block is built by dropping fields, and this is the check that it stayed that
// way.
d = run([
  want({ 'Client Name (Cache)': 'Buyer Wholesale Ltd', 'Target Price': 17.5, Currency: 'EUR' }),
  want({ Brand: 'Smirnoff', 'Volume ML': 1000, 'Client Name (Cache)': 'Second Buyer SARL', 'Target Price': 9.25, Currency: 'EUR' }),
]);
const safeText = JSON.stringify(d.supplierSafe);
check('the forwardable block names no buyer', /Buyer Wholesale|Second Buyer/.test(safeText), false);
check('and carries no target price', /17\.5|9\.25/.test(safeText), false);
check('but does carry the brand', safeText.includes('Jameson'), true);
check('the size', safeText.includes('700ml'), true);
check('the bond status', safeText.includes('T2'), true);
check('and the quantity, which is the whole point', safeText.includes('100'), true);
check('it does not leak how many buyers asked', /"buyers"/.test(safeText), false);

// The internal half still carries what the desk needs.
check('the internal brief does name the buyer', d.text.includes('Buyer Wholesale Ltd'), true);
check('and does print the target', d.text.includes('EUR 17.50'), true);

// ── Rendering ───────────────────────────────────────────────────────────────
section('Rendering');

d = run([want({ Brand: 'Tom & Jerry <script>', 'Client Name (Cache)': 'A & B Ltd' })]);
check('html escapes a brand with markup in it', d.html.includes('&lt;script&gt;'), true);
check('and does not emit the raw tag', d.html.includes('<script>'), false);

d = run([want({})]);
check('the subject carries the headline numbers', d.subject, 'Akay buying brief — 1 unsourced ask from 1 buyer, match rate 0%');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
