/**
 * Tests for the "Extract WA Offers" Code node — the brand-heading rule.
 *
 * The node source is LOADED AND EXECUTED, not re-typed here: an n8n Code node
 * is a function body, so it is wrapped in `new Function('$input', src)` and
 * handed a fake `$input`. A regex fixed in the node is a regex these tests see.
 *
 * The case that prompted this: Java Distribution, 22 September 2026, which
 * states two brands as headings and prices each size on its own line. Read line
 * by line it produced four catalogue rows named "70cl" and "1L".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'whatsapp-offer-ingestion', 'extract-wa-offers.js');
const nodeFn = new Function('$input', readFileSync(SRC, 'utf8'));

const run = (messageText) => nodeFn({ item: { json: { messageText } } }).json;
const names = (out) => out.dataRows.map((r) => r[0]);

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(title) { console.log(`\n--- ${title} ---`); }

// ── 1. The message this fix exists for ──────────────────────────────────────
section('Java Distribution spot offer, 2026-09-22');

const JAVA = `*SPOT OFFER – EXW LUXEMBOURG*

*WILLIAM PEEL*
70cl – *€2.70/btl*
1L – *€3.75/btl*

*SOBIESKI*
70cl – *€1.80/btl*
1L – *€3.70/btl*

Availability subject to confirmation.`;

const java = run(JAVA);
check('four offers, each carrying its brand heading', names(java),
  ['WILLIAM PEEL 70cl', 'WILLIAM PEEL 1L', 'SOBIESKI 70cl', 'SOBIESKI 1L']);
check('prices stay with their own line', java.dataRows.map((r) => r[1]),
  ['€2.70/btl', '€3.75/btl', '€1.80/btl', '€3.70/btl']);
check('the EXW banner is not mistaken for a brand', java.dataRows.every((r) => !/SPOT|LUXEMBOURG/i.test(r[0])), true);
check('incoterm still read from the banner', java.dataRows.map((r) => r[4]), ['EXW', 'EXW', 'EXW', 'EXW']);
check('no exceptions raised', java.preParseExceptions, []);

// ── 2. A heading never overwrites a line that names its own product ─────────
section('Lines that name a product keep exactly what the supplier wrote');

const NAMED = `*NEW ARRIVALS*
Jameson Irish Whiskey 6x70cl 40% – EUR 18.50/btl
Absolut Blue 6x1L 40% – EUR 11.20/btl`;
check('headed list of named products is untouched', names(run(NAMED)),
  ['Jameson Irish Whiskey 6x70cl 40%', 'Absolut Blue 6x1L 40%']);

const MIXED = `SOBIESKI
70cl – €1.80/btl
Jameson 1L 40% – €14.00/btl`;
check('heading applies only to the line that needs it', names(run(MIXED)),
  ['SOBIESKI 70cl', 'Jameson 1L 40%']);

// ── 3. No heading means no guess ────────────────────────────────────────────
section('A size with nothing above it is reported, not invented');

const HEADLESS = `70cl – €2.70/btl
1L – €3.75/btl
500ml – €1.90/btl`;
const headless = run(HEADLESS);
check('no rows created from bare sizes', headless.dataRows, []);
check('every bare size is reported', headless.preParseExceptions.length, 3);
check('the reason names the missing product',
  /states a size but no product/.test(headless.preParseExceptions[0].exceptionReason), true);
check('the supplier wording is preserved for the human',
  /70cl – €2.70\/btl/.test(headless.preParseExceptions[0].exceptionReason), true);

// ── 4. A stale heading cannot travel past the thing that ends it ────────────
section('Headings that are not brands are refused');

const BANNERS = `Price list September
70cl – €2.70/btl
1L – €3.75/btl`;
check('a "Price list" banner does not become a brand', run(BANNERS).dataRows, []);

const PROSE = `WILLIAM PEEL
Please note that all of the goods listed below are sold subject to prior sale and confirmation
70cl – €2.70/btl`;
check('a sentence between heading and price does not replace the brand',
  names(run(PROSE)), ['WILLIAM PEEL 70cl']);

// ── 5. Single-offer messages are unaffected ─────────────────────────────────
section('Single-offer mode still behaves');

const SINGLE = `Bacardi Carta Blanca 6x1L 37.5% (T2)
FTL @ EUR 5.95/btl | DAP Loendersloot`;
check('one priced line still yields one named offer', names(run(SINGLE)),
  ['Bacardi Carta Blanca 6x1L 37.5% (T2)']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
