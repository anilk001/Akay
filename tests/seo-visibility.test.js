// Search / AI-visibility fixes of 2026-09-29: accent folding in slugs, one
// brand page per brand however Airtable spells it, 301s for the URLs those
// changes retired, warehouse names as published, and the buyer-answer
// text on brand and offer pages. All cases run over the rows below, never the
// live snapshot (see the snapshot-safe-tests skill).

import assert from 'node:assert/strict';
import { generateSlug, legacySlug, brandPages, withSlugs } from '../src/lib/slug.mjs';
import { buildRedirects, redirectsFile } from '../src/lib/redirects.mjs';
import { normaliseLocation } from '../src/data/airtable.mjs';
import { brandAnswers, offerAnswers, houseMinimum, dutyClass } from '../src/lib/buying-answers.mjs';
import { COMPANY, LEGAL_NAME, companyAddressLine } from '../src/lib/site.mjs';
import { organizationSchema } from '../src/lib/schema.mjs';

let n = 0;
const eq = (a, b) => { assert.deepEqual(a, b); n += 1; };
const ok = (v, msg) => { assert.ok(v, msg); n += 1; };

// --- Slugs keep accented letters as their base letter ---------------------
eq(generateSlug("Moët & Chandon"), 'moet-chandon');
eq(generateSlug("L'Oréal Paris"), 'loreal-paris');
eq(generateSlug('Jägermeister'), 'jagermeister');
eq(generateSlug('Cachaça 51'), 'cachaca-51');
eq(generateSlug('Grosse Straße Øl'), 'grosse-strasse-ol');
// The degree sign is still dropped, as before.
eq(generateSlug('Jameson 40° 1L'), 'jameson-40-1l');
// The old rule, kept only for the redirect map.
eq(legacySlug("L'Oréal Paris"), 'loral-paris');

// --- One brand page per brand, whatever the spelling ----------------------
const row = (id, brand, extra = {}) => ({
  id, brand, name: `${brand} Line ${id}`, spec: '6 x 70cl x 40% alc', category: 'Spirits',
  amount: 100 + id, currency: 'EUR', priceBasis: 'case', tier: 'T2', warehouse: 'Loendersloot',
  incoterm: 'EXW', volumeMl: 700, stock: 'in', ...extra,
});
const rows = [
  row(1, 'Dove', { category: 'Toiletries' }), row(2, 'Dove', { category: 'Toiletries' }),
  row(3, 'DOVE', { category: 'Toiletries' }), row(4, 'DOVE', { category: 'Toiletries' }),
  row(5, "Jack Daniel's"), row(6, "Jack Daniel's"), row(7, 'Jack Daniels'), row(8, 'Jack Daniels'),
  row(9, 'Moët & Chandon', { category: 'Champagne' }), row(15, 'Moët & Chandon', { category: 'Champagne' }),
  row(10, 'Moet & Chandon', { category: 'Champagne' }), row(16, 'Moet & Chandon', { category: 'Champagne' }),
  row(11, 'PROCTER & GAMBLE', { category: 'Grocery' }), row(12, 'PROCTER & GAMBLE', { category: 'Grocery' }),
  row(13, 'PROCTER & GAMBLE', { category: 'Grocery' }), row(14, 'Procter & Gamble', { category: 'Grocery' }),
];
const pages = brandPages(rows);
const bySlug = new Map(pages.map((p) => [p.slug, p]));
eq(pages.length, 4);
eq(bySlug.get('dove-wholesale').offers.length, 4);
// Not in capitals, even when the capitals spelling is as common.
eq(bySlug.get('dove-wholesale').brand, 'Dove');
eq(bySlug.get('procter-gamble-wholesale').brand, 'Procter & Gamble');
// Tie on count: the accented spelling wins.
eq(bySlug.get('moet-chandon-wholesale').brand, 'Moët & Chandon');
eq([...bySlug.get('jack-daniels-wholesale').variants].sort(), ["Jack Daniel's", 'Jack Daniels']);
ok(!pages.some((p) => /-2$/.test(p.slug)), 'no -2 brand pages');

