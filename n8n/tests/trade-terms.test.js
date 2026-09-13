/**
 * Tests for the "Trade Terms Normaliser — Akay" Code node.
 *
 * The node source is LOADED AND EXECUTED, not re-typed here. An n8n Code node
 * is a function body, so it is wrapped in `new Function('$input', src)` and
 * handed a fake `$input`. That keeps one source of truth: a regex fixed in the
 * node is a regex the tests see, which is the whole point of the sub-workflow.
 *
 * Cases are the wordings the 12 September backfill found in the base, plus the
 * ones the brief calls out by name.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'trade-terms-normaliser', 'normalise-trade-terms.js');
const body = readFileSync(SRC, 'utf8');
const nodeFn = new Function('$input', body);

function run(lines) {
  const items = (Array.isArray(lines) ? lines : [lines]).map((json) => ({ json }));
  return nodeFn({ all: () => items }).map((i) => i.json);
}
const one = (line) => run(line)[0];

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(title) { console.log(`\n--- ${title} ---`); }

const moq = (r) => [r.tradeTerms.moqType, r.tradeTerms.moqQty, r.tradeTerms.moqCurrency, r.tradeTerms.moqSource];
const lead = (r) => r.tradeTerms.leadTimeDays;

// ── 1. The three wordings from the brief, straight out of product names ─────
section('Facts buried in the product name');

let r = one({ rawName: 'Jim Beam Apple 12x70cl MOQ 50 cases' });
check('MOQ 50 cases parsed', moq(r), ['Cases', 50, '', 'Parsed From Text']);
check('name cleaned', r.productName, 'Jim Beam Apple 12x70cl');
check('original kept', r.rawProductName, 'Jim Beam Apple 12x70cl MOQ 50 cases');

r = one({ rawName: 'Casamigos Blanco — Lead time 2 weeks' });
check('lead time 2 weeks -> 14', lead(r), 14);
check('name cleaned of lead time', r.productName, 'Casamigos Blanco');

r = one({ rawName: 'Ferrero Rocher T30 min = 150 cases' });
check('"min = 150 cases"', moq(r), ['Cases', 150, '', 'Parsed From Text']);
check('name cleaned', r.productName, 'Ferrero Rocher T30');

// ── 2. Money minimums dominate ──────────────────────────────────────────────
section('Money minimums dominate');

r = one({ rawMoq: 'Minimum mixed order USD 35,000' });
check('currency-first', moq(r), ['Order Value', 35000, 'USD', 'Supplier Stated']);
check('"mixed" ticks the checkbox', r.tradeTerms.mixedLoadAllowed, true);

r = one({ rawMoq: '10.000 EUR minimum order' });
check('amount-first, European separators', moq(r), ['Order Value', 10000, 'EUR', 'Supplier Stated']);

r = one({ rawNotes: 'Min order 15k GBP per shipment' });
check('"15k" shorthand', moq(r), ['Order Value', 15000, 'GBP', 'Parsed From Text']);

r = one({ rawMoq: 'min. €5 000' });
check('space as thousands separator', moq(r), ['Order Value', 5000, 'EUR', 'Supplier Stated']);

r = one({ rawMoq: 'MOQ EUR 20,000 or 500 cases' });
check('value beats count when both stated', moq(r), ['Order Value', 20000, 'EUR', 'Supplier Stated']);
check('and it is noted', r.parse.notes.some((n) => /order value was taken/i.test(n)), true);

// ── 3. Counts, units and ranges ─────────────────────────────────────────────
section('Counts, units and ranges');

const units = [
  ['MOQ 50 cases', 'Cases', 50],
  ['MOQ: 20 ctns', 'Cartons', 20],
  ['minimum 600 btls', 'Bottles', 600],
  ['MOQ 1,200 pcs', 'Pieces', 1200],
  ['moq 2 pallets', 'Pallets', 2],
  ['Minimum order 1 x 40ft container', 'Container', 1],
  ['MOQ 1 FTL', 'Full Truckload', 1],
  ['MOQ: full pallet', 'Pallets', 1],
];
for (const [text, type, qty] of units) {
  r = one({ rawMoq: text });
  check(`"${text}"`, [r.tradeTerms.moqType, r.tradeTerms.moqQty], [type, qty]);
}

r = one({ rawMoq: 'MOQ 50-100 cases' });
check('MOQ range takes the LOWER bound', [r.tradeTerms.moqType, r.tradeTerms.moqQty], ['Cases', 50]);

r = one({ rawMoq: 'minimum 50 cases to 100 cases' });
check('range written as two counts', r.tradeTerms.moqQty, 50);

r = one({ rawMoq: 'No minimum' });
check('"No minimum"', [r.tradeTerms.moqType, r.tradeTerms.moqQty], ['No Minimum', null]);

r = one({ rawMoq: 'MOQ: n/a' });
check('"MOQ: n/a"', r.tradeTerms.moqType, 'No Minimum');

r = one({ rawNotes: 'MOQ applies, ask for details' });
check('"MOQ applies"', r.tradeTerms.moqType, 'Applies — Unspecified');

// ── 4. Lead time: ranges take the UPPER bound, ex-stock is zero ─────────────
section('Lead time');

const leads = [
  ['Lead time: 10 days', 10],
  ['lead time 2-3 weeks', 21],
  ['Lead time 4 to 6 weeks', 42],
  ['delivery within 2 weeks', 14],
  ['Lead time 10 working days', 14],
  ['dispatch 48 hours', 2],
  ['lead time 1 month', 30],
  ['ex-stock', 0],
  ['Ex stock', 0],
  ['immediate', 0],
  ['prompt', 0],
  ['on floor', 0],
  ['in stock', 0],
  ['same day', 0],
  ['next day', 1],
];
for (const [text, days] of leads) {
  r = one({ rawLeadTime: text });
  check(`"${text}" -> ${days} days`, lead(r), days);
}

r = one({ rawLeadTime: 'in stock, delivery 3 days' });
check('a stated duration beats a stated availability', lead(r), 3);

r = one({ rawLeadTime: 'out of stock' });
check('"out of stock" is not ex-stock', lead(r), null);

r = one({ rawName: 'Absolut Vodka 12x70cl', rawNotes: '2-3 weeks lead time. 20% deposit and 80% balance' });
check('clipped at the next term, not run into it', lead(r), 21);

// ── 5. The cascade, and what labels it ──────────────────────────────────────
section('Cascade: line -> header -> supplier default -> category rule');

const supplier = { 'Default MOQ Qty': 100, 'Default MOQ Unit': 'Cases', 'Default Lead Time Days': 21 };

r = one({ rawName: 'Grey Goose 6x70cl MOQ 50 cases', supplierDefaults: supplier });
check('a stated value is never overwritten by a default', moq(r), ['Cases', 50, '', 'Parsed From Text']);

r = one({ rawName: 'Grey Goose 6x70cl', supplierDefaults: supplier });
check('the default is used when the line is silent', moq(r), ['Cases', 100, '', 'Supplier Default']);
check('and the lead time default too', lead(r), 21);

r = one({
  rawName: 'Grey Goose 6x70cl',
  headerText: 'SPIRITS LIST 12/09 — minimum order 200 cases, lead time 3 weeks',
  supplierDefaults: supplier,
});
check('the header beats the supplier default', moq(r), ['Cases', 200, '', 'Parsed From Text']);
check('header lead time', lead(r), 21);

r = one({
  rawName: 'Grey Goose 6x70cl MOQ 40 cases',
  headerText: 'minimum order 200 cases',
  supplierDefaults: supplier,
});
check('the line overrides the header', r.tradeTerms.moqQty, 40);

// The header is parsed once per list and reused for every line from it.
const list = run([
  { rawName: 'Grey Goose 6x70cl', headerText: 'Min order EUR 25,000' },
  { rawName: 'Belvedere 6x70cl', headerText: 'Min order EUR 25,000' },
  { rawName: 'Ketel One 6x70cl', headerText: 'Min order EUR 25,000' },
]);
check('every line from the list carries the header terms',
  list.map((x) => x.tradeTerms.moqQty), [25000, 25000, 25000]);

// ── 6. Never guess ──────────────────────────────────────────────────────────
section('Never guess');

r = one({ rawMoq: 'MOQ: 50' });
check('bare number, no unit, no default -> nothing published', moq(r), ['Applies — Unspecified', null, '', 'Supplier Stated']);
check('and the raw text is reported', r.parse.unrecognised.length > 0, true);

r = one({ rawMoq: 'MOQ: 50', supplierDefaults: { 'Default MOQ Unit': 'Cases' } });
check('bare number + a supplier default unit resolves', [r.tradeTerms.moqType, r.tradeTerms.moqQty], ['Cases', 50]);

r = one({ rawMoq: 'to be agreed per order' });
check('unreadable MOQ sets nothing', r.tradeTerms.moqType, '');
check('and is written to the report', r.parse.unrecognised, ['to be agreed per order']);
check('status Unrecognised', r.parse.status, 'Unrecognised');

r = one({ rawName: 'Coca-Cola 24x330ml', rawNotes: 'Price EUR 8.50 per case, EXW Poland' });
check('a price is not read as an order minimum', r.tradeTerms.moqType, '');
check('no lead time invented', lead(r), null);

r = one({ rawName: 'Hennessy VS 6x70cl 40% vol min. 40%' });
check('"min. 40%" is a strength, not a minimum', r.tradeTerms.moqType, '');

// ── 7. Mixed load ───────────────────────────────────────────────────────────
section('Mixed load');

check('"can be mixed"', one({ rawNotes: 'Pallets can be mixed' }).tradeTerms.mixedLoadAllowed, true);
check('"flexible variants"', one({ rawNotes: 'flexible variants' }).tradeTerms.mixedLoadAllowed, true);
check('"partial quantities permitted"', one({ rawNotes: 'partial quantities permitted' }).tradeTerms.mixedLoadAllowed, true);
check('"no mixed pallets" -> false', one({ rawNotes: 'no mixed pallets' }).tradeTerms.mixedLoadAllowed, false);
check('"full pallets only" -> false', one({ rawNotes: 'full pallets only' }).tradeTerms.mixedLoadAllowed, false);
check('silence stays null, not false', one({ rawName: 'Jameson 70cl' }).tradeTerms.mixedLoadAllowed, null);

// ── 8. Never write a blank over an existing value ───────────────────────────
section('Field object carries only what was resolved');

r = one({ rawName: 'Jameson 12x70cl' });
check('nothing resolved -> no trade-terms keys at all',
  Object.keys(r.fieldsPreview).filter((k) => !/^Parse /.test(k)), []);

r = one({ rawMoq: 'MOQ 50 cases' });
check('MOQ resolved, lead time silent -> no Lead Time Days key',
  Object.prototype.hasOwnProperty.call(r.fieldsPreview, 'Lead Time Days'), false);
check('MOQ Currency omitted when the type is not Order Value',
  Object.prototype.hasOwnProperty.call(r.fieldsPreview, 'MOQ Currency'), false);
check('MOQ Currency present on an order value',
  one({ rawMoq: 'min USD 35,000' }).fieldsPreview['MOQ Currency'], 'USD');

// ── 9. Parse status, the input to the weekly digest ─────────────────────────
section('Parse status');

check('both resolved -> Clean', one({ rawMoq: 'MOQ 50 cases', rawLeadTime: '2 weeks' }).parse.status, 'Clean');
check('one resolved -> Partial', one({ rawMoq: 'MOQ 50 cases' }).parse.status, 'Partial');
check('neither -> Unrecognised', one({ rawName: 'Jameson 70cl' }).parse.status, 'Unrecognised');
check('resolved but with leftovers -> Partial',
  one({ rawMoq: 'MOQ 50 cases', rawLeadTime: 'depends on the season' }).parse.status, 'Partial');

// ── 10. Never block ingestion ───────────────────────────────────────────────
section('Never block ingestion');

const messy = run([
  { rawName: 'A 12x70cl MOQ 50 cases' },
  { rawName: null, rawMoq: undefined, rawNotes: 12345, headerText: { not: 'a string' } },
  { rawName: 'C 6x1L', rawLeadTime: 'ex-stock' },
]);
check('every line in, every line out', messy.length, 3);
check('the junk line still emits', messy[1].parse.status !== undefined, true);
check('and the good lines are unaffected', [messy[0].tradeTerms.moqQty, messy[2].tradeTerms.leadTimeDays], [50, 0]);

r = one({ rawName: 'Widget', sourceRowId: 'rec123', buyPrice: 4.2 });
check('caller keys pass through untouched', [r.sourceRowId, r.buyPrice], ['rec123', 4.2]);

// ── 11. DRY_RUN ─────────────────────────────────────────────────────────────
section('DRY_RUN');

r = one({ rawMoq: 'MOQ 50 cases', dryRun: true });
check('dry run writes nothing', r.fields, {});
check('but still shows what it would have written', r.fieldsPreview['MOQ Qty'], 50);

// ── 12. A real WhatsApp message, end to end ─────────────────────────────────
section('A real message, end to end');

r = one({
  rawName: '1250 cs Martini Bianco 6x1L original T2 MOQ 50 cases',
  rawNotes: '33,60€/cs EXW Loendersloot on floor. Mixed pallets possible.',
  supplierDefaults: { 'Default Lead Time Days': 30 },
});
check('MOQ from the name', moq(r), ['Cases', 50, '', 'Parsed From Text']);
check('the per-case price is not mistaken for a minimum', r.tradeTerms.moqType, 'Cases');
check('"on floor" -> ex-stock, and it beats the 30-day default', [lead(r), r.tradeTerms.leadTimeSource], [0, 'Parsed From Text']);
check('mixed ticked', r.tradeTerms.mixedLoadAllowed, true);
check('name cleaned', r.productName, '1250 cs Martini Bianco 6x1L original T2');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
