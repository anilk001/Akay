// Halt-path behaviour of the Offer Dispatch workflow (dAYMAj6mZD3hTV4T).
// Runs the mirrored Code-node sources against a tiny stand-in for n8n's $()
// helper. Plain node, no framework:  node n8n/tests/offer-dispatch-halt.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'offer-dispatch');
const failLoudly = fs.readFileSync(path.join(SRC, 'fail-loudly-on-halt.js'), 'utf8');
const untick = fs.readFileSync(path.join(SRC, 'untick-queue-on-halt.js'), 'utf8');

function runNode(source, nodes, inputItems) {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Referenced node "${name}" has not executed`);
    const items = nodes[name].map((json) => ({ json }));
    return { all: () => items, first: () => items[0] };
  };
  const $input = { all: () => inputItems.map((json) => ({ json })) };
  return new Function('$', '$input', source)($, $input);
}

const BUNDLE = ['recA', 'recB', 'recC'];
const DEFERRED = 'recDEFERRED';
const buildRecipients = { offerId: 'recA', bundleOfferIds: BUNDLE, recipientCount: 436 };
const findSendable = [...BUNDLE, DEFERRED].map((id) => ({ id, fields: {} }));
const waitDeclined = { query: { signature: 'x', approved: 'false' }, body: {} };
const waitExpired = { id: 'resend-msg-id' }; // Wait passes its input through on timeout
const waitApproved = { query: { signature: 'x', approved: 'true' }, body: {} };

function haltMessage(nodes, haltItems) {
  try { runNode(failLoudly, nodes, haltItems); }
  catch (e) { return e.message; }
  throw new Error('Fail Loudly on Halt must always throw');
}

// 1. Approval declined -----------------------------------------------------
{
  const nodes = {
    'Halt — Report Reason': [waitDeclined],
    'Wait for Approval': [waitDeclined],
    'Build Recipients': [buildRecipients],
    'Find Sendable Offers': findSendable,
  };
  const cleared = runNode(untick, nodes, [waitDeclined]).map((i) => i.json.id).sort();
  assert.deepStrictEqual(cleared, [...BUNDLE].sort(), 'declining must untick only the claimed bundle');
  assert(!cleared.includes(DEFERRED), 'a deferred group must stay queued');

  const msg = haltMessage(nodes, [waitDeclined]);
  assert(/HALTED and sent nothing/.test(msg), msg);
  assert(/DECLINED/.test(msg), 'must name the decline: ' + msg);
  assert(!/no reason recorded/.test(msg), msg);
  for (const id of BUNDLE) assert(msg.includes(id), 'must list ' + id);
  assert(!msg.includes(DEFERRED), 'must not list the deferred offer');
  console.log('ok  declined approval: reason named, only claimed bundle unticked');
}

// 2. Approval window expired ------------------------------------------------
{
  const nodes = {
    'Halt — Report Reason': [waitExpired],
    'Wait for Approval': [waitExpired],
    'Build Recipients': [buildRecipients],
    'Find Sendable Offers': findSendable,
  };
  const cleared = runNode(untick, nodes, [waitExpired]).map((i) => i.json.id).sort();
  assert.deepStrictEqual(cleared, [...BUNDLE].sort());
  const msg = haltMessage(nodes, [waitExpired]);
  assert(/expired/.test(msg), 'must name the expiry: ' + msg);
  assert(/sent nothing/.test(msg), msg);
  console.log('ok  expired approval: reason named, only claimed bundle unticked');
}

// 3. Post-send incomplete (one Resend failure) ------------------------------
{
  const rows = [
    { 'Dispatch Status': 'Sent', Notes: 'Resend message id 1', _summary: 'Dispatch INCOMPLETE — 435 sent of 436 expected, 1 failed. Status left as Live so the offer stays in Ready to Send and can be retried.', _offerId: 'recA', _offerIds: BUNDLE },
    { 'Dispatch Status': 'Failed', Notes: 'Send failed: 422 Invalid `to` field', _summary: 'Dispatch INCOMPLETE — 435 sent of 436 expected, 1 failed. Status left as Live so the offer stays in Ready to Send and can be retried.', _offerId: 'recA', _offerIds: BUNDLE },
  ];
  const nodes = {
    'Halt — Report Reason': rows,
    'Wait for Approval': [waitApproved],
    'Reconcile': rows,
    'Build Recipients': [buildRecipients],
    'Find Sendable Offers': findSendable,
  };
  const cleared = runNode(untick, nodes, rows).map((i) => i.json.id).sort();
  assert.deepStrictEqual(cleared, [...BUNDLE].sort());
  const msg = haltMessage(nodes, rows);
  assert(/INCOMPLETE — some emails WERE sent/.test(msg), msg);
  assert(/422 Invalid/.test(msg), 'must surface the first failure: ' + msg);
  assert(!/DECLINED|expired/.test(msg), 'an approved run must not be reported as declined: ' + msg);
  console.log('ok  post-send incomplete: summary and first failure surfaced');
}

// 4. Resend 401 on every send names the right credential --------------------
{
  const summary = 'Dispatch INCOMPLETE — 0 sent of 2 expected, 2 failed. Status left as Live so the offer stays in Ready to Send and can be retried.';
  const rows = [1, 2].map(() => ({ 'Dispatch Status': 'Failed', Notes: 'Send failed: 401 - API key is invalid', _summary: summary, _offerId: 'recA', _offerIds: ['recA'] }));
  const nodes = { 'Halt — Report Reason': rows, 'Wait for Approval': [waitApproved], 'Reconcile': rows, 'Build Recipients': [buildRecipients], 'Find Sendable Offers': findSendable };
  const msg = haltMessage(nodes, rows);
  assert(/"Resend API Key" credential/.test(msg), 'must point at the credential actually in use: ' + msg);
  assert(!/Bearer Auth account/.test(msg), msg);
  assert(/sent nothing/.test(msg), msg);
  console.log('ok  401 on every send: points at the Resend API Key credential');
}

// 5. Pre-approval halt (gate failed) keeps its own reason -------------------
{
  const gateHalt = { offerId: 'recA', gatePassed: false, haltReason: 'Dispatch blocked. Failing condition(s): Status = "Draft"' };
  const nodes = { 'Halt — Report Reason': [gateHalt], 'Find Sendable Offers': findSendable };
  const cleared = runNode(untick, nodes, [gateHalt]).map((i) => i.json.id);
  assert.deepStrictEqual(cleared, ['recA']);
  const msg = haltMessage(nodes, [gateHalt]);
  assert(/Status = "Draft"/.test(msg), msg);
  console.log('ok  gate halt: own reason preserved, only that offer unticked');
}

console.log('\nall offer-dispatch halt tests passed');
