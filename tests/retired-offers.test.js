// Retired-offer ledger: offer pages that leave the catalogue 301 to their
// brand page instead of 404ing. Every case runs over the rows below, never the
// live snapshot (see the snapshot-safe-tests skill).

import assert from 'node:assert/strict';
import { updateLedger, capLedger, retiredRedirects, serialiseLedger } from '../src/lib/retired-offers.mjs';
import { buildRedirects, redirectsFile } from '../src/lib/redirects.mjs';

let n = 0;
const eq = (a, b) => { assert.deepEqual(a, b); n += 1; };
const ok = (v, msg) => { assert.ok(v, msg); n += 1; };

const row = (id, brand, name, extra = {}) => ({
  id: `rec${id}`, brand, name, spec: '6 x 70cl x 40% alc', category: 'Spirits', stock: 'in', ...extra,
});
const before = {
  offers: [
    row(1, 'Kilbeggan', 'Kilbeggan Irish Whiskey'),
    row(2, 'Kilbeggan', 'Kilbeggan Single Grain'),
    row(3, 'Kilbeggan', 'Kilbeggan Traditional'),
    row(4, 'Mystery', 'Mystery Gin'),
    row(5, 'Jägermeister', 'Jägermeister Orange'),
    row(6, '', 'Oldbrand Rum Special'),
  ],
  delisted: [],
};
const after = {
  offers: [row(2, 'Kilbeggan', 'Kilbeggan Single Grain'), row(3, 'Kilbeggan', 'Kilbeggan Traditional')],
  delisted: [],
};

// --- Pages that vanish are recorded with their brand and category ---------
const ledger = updateLedger({}, before, after, '2026-09-29');
eq(ledger['kilbeggan-irish-whiskey-6-x-70cl-x-40-alc'], ['Kilbeggan', 'Spirits', '2026-09-29']);
eq(ledger['mystery-gin-6-x-70cl-x-40-alc'], ['Mystery', 'Spirits', '2026-09-29']);
// Live pages are never in the ledger.
ok(!ledger['kilbeggan-single-grain-6-x-70cl-x-40-alc'], 'live page recorded as retired');
// An accented name is recorded under both its current and pre-2026-09-29 slug.
ok(ledger['jagermeister-orange-6-x-70cl-x-40-alc'], 'folded slug missing');
ok(ledger['jgermeister-orange-6-x-70cl-x-40-alc'], 'legacy slug missing');

// --- An unchanged catalogue leaves the ledger byte-identical --------------
eq(serialiseLedger(updateLedger(ledger, after, after, '2026-09-30')), serialiseLedger(ledger));

// --- A page that comes back live leaves the ledger ------------------------
const back = { offers: [...after.offers, row(1, 'Kilbeggan', 'Kilbeggan Irish Whiskey')], delisted: [] };
ok(!updateLedger(ledger, after, back, '2026-09-30')['kilbeggan-irish-whiskey-6-x-70cl-x-40-alc'], 'revived page still retired');

// --- The cap keeps the most recent retirements ----------------------------
eq(Object.keys(capLedger({ a: ['', '', '2026-01-01'], b: ['', '', '2026-03-01'], c: ['', '', '2026-02-01'] }, 2)), ['b', 'c']);

// --- Redirect targets: brand page, else category page, else none ----------
const rules = new Map(retiredRedirects(ledger, after).map((r) => [r.from, r.to]));
eq(rules.get('/offers/kilbeggan-irish-whiskey-6-x-70cl-x-40-alc/'), '/brands/kilbeggan-wholesale/');
// No page for the brand any more: fall back to its category.
eq(rules.get('/offers/mystery-gin-6-x-70cl-x-40-alc/'), '/category/spirits/');
// No brand recorded: the slug's leading words still find the brand page.
const unbranded = { 'kilbeggan-old-label-6-x-70cl-x-40-alc': ['', 'Nowhere', '2026-08-01'] };
eq(retiredRedirects(unbranded, after), [{ from: '/offers/kilbeggan-old-label-6-x-70cl-x-40-alc/', to: '/brands/kilbeggan-wholesale/' }]);
// Nothing live to send it to: no rule, the 404 page handles it.
eq(retiredRedirects({ 'gone-6-x-1': ['', 'Nowhere', '2026-08-01'] }, after), []);
// A retired slug that is a live page again is never redirected.
eq(retiredRedirects({ 'kilbeggan-traditional-6-x-70cl-x-40-alc': ['Kilbeggan', 'Spirits', '2026-08-01'] }, after), []);

// --- _redirects: ledger lines carry the trailing slash only ---------------
const file = redirectsFile(buildRedirects(after, ledger));
ok(file.includes('/offers/kilbeggan-irish-whiskey-6-x-70cl-x-40-alc/ /brands/kilbeggan-wholesale/ 301\n'), 'ledger rule missing');
ok(!file.includes('/offers/kilbeggan-irish-whiskey-6-x-70cl-x-40-alc /brands/'), 'ledger rule has a bare twin');

console.log(`retired-offers: ${n} assertions passed`);
