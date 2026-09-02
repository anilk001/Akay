#!/usr/bin/env node
/**
 * Regression suite for the "Offer Dispatch — Akay" Code nodes.
 *
 * Run:  node test-nodes.cjs
 * Exit: 0 = all green (safe to paste into n8n), non-zero = do not paste.
 *
 * There is no way to exercise the live workflow without emailing real clients,
 * so this suite is the only gate on a composer change. Every case below is
 * either a documented past incident or a rule the mail depends on.
 *
 * The compose() under test is loaded out of n8n/compose-email.js — the same file
 * that gets pasted into the node — so the tests cannot drift from the source.
 * n8n/compose-email.baseline.js is the version that was live on 2026-08-18 and
 * is used only to assert that unchanged scenarios still render byte identically.
 */
const fs = require('fs');
const path = require('path');

function loadCompose(file) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8').split('// -- n8n glue')[0];
  return new Function(`${src}\nreturn compose;`)();
}
const compose = loadCompose('n8n/compose-email.js');
const composeBaseline = loadCompose('n8n/compose-email.baseline.js');

// The other Code nodes are executed the way n8n runs them: the file is the
// BODY of a function that receives `$` and `$input`.
const nodeBody = (file) => fs.readFileSync(path.join(__dirname, 'n8n', file), 'utf8');
const runNode = (file, $, $input) => new Function('$', '$input', nodeBody(file))($, $input);
// A minimal `$` : maps node name -> items (array of json). `.first()`, `.all()`.
const dollar = (byNode) => (name) => {
  if (!(name in byNode)) throw new Error(`Referenced node "${name}" has no data`);
  const items = byNode[name].map((json) => ({ json }));
  return { first: () => items[0], all: () => items, last: () => items[items.length - 1] };
};
const inputOf = (jsons) => ({ first: () => ({ json: jsons[0] }), all: () => jsons.map((json) => ({ json })) });

