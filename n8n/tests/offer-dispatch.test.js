/**
 * Offer Dispatch — Akay (workflow dAYMAj6mZD3hTV4T)
 *
 * Loads and EXECUTES the node sources in n8n/offer-dispatch/ rather than
 * re-typing their logic, the same harness the trade-terms tests use, so the
 * files here and the text pasted into n8n cannot drift.
 *
 * An n8n Code node is a function BODY, and these nodes reach for the `$(name)`
 * helper and `$input`, so each is wrapped as new Function('$input','$','$execution', src).
 *
 * Nothing here touches the live catalogue: the offers, clients and Resend
 * responses are all fixtures defined in this file.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'offer-dispatch');

function load(file) {
  const src = readFileSync(join(SRC, file), 'utf8');
  const fn = new Function('$input', '$', '$execution', src);
  return (input, nodes = {}, execution = {}) => {
    const $input = {
      all: () => input.map((json) => ({ json })),
      first: () => ({ json: input[0] }),
      item: { json: input[0] },
    };
    const $ = (name) => {
      if (!(name in nodes)) throw new Error(`test: node "${name}" not stubbed`);
      const items = nodes[name].map((json) => ({ json }));
      return { all: () => items, first: () => items[0] };
    };
    return fn($input, $, execution);
  };
}

const gateCheck = load('gate-check.js');
const buildSends = load('build-sends.js');
const reconcile = load('reconcile.js');
const composeFromFields = load('compose-from-fields.js');

let passes = 0;
function ok(name, fn) {
  try {
    fn();
    passes++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL  ' + name + '\n        ' + e.message);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- fixtures

const liveOffer = (id, name, over = {}) => ({
  id,
  fields: {
    'Offer Name': name,
    'Status': 'Live',
    'Is Expired': 'No',
    'Do Not Broadcast': false,
    'Offer Approval Status': 'Approved',
    'Send Eligible': 'Yes',
    'Public Product Description': name,
    'Price Per Unit & Case': 'EUR 12.80/case',
    ...over,
  },
});

const recipient = (n) => ({
  clientId: 'rec' + String(n).padStart(14, '0'),
  clientName: 'Client ' + n,
  email: 'client' + n + '@example.com',
  country: 'Ireland',
  firstName: 'Ann',
});

const verifiedEmail = {
  composed: true,
  offerId: 'recOFFER0000000001',
  bundleOfferIds: ['recOFFER0000000001'],
  subject: 'New Offer: Perrier — Limited Availability',
  bodyTemplate: 'Hi {{{FIRST_NAME|there}}},\n\nPrice: EUR 12.80/case\n\nunsubscribe',
  html: '<p>Hi {{{FIRST_NAME|there}}},</p>',
  listUnsubscribe: 'mailto:offers@akay.ie?subject=unsubscribe',
};

const recipientsNodeFor = (n) => ({
  offerId: 'recOFFER0000000001',
  bundleOfferIds: ['recOFFER0000000001'],
  recipientCount: n,
  recipients: Array.from({ length: n }, (_, i) => recipient(i + 1)),
});

// ------------------------------------------------------- Gate Check: partition

console.log('\nGate Check — partitions instead of killing the run');

ok('a failing offer no longer stops the passing ones', () => {
  const out = gateCheck([
    liveOffer('recGOOD000000001', 'Good offer'),
    liveOffer('recBAD0000000001', 'Expired offer', { 'Is Expired': 'Yes', 'Send Eligible': 'No' }),
    liveOffer('recGOOD000000002', 'Second good offer'),
  ]);
  const json = out.map((i) => i.json);
  assert.strictEqual(json.length, 2, 'both passing offers should survive');
  assert.ok(json.every((j) => j.gatePassed === true));
  assert.deepStrictEqual(json.map((j) => j.offerId), ['recGOOD000000001', 'recGOOD000000002']);
  assert.strictEqual(json[0].skippedOffers.length, 1);
  assert.strictEqual(json[0].skippedOffers[0].offerName, 'Expired offer');
});

ok('halts only when nothing passes, naming every failure at once', () => {
  const out = gateCheck([
    liveOffer('recBAD0000000001', 'Expired', { 'Is Expired': 'Yes', 'Send Eligible': 'No' }),
    liveOffer('recBAD0000000002', 'Unapproved', { 'Offer Approval Status': 'Pending', 'Send Eligible': 'No' }),
  ]);
  assert.strictEqual(out.length, 1);
  const j = out[0].json;
  assert.strictEqual(j.gatePassed, false);
  assert.ok(/Expired/.test(j.haltReason) && /Unapproved/.test(j.haltReason),
    'both offers must appear in one halt reason, got: ' + j.haltReason);
  assert.deepStrictEqual(j.bundleOfferIds, ['recBAD0000000001', 'recBAD0000000002'],
    'Untick Queue on Halt reads bundleOfferIds');
});

ok('a clean queue passes every offer through', () => {
  const out = gateCheck([liveOffer('recA00000000001', 'A'), liveOffer('recB00000000001', 'B')]);
  assert.strictEqual(out.length, 2);
  assert.ok(out.every((i) => i.json.gatePassed === true));
  assert.deepStrictEqual(out[0].json.skippedOffers, []);
});

// ------------------------------------------------- Build Sends: 100-per-batch

console.log('\nBuild Sends — chunks into Resend batches of 100');

ok('2412 recipients become 25 batches, not 2412 requests', () => {
  const out = buildSends([], {
    'Build Recipients': [recipientsNodeFor(2412)],
    'Verify HTML': [verifiedEmail],
  });
  assert.strictEqual(out.length, 25, 'expected ceil(2412/100) batches');
  assert.strictEqual(out[0].json.payload.length, 100);
  assert.strictEqual(out[24].json.payload.length, 12, '2412 = 24*100 + 12');
  assert.strictEqual(out.reduce((n, i) => n + i.json.payload.length, 0), 2412);
});

ok('payload is the bare array Resend wants, one recipient per message', () => {
  const out = buildSends([], {
    'Build Recipients': [recipientsNodeFor(3)],
    'Verify HTML': [verifiedEmail],
  });
  const payload = out[0].json.payload;
  assert.ok(Array.isArray(payload));
  assert.strictEqual(payload.length, 3);
  for (const msg of payload) {
    assert.deepStrictEqual(Object.keys(msg).sort(), ['from', 'headers', 'html', 'subject', 'text', 'to'].sort());
    assert.strictEqual(msg.to.length, 1, 'one recipient per message — never cc/bcc');
    assert.ok(!('attachments' in msg), '/emails/batch does not support attachments');
    assert.strictEqual(msg.headers['List-Unsubscribe'], '<mailto:offers@akay.ie?subject=unsubscribe>');
  }
});

ok('FIRST_NAME is substituted and no placeholder escapes', () => {
  const out = buildSends([], {
    'Build Recipients': [recipientsNodeFor(1)],
    'Verify HTML': [verifiedEmail],
  });
  const msg = out[0].json.payload[0];
  assert.ok(msg.text.startsWith('Hi Ann,'), 'got: ' + msg.text.slice(0, 20));
  assert.ok(!/\{\{\{/.test(msg.text + msg.subject + msg.html));
});

ok('members stay index-aligned with payload — the whole basis of Reconcile', () => {
  const out = buildSends([], {
    'Build Recipients': [recipientsNodeFor(250)],
    'Verify HTML': [verifiedEmail],
  });
  for (const item of out) {
    const { payload, members } = item.json;
    assert.strictEqual(payload.length, members.length);
    payload.forEach((msg, i) => assert.strictEqual(msg.to[0], members[i].clientEmail));
  }
});

ok('idempotency keys are unique per batch, stable per content, <=256 chars', () => {
  const nodes = { 'Build Recipients': [recipientsNodeFor(250)], 'Verify HTML': [verifiedEmail] };
  const a = buildSends([], nodes).map((i) => i.json.idempotencyKey);
  const b = buildSends([], nodes).map((i) => i.json.idempotencyKey);
  assert.deepStrictEqual(a, b, 'a re-run of the same content must reuse keys so Resend dedupes');
  assert.strictEqual(new Set(a).size, a.length, 'keys must not collide across batches');
  assert.ok(a.every((k) => k.length <= 256 && /^[A-Za-z0-9:@._+-]+$/.test(k)));

  const edited = buildSends([], {
    'Build Recipients': [recipientsNodeFor(250)],
    'Verify HTML': [{ ...verifiedEmail, bodyTemplate: verifiedEmail.bodyTemplate + ' price corrected' }],
  }).map((i) => i.json.idempotencyKey);
  assert.ok(edited.every((k, i) => k !== a[i]),
    'edited body must produce new keys, or Resend would replay the old send for 24h');
});

ok('halts, rather than sending, when there is nothing to send', () => {
  const none = buildSends([], {
    'Build Recipients': [{ ...recipientsNodeFor(0) }],
    'Verify HTML': [verifiedEmail],
  });
  assert.strictEqual(none[0].json.halt, true);

  const uncomposed = buildSends([], {
    'Build Recipients': [recipientsNodeFor(5)],
    'Verify HTML': [{ composed: false, haltReason: 'required field empty' }],
  });
  assert.strictEqual(uncomposed[0].json.halt, true);
  assert.strictEqual(uncomposed[0].json.haltReason, 'required field empty');
});

// ------------------------------------------------- Reconcile: batch unpacking

console.log('\nReconcile — maps batched message ids back to clients');

function runSend(n) {
  return buildSends([], {
    'Build Recipients': [recipientsNodeFor(n)],
    'Verify HTML': [verifiedEmail],
  }).map((i) => i.json);
}

ok('a fully successful 250-recipient send reconciles to 250 Sent rows', () => {
  const sends = runSend(250);
  const responses = sends.map((s) => ({ data: s.members.map((m, i) => ({ id: 'msg-' + m.clientId + '-' + i })) }));
  const out = reconcile(responses, { 'Build Recipients': [recipientsNodeFor(250)], 'Build Sends': sends });
  assert.strictEqual(out.length, 250);
  assert.ok(out.every((i) => i.json['Dispatch Status'] === 'Sent'));
  assert.strictEqual(out[0].json._sent, 250);
  assert.strictEqual(out[0].json._failed, 0);
  assert.strictEqual(out[0].json._markBroadcasted, true);
});

ok('message ids attach to the right client (documented index alignment)', () => {
  const sends = runSend(120);
  const responses = sends.map((s) => ({ data: s.members.map((m) => ({ id: 'id-for-' + m.clientEmail })) }));
  const out = reconcile(responses, { 'Build Recipients': [recipientsNodeFor(120)], 'Build Sends': sends });
  for (const item of out) {
    assert.strictEqual(item.json['Notes'], 'Resend message id id-for-' + item.json['Client Email Cache']);
  }
});

ok('one failed batch marks all 100 of its members Failed, not the whole run', () => {
  const sends = runSend(250);
  const responses = sends.map((s, b) => (b === 1
    ? { error: { message: 'rate_limit_exceeded' } }
    : { data: s.members.map((m, i) => ({ id: 'msg-' + b + '-' + i })) }));
  const out = reconcile(responses, { 'Build Recipients': [recipientsNodeFor(250)], 'Build Sends': sends });
  assert.strictEqual(out.length, 250);
  const failed = out.filter((i) => i.json['Dispatch Status'] === 'Failed');
  assert.strictEqual(failed.length, 100);
  assert.ok(/rate_limit_exceeded/.test(failed[0].json['Notes']));
  assert.strictEqual(out[0].json._sent, 150);
  assert.strictEqual(out[0].json._markBroadcasted, false, 'a partial send must not mark Broadcasted');
});

ok('a short data array fails only the unmatched addresses', () => {
  const sends = runSend(100);
  const responses = [{ data: sends[0].members.slice(0, 98).map((m, i) => ({ id: 'msg-' + i })) }];
  const out = reconcile(responses, { 'Build Recipients': [recipientsNodeFor(100)], 'Build Sends': sends });
  assert.strictEqual(out.filter((i) => i.json['Dispatch Status'] === 'Sent').length, 98);
  const failed = out.filter((i) => i.json['Dispatch Status'] === 'Failed');
  assert.strictEqual(failed.length, 2);
  assert.ok(/no result for this address/.test(failed[0].json['Notes']), failed[0].json['Notes']);
});

ok('refuses to write anything if batch and response counts disagree', () => {
  const sends = runSend(250);
  assert.throws(
    () => reconcile([{ data: [] }], { 'Build Recipients': [recipientsNodeFor(250)], 'Build Sends': sends }),
    /Index alignment\s+is unsafe/,
  );
});

ok('Sent Log rows keep the shape Write Sent Log auto-maps', () => {
  const sends = runSend(2);
  const responses = [{ data: [{ id: 'a' }, { id: 'b' }] }];
  const out = reconcile(responses, { 'Build Recipients': [recipientsNodeFor(2)], 'Build Sends': sends });
  const f = out[0].json;
  for (const key of ['Log ID', 'Channel', 'Sent Date', 'Dispatch Status', 'Client Name Cache', 'Client Email Cache', 'Notes', 'Client', 'Offer']) {
    assert.ok(key in f, 'missing Sent Log field ' + key);
  }
  assert.strictEqual(f['Channel'], 'Email');
  assert.deepStrictEqual(f['Offer'], ['recOFFER0000000001']);
});

// ------------------------------------- Compose From Fields: all problems once

console.log('\nCompose From Fields — reports every problem in one halt');

ok('two broken members produce one halt naming both', () => {
  const gate = [
    { gatePassed: true, offerId: 'rec1', offerName: 'No description', offerFields: { 'Offer Name': 'No description', 'Bundle ID': 'B1', 'Price Per Unit & Case': 'EUR 5.00/case' } },
    { gatePassed: true, offerId: 'rec2', offerName: 'Leaky', offerFields: { 'Offer Name': 'Leaky', 'Bundle ID': 'B1', 'Public Product Description': 'Widget from Acme Trading', 'Price Per Unit & Case': 'EUR 5.00/case', 'Supplier Name': 'Acme Trading' } },
  ];
  const out = composeFromFields([], { 'Gate Check': gate, 'Build Recipients': [{ bundleOfferIds: ['rec1', 'rec2'] }] });
  const j = out.json;
  assert.strictEqual(j.composed, false);
  assert.strictEqual(j.problems.length, 2, 'both problems in one halt, got: ' + JSON.stringify(j.problems));
  assert.ok(/required field\(s\) empty on "No description"/.test(j.haltReason), j.haltReason);
  assert.ok(/LEAK GUARD tripped on "Leaky"/.test(j.haltReason), j.haltReason);
});

ok('a clean offer still composes exactly as before', () => {
  const gate = [{
    gatePassed: true, offerId: 'rec1', offerName: 'Perrier',
    offerFields: {
      'Offer Name': 'Perrier', 'Public Product Description': 'Perrier Sparkling Water 24x33cl',
      'Price Per Unit & Case': 'EUR 12.80/case', 'Public Terms': 'CFR China', 'Public Spec': '24 x 330ml',
    },
  }];
  const out = composeFromFields([], { 'Gate Check': gate, 'Build Recipients': [{ bundleOfferIds: ['rec1'] }] });
  const j = out.json;
  assert.strictEqual(j.composed, true, j.haltReason);
  assert.ok(j.subject.includes('Perrier Sparkling Water'));
  assert.ok(j.bodyTemplate.includes('{{{FIRST_NAME|there}}}'));
  assert.ok(j.bodyTemplate.includes('unsubscribe'));
});

console.log('\n' + passes + ' assertions passed' + (process.exitCode ? ' (with failures)' : ''));
