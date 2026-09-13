// How the structured trade-terms fields become words on the site.
//
// The point of these cases is the HONESTY rule: a minimum that came from a
// supplier default or a category rule must be flagged `estimated`, so the page
// can hedge it rather than state a commitment the supplier never made.

import assert from 'node:assert/strict';
import {
  moqLabel, leadTimeLabel, isEstimated, moqBucket, leadTimeBucket, tradeTermsView,
} from '../src/lib/trade-terms.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n += 1; };

// ── MOQ wording ─────────────────────────────────────────────────────────────
eq(moqLabel({ moqType: 'Cases', moqQty: 50, moqSource: 'Supplier Stated' }),
  { text: '50 cases', estimated: false });
eq(moqLabel({ moqType: 'Cases', moqQty: 1, moqSource: 'Supplier Stated' }),
  { text: '1 case', estimated: false });
eq(moqLabel({ moqType: 'Cartons', moqQty: 20, moqSource: 'Parsed From Text' }),
  { text: '20 cartons', estimated: false });
eq(moqLabel({ moqType: 'Pallets', moqQty: 2, moqSource: 'Parsed From Text' }),
  { text: '2 pallets', estimated: false });
eq(moqLabel({ moqType: 'Order Value', moqQty: 35000, moqCurrency: 'USD', moqSource: 'Supplier Stated' }),
  { text: 'USD 35,000', estimated: false });
eq(moqLabel({ moqType: 'No Minimum', moqSource: 'Supplier Stated' }),
  { text: 'No minimum', estimated: false });
eq(moqLabel({ moqType: 'Container', moqQty: 1, moqSource: 'Supplier Stated' }),
  { text: '1 container', estimated: false });
eq(moqLabel({ moqType: 'Container', moqSource: 'Supplier Stated' }),
  { text: 'Container', estimated: false });
eq(moqLabel({ moqType: 'Full Truckload', moqQty: 2, moqSource: 'Parsed From Text' }),
  { text: '2 full loads', estimated: false });

// A minimum nobody stated the size of is "On request" — never a guess.
eq(moqLabel({ moqType: 'Applies — Unspecified', moqSource: 'Supplier Stated' }),
  { text: 'On request', estimated: false });
// An order-value minimum with no amount must not print a bare currency code.
eq(moqLabel({ moqType: 'Order Value', moqCurrency: 'EUR', moqSource: 'Supplier Stated' }),
  { text: 'On request', estimated: false });
eq(moqLabel({}), { text: '', estimated: false });

// ── The honesty rule ────────────────────────────────────────────────────────
eq(moqLabel({ moqType: 'Cases', moqQty: 100, moqSource: 'Supplier Default' }),
  { text: '100 cases', estimated: true });
eq(moqLabel({ moqType: 'Cases', moqQty: 50, moqSource: 'Category Rule' }),
  { text: '50 cases', estimated: true });
eq(isEstimated('Supplier Stated'), false);
eq(isEstimated('Parsed From Text'), false);
eq(isEstimated('Supplier Default'), true);
eq(isEstimated('Category Rule'), true);
eq(isEstimated(''), false);
// "No minimum" is never hedged: a default cannot invent the absence of one.
eq(moqLabel({ moqType: 'No Minimum', moqSource: 'Supplier Default' }).estimated, false);

// ── Legacy free text is the fallback, never lost ────────────────────────────
eq(moqLabel({ moq: 'min 3 mixed pallets' }), { text: 'min 3 mixed pallets', estimated: false });
// A structured value outranks the free text it was parsed out of.
eq(moqLabel({ moqType: 'Cases', moqQty: 50, moq: 'MOQ 50 cases', moqSource: 'Parsed From Text' }).text,
  '50 cases');
eq(leadTimeLabel({ leadTime: 'ask us' }), 'ask us');
eq(leadTimeLabel({ leadTimeDays: 14, leadTime: 'about 2 weeks' }), '2 weeks');

// ── Lead time wording ───────────────────────────────────────────────────────
eq(leadTimeLabel({ leadTimeDays: 0 }), 'Ex-stock');
eq(leadTimeLabel({ leadTimeDays: 1 }), '1 day');
eq(leadTimeLabel({ leadTimeDays: 7 }), '1 week');
eq(leadTimeLabel({ leadTimeDays: 21 }), '3 weeks');
// 10 days is not rounded into "1 week" — that would understate it.
eq(leadTimeLabel({ leadTimeDays: 10 }), '10 days');
eq(leadTimeLabel({ leadTimeDays: 45 }), '45 days');
eq(leadTimeLabel({}), '');

// ── Facet buckets ───────────────────────────────────────────────────────────
eq(moqBucket({ moqType: 'Cases' }), 'Unit minimum');
eq(moqBucket({ moqType: 'Bottles' }), 'Unit minimum');
eq(moqBucket({ moqType: 'Pallets' }), 'Pallet minimum');
eq(moqBucket({ moqType: 'Container' }), 'Full load only');
eq(moqBucket({ moqType: 'Full Truckload' }), 'Full load only');
eq(moqBucket({ moqType: 'Order Value' }), 'Minimum order value');
eq(moqBucket({ moqType: 'No Minimum' }), 'No minimum');
// An unspecified minimum is not a filterable fact.
eq(moqBucket({ moqType: 'Applies — Unspecified' }), '');
eq(moqBucket({}), '');

eq(leadTimeBucket({ leadTimeDays: 0 }), 'Ex-stock');
eq(leadTimeBucket({ leadTimeDays: 7 }), 'Within a week');
eq(leadTimeBucket({ leadTimeDays: 8 }), '1–4 weeks');
eq(leadTimeBucket({ leadTimeDays: 28 }), '1–4 weeks');
eq(leadTimeBucket({ leadTimeDays: 29 }), 'Over 4 weeks');
eq(leadTimeBucket({}), '');

// ── The view the templates consume ──────────────────────────────────────────
eq(tradeTermsView({ moqType: 'Cases', moqQty: 100, moqSource: 'Supplier Default', leadTimeDays: 0 }), {
  moqLabel: '100 cases',
  moqEstimated: true,
  moqBucket: 'Unit minimum',
  leadLabel: 'Ex-stock',
  leadBucket: 'Ex-stock',
});
// The view never carries moqSource onward — it must not reach the browser.
eq(Object.prototype.hasOwnProperty.call(tradeTermsView({ moqSource: 'Supplier Default' }), 'moqSource'), false);

console.log(`trade-terms-display: ${n} assertions passed`);
