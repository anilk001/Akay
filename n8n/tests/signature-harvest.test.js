/**
 * Tests for the "Harvest Contact Details" Code node.
 *
 * The node source is LOADED AND EXECUTED rather than re-typed, the same harness
 * the trade-terms tests use: an n8n Code node is a function body, so it is
 * wrapped in `new Function('$input', '$', src)`. `$` is stubbed to serve the
 * "Contacts" node. One source of truth — a guard tightened in the node is a
 * guard these tests see.
 *
 * The cases that matter most are the REFUSALS. This node's whole risk is
 * writing one person's details onto another person's row, so most of what
 * follows asserts that nothing was written.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'signature-harvest', 'harvest-contact-details.js');
const body = readFileSync(SRC, 'utf8');
const nodeFn = new Function('$input', '$', body);

/**
 * A Contacts row as Airtable returns it. `fields` is merged over the defaults,
 * so a case only states what it cares about. Merging at the FIELDS level and
 * not the row level matters: an earlier version of this helper merged the
 * override into `json`, which left `fields` on its blank defaults and quietly
 * turned three assertions into tests of nothing.
 */
const DEFAULT_FIELDS = { 'Email': 'john@dutchbev.nl', 'Contact Name': '', 'Company': '', 'Phone (E.164)': '', 'Country': 'Netherlands' };
const contact = (fields, id) => ({
  json: { id: id || 'rec0000000000001', fields: Object.assign({}, DEFAULT_FIELDS, fields || {}) },
});

function run(mails, contacts) {
  const rows = contacts || [contact()];
  const $ = (name) => {
    if (name === 'Contacts') return { all: () => rows };
    throw new Error('unexpected node ' + name);
  };
  const items = (Array.isArray(mails) ? mails : [mails]).map((json) => ({ json }));
  return nodeFn({ all: () => items }, $).map((i) => i.json);
}
const one = (mail, contacts) => run(mail, contacts)[0];

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(t) { console.log(`\n--- ${t} ---`); }

// ── 1. The failure this node exists to prevent ──────────────────────────────
section('Somebody else\'s details are never harvested');

let r = one({
  fromEmail: 'john@dutchbev.nl',
  fromName: 'John de Vries',
  subject: 'Automatic reply: AKAY offers today',
  body: [
    'I am out of the office until 20 September.',
    'In my absence please contact Jane Murphy on +353 87 123 4567.',
    '',
    'Kind regards,',
    'John de Vries',
    'Dutch Beverages B.V.',
  ].join('\n'),
});
check('handover phrase rejects the whole message', r._action, 'skip');
check('  and says why', r.reason, 'handover-phrase');

r = one({
  fromEmail: 'john@dutchbev.nl',
  fromName: 'John de Vries',
  body: 'I have left the company. My replacement is jane@dutchbev.nl\n\nJohn de Vries\nDutch Beverages B.V.\nTel: +31 20 123 4567',
});
check('a colleague address rejects it too', r._action, 'skip');
check('  even on the same domain', r.reason, 'third-party-email');

// ── 2. The sender's own signature IS harvested ──────────────────────────────
section('The sender\'s own details are filled in');

r = one({
  fromEmail: 'john@dutchbev.nl',
  fromName: 'John de Vries',
  subject: 'Automatic reply: AKAY offers today',
  body: [
    'Thank you for your email. I am travelling and will reply on Monday.',
    '',
    'Best regards,',
    'John de Vries',
    'Dutch Beverages B.V.',
    'Mobile: +31 6 1234 5678',
  ].join('\n'),
});
check('proposes an update', r._action, 'update');
check('  onto the matched row', r.id, 'rec0000000000001');
check('  with all three blanks filled', r.fields, {
  'Contact Name': 'John de Vries',
  'Company': 'Dutch Beverages B.V.',
  'Phone (E.164)': '+31612345678',
});

// ── 3. Only blanks. Never an overwrite ──────────────────────────────────────
section('Existing values are never overwritten');

const filled = contact({ 'Contact Name': 'J. de Vries', 'Company': 'Dutch Bev', 'Phone (E.164)': '+31200000000' }, 'rec0000000000002');
r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries',
  body: 'Best regards,\nJohn de Vries\nDutch Beverages B.V.\nMobile: +31 6 1234 5678',
}, [filled]);
check('nothing to do when all three are set', r._action, 'skip');
check('  reason', r.reason, 'nothing-missing');

