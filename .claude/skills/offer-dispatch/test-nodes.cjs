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
  assert(order.indexOf('Terms') < order.indexOf('Quantity'), 'Terms should precede Quantity');
});

check('2. mixed-warehouse bundle states no single closing Terms line', () => {
  const r = compose(FOUR, FOUR.map((g) => g.offerId));
  const closing = r.bodyTemplate.slice(r.bodyTemplate.indexOf('Campari'));
  eq(/\nTerms: EXW Loendersloot\nValidity/.test(closing), false,
    'a whole-mail Terms line would claim one warehouse for all four lines');
  eq(r.bodyTemplate.includes('Validity: until 18 September 2026, subject to prior sale'), true,
    'validity is still stated once');
});

check('3. same-warehouse bundle is byte identical to the 2026-08-18 baseline', () => {
  const ids = SAME_WAREHOUSE.map((g) => g.offerId);
  const now = compose(SAME_WAREHOUSE, ids);
  const before = composeBaseline(SAME_WAREHOUSE, ids);
  eq(now.subject, before.subject, 'subject drifted for an unchanged scenario');
  eq(now.bodyTemplate, before.bodyTemplate, 'body drifted for an unchanged scenario');
  eq(now.bodyTemplate.includes('Terms: EXW Loendersloot'), true, 'closing Terms line still printed');
  eq(now.bodyTemplate.split('Terms: EXW Loendersloot').length - 1, 1, 'terms stated exactly once');
});

check('4. single offer is byte identical to the baseline', () => {
  const one = [gateItem('rec1', OFFER())];
  const now = compose(one, ['rec1']);
  const before = composeBaseline(one, ['rec1']);
  eq(now.subject, before.subject, 'subject drifted');
  eq(now.bodyTemplate, before.bodyTemplate, 'body drifted');
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

console.log(`\n${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  console.log('DO NOT paste into n8n.\n');
  process.exit(1);
}
console.log('Safe to paste into the Compose Email node.\n');
