/**
 * Tests for the shared `buildOfferName` helper in the "Build Airtable Payload"
 * Code node of the four ingestion workflows.
 *
 * The mirror source is LOADED AND EVALUATED, not re-typed here, so a change to
 * the fragment is a change these tests see. The fragment is a set of function
 * declarations rather than an n8n node body, so it is wrapped in `new Function`
 * and asked for the entry point back.
 *
 * The doubled-brand cases are the real 22 September Bluebird rows that made the
 * bug visible. The date is pinned so the assertions do not depend on the day the
 * suite runs.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'offer-name', 'build-offer-name.js');
const src = readFileSync(SRC, 'utf8');
const buildOfferName = new Function(`${src}\nreturn buildOfferName;`)();

const TODAY = new Date().toISOString().slice(0, 10);
const BLUEBIRD = 'Bluebird Enterprises';

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(title) { console.log(`\n--- ${title} ---`); }

const name = (brand, productName, variant, volumeMl, supplier = BLUEBIRD) =>
  buildOfferName({ brand, productName, variant, volumeMl }, supplier);

// ── 1. The Bluebird rows of 2026-09-22, which is where this surfaced ─────────
section('doubled brand — the rows that exposed it');

check('brand repeated verbatim by product name',
  name('Jameson', 'Jameson', '', 700),
  `Jameson 700ml - ${BLUEBIRD} ${TODAY}`);

check('brand and variant both echoed by product name',
  name('Bushmills', 'Bushmills Original 40%', 'Original', 1000),
  `Bushmills Original 40% 1000ml - ${BLUEBIRD} ${TODAY}`);

check('multi-word brand echoed, variant echoed',
  name('Monkey Shoulder', 'Monkey Shoulder Blended Malt', 'Blended Malt', 700),
  `Monkey Shoulder Blended Malt 700ml - ${BLUEBIRD} ${TODAY}`);

check('product name extends the brand — the longer part wins',
  name('Jim Beam', 'Jim Beam Apple', '', 700),
  `Jim Beam Apple 700ml - ${BLUEBIRD} ${TODAY}`);

check('variant extends the brand',
  name('Olmeca', 'Olmeca Silver', 'Silver', 700),
  `Olmeca Silver 700ml - ${BLUEBIRD} ${TODAY}`);

check('two-word brand repeated verbatim',
  name('Chivas Regal', 'Chivas Regal', '', 700),
  `Chivas Regal 700ml - ${BLUEBIRD} ${TODAY}`);

// ── 2. Punctuation and case are not differences ─────────────────────────────
section('normalisation');

check('curly vs straight apostrophe still counts as a repeat',
  name('Ballantine’s', "Ballantine's", '', 1000),
  `Ballantine’s 1000ml - ${BLUEBIRD} ${TODAY}`);

check('case difference still counts as a repeat',
  name('JAMESON', 'Jameson', '', 700),
  `JAMESON 700ml - ${BLUEBIRD} ${TODAY}`);

check('extra spacing still counts as a repeat',
  name('Grey  Goose', 'Grey Goose', '', 700),
  `Grey  Goose 700ml - ${BLUEBIRD} ${TODAY}`);

// ── 3. Parts that are genuinely different are all kept ──────────────────────
section('distinct parts are preserved');

check('brand unrelated to product name',
  name('Diageo', 'Smirnoff Red', '', 700),
  `Diageo Smirnoff Red 700ml - ${BLUEBIRD} ${TODAY}`);

check('brand, product and variant all distinct',
  name('Absolut', 'Vodka', 'Raspberri', 1000),
  `Absolut Vodka Raspberri 1000ml - ${BLUEBIRD} ${TODAY}`);

check('a shared word is not a repeat — only a whole part is',
  name('Red Bull', 'Bull Horn Energy', '', 250),
  `Red Bull Bull Horn Energy 250ml - ${BLUEBIRD} ${TODAY}`);

// ── 4. Missing pieces degrade the way the old builder did ───────────────────
section('missing pieces');

check('no brand',
  name('', 'Jameson Black Barrel', '', 700),
  `Jameson Black Barrel 700ml - ${BLUEBIRD} ${TODAY}`);

check('no volume',
  name('Jameson', 'Jameson', '', null),
  `Jameson - ${BLUEBIRD} ${TODAY}`);

check('no supplier',
  name('Jameson', 'Jameson', '', 700, ''),
  `Jameson 700ml ${TODAY}`);

check('null and undefined parts are dropped, not printed',
  buildOfferName({ brand: null, productName: 'Jameson', variant: undefined, volumeMl: 700 }, BLUEBIRD),
  `Jameson 700ml - ${BLUEBIRD} ${TODAY}`);

check('nothing but a date when every part is empty',
  buildOfferName({}, ''),
  TODAY);

// ── 5. The property that matters: no part of the name is printed twice ──────
section('no part is printed twice');

const doubled = (s) => {
  const words = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  return words.some((w, i) => i > 0 && w === words[i - 1]);
};

for (const [brand, productName, variant] of [
  ['Jameson', 'Jameson', ''],
  ['Bushmills', 'Bushmills Original 40%', 'Original'],
  ['Monkey Shoulder', 'Monkey Shoulder Blended Malt', 'Blended Malt'],
  ['Chivas Regal', 'Chivas Regal', ''],
  ['Olmeca', 'Olmeca Silver', 'Silver'],
  ['Ballantine’s', "Ballantine's", ''],
]) {
  check(`no adjacent repeat: ${brand} / ${productName} / ${variant || '-'}`,
    doubled(name(brand, productName, variant, 700)), false);
}

console.log(`\n${fail ? 'FAILED' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
