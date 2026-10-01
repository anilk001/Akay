/**
 * Tests for the "Extract WA Offers" Code node (product name clean-up).
 *
 * The node source is LOADED AND EXECUTED, not re-typed here, the same way
 * trade-terms.test.js runs its node: an n8n Code node is a function body, so it
 * is wrapped in `new Function('$input', src)` and handed a fake `$input`.
 *
 * Cases are the shapes that reached the public catalogue on 2026-09-30:
 * a product name ending in "Price:" or ":", and a spelled-out quantity
 * ("two loads ...") that was read as the brand.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'whatsapp-offer-ingestion', 'extract-wa-offers.js');
const nodeFn = new Function('$input', readFileSync(SRC, 'utf8'));

function run(messageText) {
  return nodeFn({ item: { json: { messageText } } }).json;
}
const names = (msg) => run(msg).dataRows.map((r) => r[0]);

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
}

// ---- trailing "Price:" / ":" label ------------------------------------------
check('"Price:" label before the price is not kept in the name',
  names('Ballantines 1l x 6, RF, T2, coded 2380 crt Price: EUR 12.40'),
  ['Ballantines 1l x 6, RF, T2, coded 2380 crt']);

check('a colon before the price is not kept in the name',
  names('Jameson Original (12 × 35 CL): 5,20 €'),
  ['Jameson Original (12 × 35 CL)']);

check('"..., Price:" drops the dangling comma too',
  names('JW Red 1l x 12, t2, RF coded, 1364cs full load, Price: 9,95 EUR'),
  ['JW Red 1l x 12, t2, RF coded, 1364cs full load']);

check('list mode: every line loses its colon label',
  names('Jameson (120 × 5 CL): EUR 1.10/btl\nAbsolut (24 × 20 CL): EUR 2.40/btl'),
  ['Jameson (120 × 5 CL)', 'Absolut (24 × 20 CL)']);

check('a name without a label is unchanged',
  names('Bacardi Carta Blanca 6x1L 37.5% (T2) – FTL @ EUR 5.95/btl | DAP Loen'),
  ['Bacardi Carta Blanca 6x1L 37.5% (T2)']);

// ---- spelled-out quantities and loads ----------------------------------------
check('"two loads" in front of the product is a quantity, not the brand',
  names('two loads Jameson Original 70 cl., 40%., NRF. EUR 13.20'),
  ['Jameson Original 70 cl., 40%., NRF.']);

check('"3 truckloads" in front of the product is a quantity',
  names('3 truckloads Heineken 24x330ml cans EUR 11.00/cs'),
  ['Heineken 24x330ml cans']);

check('a trailing "- five pallets" is a quantity',
  names('Martini Bianco 6x1L - five pallets @ 5,60 €/btl\nMartini Rosso 6x1L - 2 loads @ 5,60 €/btl'),
  ['Martini Bianco 6x1L', 'Martini Rosso 6x1L']);

check('a number word with no unit after it stays in the name',
  names('Two Fingers Tequila 70cl EUR 9.50'),
  ['Two Fingers Tequila 70cl']);

check('a leading numeral brand stays ("1000 Islands")',
  names('1000 Islands Vodka 70cl EUR 4.10'),
  ['1000 Islands Vodka 70cl']);

// ---- greetings and sentence-style offers (2026-10-01) ------------------------
// A supplier opened with a greeting on its own line and spelled the size out
// ("90 gram"). No line looked product-shaped, so the weakest rule took the first
// line with letters and created a Live offer called "Hi Anil ,".
const GERA = 'Hi Anil ,\nCan offer Davidoff 90 gram ,with English Arabic text with direct account , ' +
  'have 3 loads monthly- 4.55  euro cif major ports ,let me know if it is interesting';
check('a greeting line is never the product; the sentence yields the product',
  names(GERA), ['Davidoff 90 gram']);

check('the price on the sentence line is still read',
  run(GERA).dataRows.map((r) => r[1]), ['4.55 euro']);

check('greeting + an unsized priced line goes to review, not to an offer named "Hello Anil!"',
  names('Hello Anil!\nDavidoff Rich Aroma jars EUR 4.55'),
  []);

check('"Good morning" on its own line is a greeting',
  names('Good morning\nNescafe Gold 200g EUR 6.20'),
  ['Nescafe Gold 200g']);

check('a size-bearing name starting "Hi" is still a product',
  names('Hi-Spirits Vodka 70cl EUR 4.10'),
  ['Hi-Spirits Vodka 70cl']);

check('", t2" after the size is an attribute, not prose, and stays',
  names('Jameson 70cl, NRF, t2 @ EUR 13.20'),
  ['Jameson 70cl, NRF, t2']);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