const partial = contact({ 'Contact Name': 'John de Vries', 'Phone (E.164)': '+31200000000' }, 'rec0000000000003');
r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'Johnny V',
  body: 'Regards,\nJohn de Vries\nDutch Beverages B.V.\nMobile: +31 6 9999 8888',
}, [partial]);
check('only the blank field is written', r.fields, { 'Company': 'Dutch Beverages B.V.' });

// ── 4. Our own address is not a third party ─────────────────────────────────
section('Our own addresses do not trip the guard');

r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries',
  body: [
    'Thank you for your message to offers@akay.ie. I am away until Monday.',
    '',
    'Regards,',
    'John de Vries',
    'Dutch Beverages B.V.',
  ].join('\n'),
});
check('offers@akay.ie is ignored', r._action, 'update');
check('  and the signature still read', r.fields['Company'], 'Dutch Beverages B.V.');

r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries',
  body: [
    'Out of office until Monday.',
    '',
    'Regards,',
    'John de Vries',
    'Dutch Beverages B.V.',
    '',
    'On Mon, 14 Sep 2026 at 07:30, Akay Irl Ltd <offers@akay.ie> wrote:',
    '> Today\'s offers picked for you:',
    '> Reply to this email or contact ak@akay.ie',
  ].join('\n'),
});
check('quoted original is cut off before parsing', r._action, 'update');

// ── 5. Phone numbers: evidence or nothing ──────────────────────────────────
section('Phone numbers resolve on evidence only');

const noCountry = contact({ 'Country': '' }, 'rec0000000000004');
r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries',
  body: 'Regards,\nJohn de Vries\nTel: 020 123 4567',
}, [noCountry]);
check('national number with no country is NOT written', r.fields['Phone (E.164)'], undefined);
check('  but the name still is', r.fields['Contact Name'], 'John de Vries');

r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries',
  body: 'Regards,\nJohn de Vries\nTel: 020 123 4567',
});
check('same number resolves when Country is known', r.fields['Phone (E.164)'], '+31201234567');

const irish = contact({ 'Country': '' }, 'rec0000000000005');
r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'Sean Murphy',
  body: 'Regards,\nSean Murphy\nMobile: 087 2382368',
}, [irish]);
check('a valid Irish mobile is evidence enough', r.fields['Phone (E.164)'], '+353872382368');

r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries',
  body: 'Regards,\nJohn de Vries\nOur VAT number is 8123456789 and order ref 4455667788',
});
check('a bare number in prose is not a phone', r.fields['Phone (E.164)'], undefined);

// ── 6. Company names are read, never invented ──────────────────────────────
section('Company is read from the signature, never from the domain');

r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries',
  body: 'Regards,\nJohn de Vries\nSenior Buyer',
});
check('no company line means no company written', r.fields['Company'], undefined);
check('  the name is still harvested', r.fields['Contact Name'], 'John de Vries');

r = one({
  fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries',
  body: 'Regards,\nJohn de Vries\nSent from my iPhone',
});
check('"Sent from my iPhone" is not a company', r.fields['Company'], undefined);

// ── 7. Senders we do not know ──────────────────────────────────────────────
section('Unknown senders');

r = one({ fromEmail: 'stranger@nowhere.com', fromName: 'A Stranger', body: 'Regards,\nA Stranger\nNowhere Ltd' });
check('no Contacts row means no write', r._action, 'skip');
check('  reason', r.reason, 'no-contact');

r = one({ fromEmail: '', body: 'Regards,\nSomebody' });
check('no sender address at all', r.reason, 'no-sender');

// ── 8. Dry run is the default ──────────────────────────────────────────────
section('Dry run');

r = one({ fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries', body: 'Regards,\nJohn de Vries\nDutch Beverages B.V.' });
check('DEFAULT_DRY_RUN is on until deliberately flipped', r.dryRun, true);
r = one({ fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries', body: 'Regards,\nJohn de Vries\nDutch Beverages B.V.', dryRun: false });
check('per-item override works', r.dryRun, false);

// ── 9. Order and shape ─────────────────────────────────────────────────────
section('Batch shape');

const batch = run([
  { fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries', body: 'Regards,\nJohn de Vries\nDutch Beverages B.V.' },
  { fromEmail: 'stranger@nowhere.com', body: 'hello' },
  { fromEmail: 'john@dutchbev.nl', fromName: 'John de Vries', body: 'please contact my colleague' },
]);
check('one output item per input item', batch.length, 3);
check('order preserved', batch.map((b) => b._action), ['update', 'skip', 'skip']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
