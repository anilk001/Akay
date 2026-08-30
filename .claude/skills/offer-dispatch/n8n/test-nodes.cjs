/**
 * Regression tests for the two Code nodes in "Offer Dispatch — Akay".
 *
 *     node test-nodes.cjs        # from this directory
 *
 * Each node body is loaded from its .js file and executed the way n8n does —
 * wrapped in a function and handed `$` and `$input` — so what is tested here is
 * literally what the node runs. Fixtures are the two real dispatches of
 * 2026-08-14 and 2026-08-17 with the supplier name and buy prices replaced.
 *
 * Run this before pasting either file into n8n. There is no way to test the
 * live workflow without emailing real clients, so this is the gate.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const load = (file) => fs.readFileSync(path.join(HERE, file), 'utf8');
const fixture = (name) => JSON.parse(load(path.join('fixtures', name)));

const unitPriced = fixture('bundle-unit-priced.json'); // 3 spirits, Per Bottle, 2026-08-14
const restatingNote = fixture('bundle-with-restating-note.json'); // 2 grocery lines, 2026-08-17

const buildRecipients = new Function('$', '$input', load('build-recipients.js'));
const composeEmail = new Function('$', load('compose-email.js'));

const CLIENTS = [
  { id: 'c1', fields: { 'Client Name': 'Anvar P Y', Email: 'anvar@example.ae', Status: 'Active', Country: 'United Arab Emirates', 'Capsule Tags': ['Indv groceries'] } },
  { id: 'c2', fields: { 'Client Name': 'Opted Out', Email: 'out@example.com', Status: 'Active', Country: 'Jordan', 'Capsule Tags': ['No Mailing', 'Indv groceries'] } },
  { id: 'c3', fields: { 'Client Name': 'Same Address', Email: 'ANVAR@example.ae', Status: 'Active', Country: 'Jordan', 'Capsule Tags': ['Indv groceries'] } },
  { id: 'c4', fields: { 'Client Name': 'Out Of Region', Email: 'fr@example.com', Status: 'Active', Country: 'France', 'Capsule Tags': ['Indv groceries'] } },
  { id: 'c5', fields: { 'Client Name': 'Dormant', Email: 'old@example.com', Status: 'Inactive', Country: 'Jordan', 'Capsule Tags': ['Indv groceries'] } },
];

const recipientsFor = (gateItems, clients = CLIENTS) =>
  buildRecipients(
    () => ({ all: () => gateItems.map((json) => ({ json })) }),
    { all: () => clients.map((json) => ({ json })) }
  )[0].json;

const composeFor = (gateItems, chosenIds) =>
  composeEmail((name) =>
    name === 'Build Recipients'
      ? { first: () => ({ json: { bundleOfferIds: chosenIds } }) }
      : { all: () => gateItems.map((json) => ({ json })) }
  ).json;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── Build Recipients ────────────────────────────────────────────────────────

test('client filters exclude opt-outs, duplicates, wrong region and dormant', () => {
  const out = recipientsFor(restatingNote);
  assert.strictEqual(out.recipientCount, 1, 'only the UAE client with the right tag should remain');
  assert.strictEqual(out.suppressedNoMailing, 1);
  assert.strictEqual(out.excludedCount, 4);
});

test('oldest queued group wins, and the rest are named', () => {
  const out = recipientsFor([...restatingNote, ...unitPriced]);
  assert.ok(out.groupLabel.includes('KKA-SPIRITS'), `chose ${out.groupLabel}`);
  assert.strictEqual(out.bundleOfferIds.length, 3);
  assert.strictEqual(out.deferredGroupCount, 1);
  assert.match(out.summary, /other queued group/);
});

test('group choice does not depend on the order Airtable returned records', () => {
  const a = recipientsFor([...restatingNote, ...unitPriced]);
  const b = recipientsFor([...unitPriced, ...restatingNote]);
  assert.strictEqual(a.groupLabel, b.groupLabel);
});

test('a bundle whose members disagree on the audience halts', () => {
  const broken = JSON.parse(JSON.stringify(unitPriced));
  broken[1].offerFields['Target Countries'] = 'Italy';
  const out = recipientsFor(broken);
  assert.strictEqual(out.halt, true);
  assert.match(out.haltReason, /disagree on Target Countries/);
});

// ── Compose Email ───────────────────────────────────────────────────────────

test('every price states its basis', () => {
  const out = composeFor(unitPriced, unitPriced.map((o) => o.offerId));
  for (const line of out.bodyTemplate.split('\n').filter((l) => l.startsWith('Price: '))) {
    assert.match(line, /\/(bottle|case|carton|can|jar|piece|unit|pack)\b/, `no basis in: ${line}`);
  }
  assert.ok(out.bodyTemplate.includes('EUR 18.25/bottle'));
});

test('MOQ and validity reach the buyer', () => {
  const out = composeFor(restatingNote, restatingNote.map((o) => o.offerId));
  assert.ok(out.bodyTemplate.includes('Minimum order: 1 x 40FT'));
  assert.ok(out.bodyTemplate.includes('Validity: until 16 September 2026'));
});

test('a note that restates the offer is not printed twice', () => {
  const out = composeFor(restatingNote, restatingNote.map((o) => o.offerId));
  assert.ok(out.noteLinesDropped >= 5, `dropped ${out.noteLinesDropped}`);
  const priceMentions = (out.bodyTemplate.match(/30\.24/g) || []).length;
  assert.strictEqual(priceMentions, 1, 'the 400g carton price should appear exactly once');
  assert.ok(out.bodyTemplate.includes('UNLABELLED'), 'genuinely additional note text must survive');
  assert.ok(out.bodyTemplate.includes('Terms: FOB Thailand'), 'terms must still be stated once');
});

test('a note carrying the terms does not duplicate the warehouse name', () => {
  const out = composeFor(unitPriced, unitPriced.map((o) => o.offerId));
  assert.strictEqual((out.bodyTemplate.match(/DAP Loendersloot/g) || []).length, 1);
});

test('a whole-number buy price is not mistaken for a leak', () => {
  // Monkey Shoulder has Buy Price 12 and "12" occurs in pack text; the old guard
  // matched the bare integer and halted the entire dispatch.
  const out = composeFor(unitPriced, unitPriced.map((o) => o.offerId));
  assert.strictEqual(out.composed, true, out.haltReason);
});

test('a real buy-price leak still halts', () => {
  const leaky = JSON.parse(JSON.stringify(restatingNote));
  leaky[0].offerFields['Public Note'] = 'Landed at 28.80 per carton.';
  const out = composeFor(leaky, leaky.map((o) => o.offerId));
  assert.strictEqual(out.composed, false);
  assert.match(out.haltReason, /LEAK GUARD TRIPPED/);
});

test('a supplier name in a public field still halts', () => {
  const leaky = JSON.parse(JSON.stringify(unitPriced));
  leaky[0].offerFields['Public Note'] = 'Held by Example Supplier Ltd in Rotterdam.';
  const out = composeFor(leaky, leaky.map((o) => o.offerId));
  assert.strictEqual(out.composed, false);
  assert.match(out.haltReason, /supplier name/);
});

test('composition follows the group Build Recipients chose', () => {
  const all = [...restatingNote, ...unitPriced];
  const chosen = recipientsFor(all);
  const out = composeFor(all, chosen.bundleOfferIds);
  assert.strictEqual(out.bundleOfferIds.length, 3);
  assert.ok(out.subject.includes('Scotch Whisky & Gin'), out.subject);
  assert.ok(!out.bodyTemplate.includes('Coffee mate'), 'the deferred group must not leak into the mail');
});

test('an empty required field halts rather than shipping a gap', () => {
  const blank = JSON.parse(JSON.stringify(unitPriced));
  blank[0].offerFields['Public Product Description'] = '';
  const out = composeFor(blank, blank.map((o) => o.offerId));
  assert.strictEqual(out.composed, false);
  assert.match(out.haltReason, /required field\(s\) empty/);
});

test('no placeholder other than FIRST_NAME survives', () => {
  const out = composeFor(unitPriced, unitPriced.map((o) => o.offerId));
  const left = out.bodyTemplate.match(/\{\{\{(?!FIRST_NAME)[^}]*\}\}\}/g);
  assert.strictEqual(left, null, `unresolved: ${left}`);
});

// ── run ─────────────────────────────────────────────────────────────────────

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