// The 2026-09-01 Compose Email changes, so the byte-identity tests against the
// 2026-08-19 baseline can state exactly what is allowed to differ:
//   - the per-product "Quantity:" line is no longer printed;
//   - a lead time shared by every line is printed once under the intro.
// Fixtures here carry no Lead Time, so only the first applies.
const dropQuantityLines = (body) => body.replace(/^Quantity: .*\n/gm, '');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  FAIL ${name}\n         ${err.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function termsLines(body) { return (body.match(/^Terms: .*$/gm) || []); }
function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}\n         expected: ${JSON.stringify(expected)}\n         actual:   ${JSON.stringify(actual)}`);
}

// ── fixtures ────────────────────────────────────────────────────────────────
const OFFER = (over = {}) => ({
  'Offer Name': 'Internal Name — Supplier X — 2026-08-19',
  'Public Product Description': 'Bombay Sapphire Gin',
  'Public Spec': '12 x 1000ml',
  'Price Per Unit & Case': 'EUR 109.20/case (12pk) · EUR 9.10/unit',
  'Price Display': 'EUR 109.20',
  'Price Type': 'Per Case',
  'Bond/Customs Status': 'T2',
  'Stock Display': 'Enquire for availability',
  'Availability': 'In stock — 1 FTL',
  'MOQ': '1 FTL',
  'Lead Time': '',
  'Public Terms': 'EXW Loendersloot',
  'Public Note': '',
  'Auto Expiry Date': '2026-09-18',
  'Bundle ID': null,
  'Bundle Title': '',
  'Supplier Name': ['Zentner Handels'],
  'Buy Price': 104,
  'Sell Price': 109.2,
  ...over,
});
const gateItem = (id, fields) => ({
  gatePassed: true, offerId: id, offerName: fields['Offer Name'],
  bondStatus: fields['Bond/Customs Status'], offerFields: fields,
});
const BUNDLE_FIELDS = {
  'Bundle ID': 'SPIRITS-APERITIFS-T2-2026-08-19',
  'Bundle Title': 'Spirits & Aperitifs — T2, EXW Loendersloot & Slovenia',
};
const FOUR = [
  gateItem('rec1', OFFER({ ...BUNDLE_FIELDS })),
  gateItem('rec2', OFFER({
    ...BUNDLE_FIELDS, 'Public Product Description': 'Eristoff Vodka', 'Public Spec': '6 x 700ml',
    'Price Per Unit & Case': 'EUR 20.58/case (6pk) · EUR 3.43/unit', 'Price Display': 'EUR 20.58',
    'Availability': 'In stock — 2 FTL', 'MOQ': '2 FTL', 'Buy Price': 19.6, 'Sell Price': 20.58,
  })),
  gateItem('rec3', OFFER({
    ...BUNDLE_FIELDS, 'Public Product Description': 'Martini Rosso', 'Public Spec': '6 x 1000ml',
    'Price Per Unit & Case': 'EUR 34.13/case (6pk) · EUR 5.69/unit', 'Price Display': 'EUR 34.13',
    'Buy Price': 32.5, 'Sell Price': 34.13,
  })),
  gateItem('rec4', OFFER({
    ...BUNDLE_FIELDS, 'Public Product Description': 'Campari', 'Public Spec': '6 x 100cl x 25% alc',
    'Price Per Unit & Case': 'EUR 120.75/case (6pk) · EUR 20.13/unit', 'Price Display': 'EUR 120.75',
    'Public Terms': 'EXW Intereuropa, Slovenia', 'Buy Price': 115, 'Sell Price': 120.75,
  })),
];
const SAME_WAREHOUSE = FOUR.slice(0, 3);

console.log('\nCompose Email\n');

// ── 1-3: the 2026-08-19 change, and proof it changes nothing else ───────────
check('1. mixed-warehouse bundle prints Terms inside every product block', () => {
  const r = compose(FOUR, FOUR.map((g) => g.offerId));
  assert(r.composed, `expected composed, halted: ${r.haltReason}`);
  const blocks = r.bodyTemplate.split('\n\n').filter((b) => /^(Bombay|Eristoff|Martini|Campari)/.test(b));
  eq(blocks.length, 4, 'expected four product blocks');
  eq(blocks[0].includes('Terms: EXW Loendersloot'), true, 'Bombay block must carry its warehouse');
  eq(blocks[1].includes('Terms: EXW Loendersloot'), true, 'Eristoff block must carry its warehouse');
  eq(blocks[2].includes('Terms: EXW Loendersloot'), true, 'Martini block must carry its warehouse');
  eq(blocks[3].includes('Terms: EXW Intereuropa, Slovenia'), true, 'Campari block must carry its own warehouse');
  // Terms sit next to the bond status, not adrift among the logistics lines.
  const order = blocks[3].split('\n').map((l) => l.split(':')[0]);
  assert(order.indexOf('Status') < order.indexOf('Terms'), 'Terms should follow Status');
  assert(order.indexOf('Terms') < order.indexOf('Minimum order'), 'Terms should precede Minimum order');
});

check('2. mixed-warehouse bundle states no single closing Terms line', () => {
  const r = compose(FOUR, FOUR.map((g) => g.offerId));
  const closing = r.bodyTemplate.slice(r.bodyTemplate.indexOf('Campari'));
  eq(/\nTerms: EXW Loendersloot\nValidity/.test(closing), false,
    'a whole-mail Terms line would claim one warehouse for all four lines');
  eq(r.bodyTemplate.includes('Validity: until 18 September 2026, subject to prior sale'), true,
    'validity is still stated once');
});

check('3. same-warehouse bundle matches the 2026-08-19 baseline (minus the dropped Quantity line)', () => {
  const ids = SAME_WAREHOUSE.map((g) => g.offerId);
  const now = compose(SAME_WAREHOUSE, ids);
  const before = composeBaseline(SAME_WAREHOUSE, ids);
  eq(now.subject, before.subject, 'subject drifted for an unchanged scenario');
  eq(now.bodyTemplate, dropQuantityLines(before.bodyTemplate), 'body drifted for an unchanged scenario');
  eq(now.bodyTemplate.includes('Quantity:'), false, 'Quantity line was removed 2026-09-01');
  eq(now.bodyTemplate.includes('Terms: EXW Loendersloot'), true, 'closing Terms line still printed');
  eq(now.bodyTemplate.split('Terms: EXW Loendersloot').length - 1, 1, 'terms stated exactly once');
});

check('4. single offer matches the baseline (minus the dropped Quantity line)', () => {
  const one = [gateItem('rec1', OFFER())];
  const now = compose(one, ['rec1']);
  const before = composeBaseline(one, ['rec1']);
  eq(now.subject, before.subject, 'subject drifted');
  eq(now.bodyTemplate, dropQuantityLines(before.bodyTemplate), 'body drifted');
  eq(now.isBundle, false, 'single offer is not a bundle');
});

check('5. one line carrying terms while others are blank keeps the closing line', () => {
  const mixed = [
    gateItem('rec1', OFFER({ ...BUNDLE_FIELDS })),
    gateItem('rec2', OFFER({ ...BUNDLE_FIELDS, 'Public Product Description': 'Eristoff Vodka', 'Public Terms': '' })),
  ];
  const r = compose(mixed, ['rec1', 'rec2']);
  const lines = termsLines(r.bodyTemplate);
  eq(lines.length, 1, 'only one distinct warehouse is known, so Terms is stated once');
  eq(lines[0], 'Terms: EXW Loendersloot', 'and it belongs in the closing line');
  // The warehouse also appears inside the Bundle Title here, which is printed in
  // the subject and intro. That is the trader's own wording, not a Terms line.
});

// ── 6-9: the 2026-08-14 price-basis incident ────────────────────────────────
check('6. price line carries its basis from Price Per Unit & Case', () => {
  const r = compose([gateItem('rec1', OFFER())], ['rec1']);
  eq(r.bodyTemplate.includes('Price: EUR 109.20/case (12pk) · EUR 9.10/unit'), true, 'basis-labelled price expected');
});

check('7. empty Price Per Unit & Case derives the basis from Price Type', () => {
  const f = OFFER({ 'Price Per Unit & Case': '', 'Price Display': 'EUR 18.25', 'Price Type': 'Per Bottle' });
  const r = compose([gateItem('rec1', f)], ['rec1']);
  eq(r.bodyTemplate.includes('Price: EUR 18.25/bottle'), true,
    'a bare figure told 377 buyers a per-bottle price was a case price');
});

check('8. blank Price Type prints a bare figure rather than a false basis', () => {
  const f = OFFER({ 'Price Per Unit & Case': '', 'Price Display': 'EUR 18.25', 'Price Type': '' });
  const r = compose([gateItem('rec1', f)], ['rec1']);
  eq(r.bodyTemplate.includes('Price: EUR 18.25\n'), true, 'expected bare figure');
});

check('9. no price at all refuses to send', () => {
  const f = OFFER({ 'Price Per Unit & Case': '', 'Price Display': '' });
  const r = compose([gateItem('rec1', f)], ['rec1']);
  eq(r.composed, false, 'must halt');
  assert(/PRICE_LINE/.test(r.haltReason), `halt reason should name the field, got: ${r.haltReason}`);
});

// ── 10-11: the 2026-08-17 Coffee-Mate duplicate ─────────────────────────────
check('10. MOQ and validity are printed from the fields', () => {
  const r = compose([gateItem('rec1', OFFER())], ['rec1']);
  eq(r.bodyTemplate.includes('Minimum order: 1 FTL'), true, 'MOQ expected');
  eq(r.bodyTemplate.includes('Validity: until 18 September 2026'), true, 'validity expected');
});

check('11. note lines restating a printed price or fact are dropped', () => {
  const f = OFFER({ 'Public Note': 'Terms: EXW Loendersloot\nEUR 109.20 per case\nPallet-ready, English labels' });
  const r = compose([gateItem('rec1', f)], ['rec1']);
  eq(r.noteLinesDropped, 2, 'the terms line and the restated price should both go');
  eq(r.bodyTemplate.includes('Pallet-ready, English labels'), true, 'genuinely new information is kept');
  eq(r.bodyTemplate.split('109.20').length - 1, 1, 'the price appears once');
});

// ── 12-14: leak guard ───────────────────────────────────────────────────────
check('12. supplier name in public text halts the run', () => {
  const f = OFFER({ 'Public Note': 'Stock held by Zentner Handels in Rotterdam' });
  const r = compose([gateItem('rec1', f)], ['rec1']);
  eq(r.composed, false, 'must halt');
  assert(/supplier name/.test(r.haltReason), `expected a supplier-name leak, got: ${r.haltReason}`);
});

check('13. a whole-number Buy Price is not mistaken for a leak', () => {
  const f = OFFER({ 'Buy Price': 1, 'Sell Price': 1.05, 'MOQ': '1 pallet/line' });
  const r = compose([gateItem('rec1', f)], ['rec1']);
  eq(r.composed, true, `"1 pallet/line" must not trip the guard: ${r.haltReason}`);
});

check('14. a real buy price in public text halts the run', () => {
  const f = OFFER({ 'Public Note': 'Our cost is EUR 104.00 per case' });
  const r = compose([gateItem('rec1', f)], ['rec1']);
  eq(r.composed, false, 'must halt');
  assert(/buy price/.test(r.haltReason), `expected a buy-price leak, got: ${r.haltReason}`);
});

// ── 15-17: shape and safety rails ───────────────────────────────────────────
check('15. a bare pack count is rendered as a per-case count', () => {
  const r = compose([gateItem('rec1', OFFER({ 'Public Spec': '15' }))], ['rec1']);
  eq(r.bodyTemplate.includes('Pack: 15 per case'), true, 'a bare "15" tells a buyer nothing');
});

check('16. a missing product name refuses to send', () => {
  const r = compose([gateItem('rec1', OFFER({ 'Public Product Description': '' }))], ['rec1']);
  eq(r.composed, false, 'must halt');
  assert(/PRODUCT_NAME/.test(r.haltReason), `halt reason should name the field, got: ${r.haltReason}`);
});

check('17. composition honours the group Build Recipients chose', () => {
  const r = compose(FOUR, ['rec4']);
  eq(r.bundleOfferIds.join(','), 'rec4', 'mail and audience must describe the same offers');
  eq(r.bodyTemplate.includes('Bombay'), false, 'a deferred line must not appear');
  const lines = termsLines(r.bodyTemplate);
  eq(lines.length, 1, 'a single-line group states its terms once');
  eq(r.bodyTemplate.includes('\nTerms: EXW Intereuropa, Slovenia\nValidity'), true,
    'and states them in the closing block, not inside the product block');
});

check('18. internal addresses never reach a buyer', () => {
  const r = compose([gateItem('rec1', OFFER({ 'Public Note': 'Queries to kai@akay.ie' }))], ['rec1']);
  eq(r.composed, false, 'must halt');
  assert(/internal address/.test(r.haltReason), `expected an internal-address leak, got: ${r.haltReason}`);
});

check('19. the unsubscribe line and sender identity are always present', () => {
  const r = compose(FOUR, FOUR.map((g) => g.offerId));
  eq(r.bodyTemplate.includes('To stop receiving offers, reply with "unsubscribe".'), true, 'unsubscribe expected');
  eq(r.bodyTemplate.includes('Akay Irl Ltd'), true, 'sender identity expected');
  eq(r.listUnsubscribe, 'mailto:offers@akay.ie?subject=unsubscribe', 'List-Unsubscribe header value');
});


check('20. a lead time shared by every line is stated once, above the products', () => {
  const two = [
    gateItem('rec1', OFFER({ ...BUNDLE_FIELDS, 'Lead Time': '2 weeks' })),
    gateItem('rec2', OFFER({ ...BUNDLE_FIELDS, 'Public Product Description': 'Eristoff Vodka', 'Lead Time': '2 weeks' })),
  ];
  const r = compose(two, ['rec1', 'rec2']);
  eq(r.bodyTemplate.split('Lead time: 2 weeks').length - 1, 1, 'shared lead time printed exactly once');
  assert(r.bodyTemplate.indexOf('Lead time: 2 weeks') < r.bodyTemplate.indexOf('Bombay'), 'and it sits above the product blocks');
  const mixed = [
    gateItem('rec1', OFFER({ ...BUNDLE_FIELDS, 'Lead Time': '2 weeks' })),
    gateItem('rec2', OFFER({ ...BUNDLE_FIELDS, 'Public Product Description': 'Eristoff Vodka', 'Lead Time': '' })),
  ];
  const m = compose(mixed, ['rec1', 'rec2']);
  assert(m.bodyTemplate.indexOf('Lead time: 2 weeks') > m.bodyTemplate.indexOf('Bombay'), 'a mixed lead time stays inside its own product block');
});

// ── Build Recipients (live node) ────────────────────────────────────────────
console.log('\nBuild Recipients\n');

const CLIENTS = [
  { id: 'c1', fields: { 'Client Name': 'Anvar P Y', Email: 'anvar@example.ae', Status: 'Active', Country: 'United Arab Emirates', 'Capsule Tags': ['Indv groceries'] } },
  { id: 'c2', fields: { 'Client Name': 'Opted Out', Email: 'out@example.com', Status: 'Active', Country: 'Jordan', 'Capsule Tags': ['No Mailing', 'Indv groceries'] } },
  { id: 'c3', fields: { 'Client Name': 'Same Address', Email: 'ANVAR@example.ae,', Status: 'Active', Country: 'Jordan', 'Capsule Tags': ['Indv groceries'] } },
  { id: 'c4', fields: { 'Client Name': 'Out Of Region', Email: 'fr@example.com', Status: 'Active', Country: 'France', 'Capsule Tags': ['Indv groceries'] } },
  { id: 'c5', fields: { 'Client Name': 'Dormant', Email: 'old@example.com', Status: 'Inactive', Country: 'Jordan', 'Capsule Tags': ['Indv groceries'] } },
  { id: 'c6', fields: { 'Client Name': 'Blank Country', Email: 'blank@example.com', Status: 'Active', Country: '', 'Capsule Tags': ['Indv groceries'] } },
  { id: 'c7', fields: { 'Client Name': 'US Buyer', Email: 'us@example.com', Status: 'Active', Country: 'United States', 'Capsule Tags': ['Indv groceries'] } },
];
const recipientsFor = (gateItems, clients = CLIENTS) =>
  runNode('build-recipients.js', dollar({ 'Gate Check': gateItems }), inputOf(clients))[0].json;

check('21. client filters: No Mailing, dormant, wrong country, duplicate (even with a trailing comma)', () => {
  const g = [gateItem('rec1', OFFER({ 'Target Capsule Tags': 'Indv groceries', 'Target Countries': 'UAE, Jordan' }))];
  const out = recipientsFor(g);
  eq(out.recipientCount, 1, 'only Anvar remains');
  eq(out.suppressedNoMailing, 1, 'No Mailing suppressed');
  eq(out.recipients[0].email, 'anvar@example.ae', 'email normalised');
});

check('22. Excluded Countries removes United States when the offer says USA, never a blank country', () => {
  const g = [gateItem('rec1', OFFER({ 'Target Capsule Tags': 'Indv groceries', 'Excluded Countries': 'USA' }))];
  const out = recipientsFor(g);
  eq(out.recipients.some((r) => r.email === 'us@example.com'), false, 'US buyer excluded');
  eq(out.recipients.some((r) => r.email === 'blank@example.com'), true, 'blank country kept');
  eq(out.suppressedExcludedCountry, 1, 'one exclusion counted');
});

check('23. with several groups queued the oldest Offer Date is chosen and the rest are named', () => {
  const g = [
    gateItem('recNew', OFFER({ 'Offer Date': '2026-09-01', 'Public Product Description': 'Newer' })),
    gateItem('recOld', OFFER({ 'Offer Date': '2026-08-20', 'Public Product Description': 'Older', 'Target Capsule Tags': 'Indv groceries' })),
  ];
  const out = recipientsFor(g);
  eq(out.offerId, 'recOld', 'oldest first');
  eq(out.deferredGroups.length, 1, 'the newer one is deferred');
});

// ── Render HTML → Verify HTML round trip ────────────────────────────────────
console.log('\nRender HTML + Verify HTML\n');

const verifyFor = (composed, gateItems, rendered) =>
  runNode('verify-html.js', dollar({ 'Compose Email': [composed], 'Gate Check': gateItems }), inputOf([rendered]))[0].json;
const renderFor = (composed) => runNode('render-html.js', dollar({ 'Compose Email': [composed] }), inputOf([{}]))[0].json;

const SCENARIOS = [
  ['mixed-warehouse bundle', FOUR, FOUR.map((g) => g.offerId)],
  ['same-warehouse bundle', SAME_WAREHOUSE, SAME_WAREHOUSE.map((g) => g.offerId)],
  ['single offer', [gateItem('rec1', OFFER())], ['rec1']],
  ['shared lead time + note', [
    gateItem('rec1', OFFER({ ...BUNDLE_FIELDS, 'Lead Time': '2 weeks', 'Public Note': 'Pallet-ready, English & French labels — "as is"' })),
    gateItem('rec2', OFFER({ ...BUNDLE_FIELDS, 'Public Product Description': 'Eristoff Vodka', 'Lead Time': '2 weeks' })),
  ], ['rec1', 'rec2']],
  ['grocery fixture from the 2026-08-17 dispatch', fixtureGate('bundle-with-restating-note.json'), null],
  ['spirits fixture from the 2026-08-14 dispatch', fixtureGate('bundle-unit-priced.json'), null],
];

function fixtureGate(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'n8n', 'fixtures', name), 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.offers || raw.gate || []);
  return arr.map((o, i) => o.gatePassed !== undefined ? o : gateItem(o.id || `recF${i}`, o.fields || o));
}

for (const [label, gate, ids] of SCENARIOS) {
  check(`24. deterministic HTML passes Verify HTML verbatim — ${label}`, () => {
    const composed = compose(gate, ids || gate.map((g) => g.offerId));
    assert(composed.composed, `fixture should compose: ${composed.haltReason}`);
    const rendered = renderFor(composed);
    assert(typeof rendered.content === 'string' && rendered.content.startsWith('<!DOCTYPE html>'), 'renders an HTML document');
    const v = verifyFor(composed, gate, rendered);
    eq(v.htmlStatus, 'OK — HTML verified verbatim against the approved text.', `verify must pass, got: ${v.htmlStatus}`);
    assert(v.html && v.html.includes('{{{FIRST_NAME|there}}}'), 'FIRST_NAME token survives for Build Sends');
    eq(renderFor(composed).content, rendered.content, 'same input, same output');
  });
}

check('25. Verify HTML still falls back to text when the renderer fails or is missing', () => {
  const composed = compose(SAME_WAREHOUSE, SAME_WAREHOUSE.map((g) => g.offerId));
  const v1 = verifyFor(composed, SAME_WAREHOUSE, { error: 'Bad request - please check your parameters' });
  assert(/FALLBACK/.test(v1.htmlStatus) && v1.html === null, 'error input -> text-only');
  const v2 = verifyFor(composed, SAME_WAREHOUSE, { content: '<p>Hi {{{FIRST_NAME|there}}}, Bombay Sapphire Gin — best price 5568</p>' });
  assert(/introduced number/.test(v2.htmlStatus), 'an invented number is rejected');
  const v3 = verifyFor(composed, SAME_WAREHOUSE, { content: '<p>Hi {{{FIRST_NAME|there}}}, Bombay &middot; Gin</p>' });
  assert(/introduced word|dropped number/.test(v3.htmlStatus), 'an entity the text does not carry is rejected');
});

check('26. rendered HTML carries no link, image, script or handler of its own', () => {
  const composed = compose(FOUR, FOUR.map((g) => g.offerId));
  const html = renderFor(composed).content;
  eq(/href=/i.test(html), false, 'no links');
  eq(/<img/i.test(html), false, 'no images');
  eq(/<script|onclick|onload/i.test(html), false, 'no scripts or handlers');
  assert(html.includes('Bombay Sapphire Gin') && html.includes('EUR 109.20/case (12pk) · EUR 9.10/unit'), 'product and price present');
  assert(html.includes('&quot;unsubscribe&quot;'), 'quotes are HTML-escaped');
});

// ── Build Sends ─────────────────────────────────────────────────────────────
console.log('\nBuild Sends\n');

const RECIPS = { recipientCount: 2, recipients: [
  { clientId: 'cA', clientName: 'Anvar P Y', email: 'anvar@example.ae', firstName: 'Anvar' },
  { clientId: 'cB', clientName: 'Sales', email: 'sales@example.com', firstName: '' },
] };

check('27. every send carries a unique, stable Idempotency-Key and a plain-text body', () => {
  const composed = compose(FOUR, FOUR.map((g) => g.offerId));
  const verified = verifyFor(composed, FOUR, renderFor(composed));
  const sends = runNode('build-sends.js', dollar({ 'Build Recipients': [RECIPS], 'Verify HTML': [verified] }), inputOf([{}]));
  eq(sends.length, 2, 'one item per recipient');
  eq(sends[0].json.idempotencyKey, 'dispatch:rec1:cA', 'key = first offer id + client id');
  eq(sends[1].json.idempotencyKey, 'dispatch:rec1:cB', 'stable per client');
  const again = runNode('build-sends.js', dollar({ 'Build Recipients': [RECIPS], 'Verify HTML': [verified] }), inputOf([{}]));
  eq(again[0].json.idempotencyKey, sends[0].json.idempotencyKey, 'same run, same key -> a retry cannot double-deliver');
  assert(sends[0].json.payload.text.startsWith('Hi Anvar,'), 'first name resolved in text');
  assert(sends[1].json.payload.text.startsWith('Hi there,'), 'generic mailbox falls back to "there"');
  assert(sends[0].json.payload.html && sends[0].json.payload.html.includes('Hi Anvar,'), 'first name resolved in HTML');
  eq('bcc' in sends[0].json.payload, false, 'no bcc');
  eq(sends[0].json.payload.headers['List-Unsubscribe'], '<mailto:offers@akay.ie?subject=unsubscribe>', 'unsubscribe header');
});

check('28. when Verify HTML fell back, the payload has no html key but still a full text body', () => {
  const composed = compose(SAME_WAREHOUSE, SAME_WAREHOUSE.map((g) => g.offerId));
  const verified = verifyFor(composed, SAME_WAREHOUSE, { error: 'credit balance is too low' });
  const sends = runNode('build-sends.js', dollar({ 'Build Recipients': [RECIPS], 'Verify HTML': [verified] }), inputOf([{}]));
  eq('html' in sends[0].json.payload, false, 'no html key');
  assert(sends[0].json.payload.text.includes('Bombay Sapphire Gin'), 'text body complete');
});

// ── Claim Dispatch Group / Fail Loudly on Halt ──────────────────────────────
console.log('\nClaim + Halt reporting\n');

check('29. Claim Dispatch Group unticks every member of the chosen group', () => {
  const out = runNode('claim-dispatch-group.js', dollar({ 'Build Recipients': [{ offerId: 'rec1', bundleOfferIds: ['rec1', 'rec2', 'rec3'] }] }), inputOf([{}]));
  eq(out.map((i) => i.json.id).join(','), 'rec1,rec2,rec3', 'all bundle members');
  assert(out.every((i) => i.json['Queued for Dispatch'] === false), 'flag set to false');
  let threw = false;
  try { runNode('claim-dispatch-group.js', dollar({ 'Build Recipients': [{ recipientCount: 0 }] }), inputOf([{}])); } catch (e) { threw = /refusing/.test(e.message); }
  assert(threw, 'refuses when there is nothing to claim');
});

const haltError = (byNode) => { try { runNode('fail-loudly-on-halt.js', dollar(byNode), inputOf([{}])); } catch (e) { return e.message; } return ''; };

check('30. a declined approval is reported as such, not as "no reason recorded"', () => {
  const msg = haltError({ 'Halt — Report Reason': [{ data: { approved: false, respondedAt: '2026-09-01T09:31:53.240Z' } }],
    'Await Approval': [{ data: { approved: false, respondedAt: '2026-09-01T09:31:53.240Z' } }],
    'Build Recipients': [{ offerId: 'recSG', bundleOfferIds: ['recSG', 'recSG2'] }] });
  assert(/Approval DECLINED/.test(msg), `expected a decline, got: ${msg}`);
  assert(/recSG, recSG2/.test(msg), 'names the offers from Build Recipients');
  assert(/sent nothing/.test(msg), 'says nothing was sent');
});

check('31. an all-failed send names the Resend 401 and points at the credential', () => {
  const rows = [1, 2].map((i) => ({ 'Dispatch Status': 'Failed', Notes: 'Send failed: 401 - {"statusCode":401,"name":"validation_error","message":"API key is invalid"}',
    _summary: 'Dispatch INCOMPLETE — 0 sent of 2 expected, 2 failed. Status left as Live so the offer stays in Ready to Send and can be retried.', _offerIds: ['recH'], _offerId: 'recH' }));
  const msg = haltError({ 'Halt — Report Reason': rows.map((r) => ({ id: 'recLog' + Math.random(), ...r, _summary: undefined })), 'Await Approval': [{ data: { approved: true } }], 'Reconcile': rows });
  assert(/API key is invalid/.test(msg), `expected the 401 text, got: ${msg}`);
  assert(/Bearer Auth account/.test(msg), 'points at the credential to fix');
  assert(/sent nothing/.test(msg), '0 sent reads as nothing sent');
});

check('32. a partial send says emails WERE sent', () => {
  const rows = [
    { 'Dispatch Status': 'Sent', Notes: 'Resend message id x', _summary: 'Dispatch INCOMPLETE — 1 sent of 2 expected, 1 failed. Status left as Live so the offer stays in Ready to Send and can be retried.', _offerIds: ['recH'] },
    { 'Dispatch Status': 'Failed', Notes: 'Send failed: 422 - invalid to address', _summary: 'Dispatch INCOMPLETE — 1 sent of 2 expected, 1 failed. Status left as Live so the offer stays in Ready to Send and can be retried.', _offerIds: ['recH'] },
  ];
  const msg = haltError({ 'Halt — Report Reason': [{ id: 'recLog1' }], 'Await Approval': [{ data: { approved: true } }], 'Reconcile': rows });
  assert(/some emails WERE sent/.test(msg), `expected a partial-send message, got: ${msg}`);
  assert(/invalid to address/.test(msg), 'carries the failure text');
});

check('33. a gate halt keeps its own reason', () => {
  const msg = haltError({ 'Halt — Report Reason': [{ offerId: 'recX', gatePassed: false, haltReason: 'Dispatch blocked. Failing condition(s): Status = "Hold"' }] });
  assert(/Status = "Hold"/.test(msg), `expected the gate reason, got: ${msg}`);
});

console.log(`\n${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  console.log('DO NOT paste into n8n.\n');
  process.exit(1);
}
console.log('Safe to paste into the n8n Code nodes.\n');
