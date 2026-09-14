/**
 * Tests for the "Enforce Offer Invariants" Code node.
 *
 * The node source is LOADED AND EXECUTED rather than re-typed, so the rule the
 * tests assert is the rule pasted into n8n.
 *
 * Cases are the six failures reported on 2026-09-14: offers that never
 * uploaded, margin applied to some rows but not others, expiry missing the
 * same way, Listing Approved arriving ticked, and WhatsApp offers landing with
 * a blank supplier.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'offer-invariants', 'enforce-offer-invariants.js');
const nodeFn = new Function('$input', readFileSync(SRC, 'utf8'));

// The node logs a run summary; keep the test output readable.
const realLog = console.log;
function run(records) {
  const items = (Array.isArray(records) ? records : [records]).map((json) => ({ json }));
  console.log = () => {};
  try { return nodeFn({ all: () => items }).map((i) => i.json); }
  finally { console.log = realLog; }
}
const one = (rec) => run(rec)[0];

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(t) { console.log(`\n--- ${t} ---`); }

/** A record that satisfies every invariant, so each test can break one thing. */
const GOOD = () => ({
  'Product Name': 'Jameson Irish Whiskey',
  'Buy Price': 13.5,
  'Currency': 'EUR',
  'Margin %': 0.05,
  'Supplier': ['recSUPPLIER0000001'],
  'Auto Expiry Days': 30,
  'Status': 'Live',
  'Offer Approval Status': 'Approved',
  'Notes': 'Ingested from a spreadsheet.',
});

const held = (r) => [r.Status, r['Offer Approval Status'], r['Claude Review Status']];
const LIVE = ['Live', 'Approved', undefined];
const HELD = ['Hold', 'Awaiting Approval', 'Pending Review'];

section('A complete offer passes through untouched');

let r = one(GOOD());
check('stays Live', held(r), LIVE);
check('margin untouched', r['Margin %'], 0.05);
check('notes untouched', r.Notes, 'Ingested from a spreadsheet.');

section('Issue 3 — the website gate can never arrive ticked');

r = one({ ...GOOD(), 'Listing Approved': true });
check('Listing Approved is removed, not passed on', 'Listing Approved' in r, false);
check('and the offer is otherwise unharmed', held(r), LIVE);

r = one({ ...GOOD(), 'Send Approval Status': 'Approved' });
check('Gate 2 is removed too', 'Send Approval Status' in r, false);

section('Issue 2 — a missing margin holds the offer rather than publishing at cost');

r = one({ ...GOOD(), 'Margin %': undefined });
check('held', held(r), HELD);
check('reason names the cost-price consequence', /Sell Price would publish at the buy price/.test(r.Notes), true);
check('no margin is invented', r['Margin %'], undefined);

check('empty string margin holds', held(one({ ...GOOD(), 'Margin %': '' })), HELD);
check('null margin holds', held(one({ ...GOOD(), 'Margin %': null })), HELD);
check('zero margin holds — indistinguishable from missing on the site', held(one({ ...GOOD(), 'Margin %': 0 })), HELD);
check('a margin as a string still counts', held(one({ ...GOOD(), 'Margin %': '0.08' })), LIVE);

section('Issue 2 — a missing expiry defaults instead of holding');

r = one({ ...GOOD(), 'Auto Expiry Days': undefined });
check('defaults to 30 days', r['Auto Expiry Days'], 30);
check('stays Live — a shorter life is the safe direction', held(r), LIVE);
check('and says so in Notes', /defaulted to 30 days/.test(r.Notes), true);
check('a stated expiry is never overwritten', one({ ...GOOD(), 'Auto Expiry Days': 7 })['Auto Expiry Days'], 7);

section('Issue 6 — an offer with no supplier is never Live');

r = one({ ...GOOD(), 'Supplier': undefined });
check('held', held(r), HELD);
check('reason states it', /no Supplier link/.test(r.Notes), true);
check('an empty link array holds', held(one({ ...GOOD(), 'Supplier': [] })), HELD);
check('a non-record value holds', held(one({ ...GOOD(), 'Supplier': [''] })), HELD);

section('Issue 1 — read-only fields are stripped before they can error the batch');

r = one({ ...GOOD(), 'Sell Price': 14.18, 'Supplier Name': 'Halitlar', 'Auto Expiry Date': '2026-10-14', 'Public Listing': 'Yes' });
check('Sell Price dropped', 'Sell Price' in r, false);
check('Supplier Name lookup dropped', 'Supplier Name' in r, false);
check('Auto Expiry Date formula dropped', 'Auto Expiry Date' in r, false);
check('Public Listing formula dropped', 'Public Listing' in r, false);
check('Auto Expiry DAYS is writable and survives', r['Auto Expiry Days'], 30);

section('The essentials');

check('no product name holds', held(one({ ...GOOD(), 'Product Name': '' })), HELD);
check('no buy price holds', held(one({ ...GOOD(), 'Buy Price': 0 })), HELD);
check('no currency holds', held(one({ ...GOOD(), 'Currency': '' })), HELD);
check('currency as a select object is read', held(one({ ...GOOD(), 'Currency': { name: 'USD' } })), LIVE);

r = one({ ...GOOD(), 'Margin %': null, 'Supplier': [], 'Currency': '' });
check('every failure is named, not just the first', 
  ['no Currency', 'no Margin', 'no Supplier link'].every((s) => r.Notes.includes(s)), true);

section('Nothing is ever dropped');

const batch = run([GOOD(), { ...GOOD(), 'Margin %': null }, { ...GOOD(), 'Supplier': [] }]);
check('three in, three out', batch.length, 3);
check('the clean one is still Live', held(batch[0]), LIVE);
check('the broken ones are held, not discarded', [held(batch[1]), held(batch[2])], [HELD, HELD]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