// --- Redirects: every retired URL goes to a page this build makes ----------
const rules = buildRedirects({ offers: rows, delisted: [] });
const from = new Map(rules.map((r) => [r.from, r.to]));
eq(from.get('/brands/dove-wholesale-2/'), '/brands/dove-wholesale/');
eq(from.get('/brands/jack-daniels-wholesale-2/'), '/brands/jack-daniels-wholesale/');
eq(from.get('/brands/mot-chandon-wholesale/'), '/brands/moet-chandon-wholesale/');
eq(from.get('/offers/mot-chandon-line-9-6-x-70cl-x-40-alc/'), '/offers/moet-chandon-line-9-6-x-70cl-x-40-alc/');
const livePages = new Set([
  ...withSlugs(rows).map((o) => `/offers/${o.slug}/`),
  ...pages.map((p) => `/brands/${p.slug}/`),
]);
ok(rules.every((r) => livePages.has(r.to)), 'every redirect target is a built page');
ok(rules.every((r) => !livePages.has(r.from)), 'no live page is redirected away');
ok(redirectsFile(rules).includes('/brands/dove-wholesale-2 /brands/dove-wholesale/ 301'), 'slashless form too');

// --- Location names as published ---------------------------------------
eq(normaliseLocation({ warehouse: 'NTG', terms: 'NTG' }), { warehouse: 'Netherlands', terms: 'Netherlands' });
eq(normaliseLocation({ warehouse: '', terms: 'EXW NTG' }), { warehouse: '', terms: 'EXW Netherlands' });
eq(normaliseLocation({ warehouse: 'New Corp warehouse', terms: 'EXW NewCorp' }), { warehouse: 'New Corp', terms: 'EXW New Corp' });
const kept = { warehouse: 'Reftrans', terms: 'DAP Reftrans' };
eq(normaliseLocation(kept), kept);

// --- Buyer answers ---------------------------------------------------------
eq(dutyClass('T1'), 'under-bond');
eq(dutyClass('Bonded'), 'under-bond');
eq(dutyClass('T2'), 'duty-paid');
eq(dutyClass('On Floor'), '');
eq(houseMinimum('Spirits').short, 'EUR 5,000 minimum order');
eq(houseMinimum('Toiletries').short, 'EUR 10,000 minimum order');
eq(houseMinimum('Wine').short, 'Full truck load (FTL)');
eq(houseMinimum('Beer').short, 'Full truck load (FTL)');
eq(houseMinimum('Soft Drinks').short, 'Full truck load (FTL)');
eq(houseMinimum('Champagne').short, 'EUR 15,000 minimum order');
eq(houseMinimum('Other'), null);

const jd = brandAnswers("Jack Daniel's", [row(1, "Jack Daniel's"), row(2, "Jack Daniel's", { tier: 'T1', amount: 90, warehouse: 'Riga' })]);
ok(jd.summary[0].startsWith("AKAY Trade currently lists 2 Jack Daniel's offers, from EUR 90.00 per case."), jd.summary[0]);
ok(jd.summary[0].includes('1 is duty-paid (T2) and 1 is under bond (T1)'), jd.summary[0]);
ok(jd.summary.some((l) => l.startsWith('Spirits: minimum order EUR 5,000.')), 'spirits minimum stated when every line is spirits');
eq(jd.faq.map((f) => f.q)[0], "Is Jack Daniel's available under bond (T1)?");

// Mixed categories: no single house minimum is claimed.
const mixed = brandAnswers('Mix', [row(1, 'Mix'), row(2, 'Mix', { category: 'Wine' })]);
ok(!mixed.summary.join(' ').includes('minimum order EUR 5,000'), 'no blanket minimum on mixed pages');
ok(mixed.faq.find((f) => /minimum/.test(f.q)).a.startsWith('Each offer shows its minimum'), 'mixed minimum answer');

// A per-bottle price is never quoted as a case price.
const btl = brandAnswers('B', [row(1, 'B', { priceBasis: 'bottle', amount: 7.5 }), row(2, 'B', { amount: 60 })]);
ok(btl.summary[0].includes('EUR 60.00 per case') && btl.summary[0].includes('EUR 7.50 per bottle or unit'), btl.summary[0]);

// An offer with its own MOQ does not also get the house minimum.
ok(!offerAnswers(row(1, 'X', { moqLabel: '50 cases' })).some((t) => /EUR 5,000/.test(t)), 'offer MOQ wins');
ok(offerAnswers(row(1, 'X')).some((t) => /EUR 5,000/.test(t)), 'house minimum when none stated');

// --- Company facts agree everywhere ---------------------------------------
eq(LEGAL_NAME, 'Akay Ireland Ltd');
eq(companyAddressLine(), '36 Gleann An Oir, Shannon, Co. Clare, V14 V006, Ireland');
const org = organizationSchema();
eq(org.legalName, 'Akay Ireland Ltd');
eq(org.vatID, 'IE8250418E');
eq(org.identifier.value, '250418');
eq(org.address.postalCode, 'V14 V006');
eq(org.address.streetAddress, COMPANY.streetAddress);

console.log(`seo-visibility: ${n} assertions passed`);
