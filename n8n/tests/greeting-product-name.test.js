// Runs the REAL "Extract WA Offers" node source (not a copy of one function)
// against messages from the WhatsApp Log, and checks which product name comes
// out. The node is a function body with a top-level `return`, so it is wrapped
// in `new Function` with the n8n `$input` global supplied.
//
//   node n8n/tests/greeting-product-name.test.js
//
// Set COMPARE=1 to also run the committed version (git HEAD) side by side and
// print every case whose result changed.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'whatsapp-offer-ingestion', 'extract-wa-offers.js');

function load(src) {
  const fn = new Function('$input', src);
  return (messageText) => fn({ item: { json: { messageText } } }).json;
}
const run = load(fs.readFileSync(FILE, 'utf8'));

function productOf(out) {
  return out.offersFound ? out.dataRows[0][out.columnMap.productName] : '';
}

// [message, expected product name ('' = must go to review), note]
const CASES = [
  // The offer this test exists for: greeting on line 1, priced line with no
  // size on line 2. Was filed as product "Hi I have on the floor", brand "Hi".
  ['Hi I have on the floor \n9960 bottles MacAllan 12 yo Double cask GB at 43 euro DAP Reftrans on the floor',
   '', 'greeting is not a product; priced line has no size -> review'],

  // Same offer on one line: "I have" is now an announcement, the filler is
  // stepped over, and the name stops at the price.
  ['Hi I have on the floor 9960 bottles MacAllan 12 yo Double cask GB at 43 euro DAP Reftrans',
   'MacAllan 12 yo Double cask GB', 'announcement rule reads through "I have on the floor"'],

  // No size stated, so rule 1 cannot apply and the announcement rule carries it.
  ['We have in stock: Jameson Irish Whiskey Original @ EUR 18.50/btl EXW Loendersloot',
   'Jameson Irish Whiskey Original', 'existing "we have" still works; filler and terms dropped'],
  ['I have on the floor', '', 'announcement with nothing after the filler names nothing'],

  // Greeting followed only by a price line: nothing names the product.
  ['Hello\nPrice 3,30 eur DAP Loendersloot', '', 'greeting-only fallback -> review'],

  // Unchanged behaviour on the shapes the earlier rules were built for.
  ['Nescafé special filtre 200g @6.20€', 'Nescafé special filtre 200g', 'rule 1: size on the price line'],
  ['Stock Clearance: Haribo Mario Kart Veggie (160g)\nGreat product\n0,84€ EXW RO',
   'Haribo Mario Kart Veggie (160g)', 'rule 1: label stripped'],
  ['Good morning Anil\nGlenfiddich 12 YO 6x70cl\n1000 cs available\nEUR 28.90/btl EXW Loen',
   'Glenfiddich 12 YO 6x70cl', 'greeting present but a sized line names the product'],
  ['Offer price: minimum 500 ctn\n2 EUR per pcs', '', 'term label is still refused'],
];

let fail = 0;
console.log('RESULT | PRODUCT NAME'.padEnd(52), '| NOTE');
console.log('-'.repeat(110));
for (const [msg, expected, note] of CASES) {
  const got = productOf(run(msg));
  const ok = got === expected;
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(6), '|', (got || '(review)').padEnd(42), '|', note);
  if (!ok) console.log('       expected:', JSON.stringify(expected), 'got:', JSON.stringify(got));
}

if (process.env.COMPARE) {
  let old;
  try {
    old = load(execSync(`git show HEAD:n8n/whatsapp-offer-ingestion/extract-wa-offers.js`, { encoding: 'utf8' }));
  } catch (e) { console.log('\n(COMPARE skipped: cannot read HEAD version)'); }
  if (old) {
    console.log('\n--- changes against committed version ---');
    for (const [msg] of CASES) {
      const a = productOf(old(msg)), b = productOf(run(msg));
      if (a !== b) console.log(JSON.stringify(a || '(review)'), '->', JSON.stringify(b || '(review)'), '|', msg.split('\n')[0].slice(0, 50));
    }
  }
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURES`);
process.exit(fail ? 1 : 0);
