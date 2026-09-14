/**
 * Tests for the deployed "Resolve Supplier" node shared by the Excel and
 * PDF/Image ingestion pipelines.
 *
 * The node source is LOADED AND EXECUTED with a fake `$`, so what is asserted
 * here is the text pasted into both workflows.
 *
 * The cases are issues 4 and 5 as data, plus the failure mode that reading the
 * whole email body introduces: a forwarded message carries CC lists and other
 * people's signatures, and creating a supplier from one of those would be a
 * worse outcome than creating none.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'supplier-resolver', 'email-resolve-supplier.js');
const nodeFn = new Function('$', 'console', readFileSync(SRC, 'utf8'));

const SUPPLIERS = [
  sup('recHAL1', 'Halitlar Gida Ltd', 'sales5@halitlar.com', { 'Default Validity Days': 21, 'Default Currency': 'USD' }),
  sup('recHAL2', 'Halitlar Gida', 'export@halitlar.com'),
  sup('recHAL3', 'HALITLAR GIDA LTD', 'mehmet@halitlar.com'),
  sup('recJAVA', 'Java Distri B.V.', 'info@javadistri.nl'),
  sup('recEZAT', 'EZATA Drinks', 'yael@ezata-drinks.co.il'),
  sup('recNEWP', 'Newport Global', 'a@shared-host.com'),
  sup('recPIKA', 'Pika Trading', 'b@shared-host.com'),
];

function sup(id, name, email, extra = {}) {
  return { id, fields: { 'Supplier Name': name, Email: email, Status: 'Active', ...extra } };
}

/**
 * Fake n8n `$`. `metaNode` chooses which pipeline is being simulated:
 * 'Read Workbook' is Excel, 'Parse Offers' is PDF.
 */
function run({ meta = {}, body = '', suppliers = SUPPLIERS, metaNode = 'Read Workbook', triggerNode = 'Gmail Trigger' } = {}) {
  const nodes = {
    'Fetch Suppliers': suppliers.map((json) => ({ json })),
    [metaNode]: [{ json: meta }],
    [triggerNode]: [{ json: { id: meta.sourceMessageId || 'msg1', text: body } }],
  };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`no node "${name}"`);
    return { first: () => nodes[name][0], all: () => nodes[name] };
  };
  return nodeFn($, { log: () => {} })[0].json;
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(t) { console.log(`\n--- ${t} ---`); }

section('The contract Merge Supplier reads is unchanged');

let r = run({ meta: { fromAddress: 'sales5@halitlar.com', sourceMessageId: 'm1' } });
check('existingSupplierId', r.existingSupplierId, 'recHAL1');
check('existingSupplierName', r.existingSupplierName, 'Halitlar Gida Ltd');
check('existingValidityDays carried through', r.existingValidityDays, 21);
check('existingDefaultCurrency carried through', r.existingDefaultCurrency, 'USD');
check('needCreate false', r.needCreate, false);

section('Issue 4 — a colleague at a known supplier is not a new supplier');

r = run({ meta: { fromAddress: 'ahmet@halitlar.com', senderName: 'Ahmet Yilmaz', sourceMessageId: 'm2' } });
check('resolves to the company, despite THREE contacts on that domain', r.existingSupplierId, 'recHAL1');
check('creates nothing', r.needCreate, false);
check('via names the contact count', /3 contact\(s\) on file/.test(r.via), true);

section('Issue 4 — two real companies on one mail host go to a human');

r = run({ meta: { fromAddress: 'c@shared-host.com', senderName: 'Someone New', sourceMessageId: 'm3' } });
check('not resolved', r.existingSupplierId, null);
check('flagged ambiguous', r.ambiguous, true);
check('both named', r.candidates.sort(), ['Newport Global', 'Pika Trading']);
check('no third record created', r.needCreate, false);
check('via explains it, and lands in the offer Notes', /AMBIGUOUS/.test(r.via), true);

section('Issue 5 — an Outlook forward with no forward marker');

const OUTLOOK = [
  'Hi Anil, please see the offer below.',
  '',
  'From: Yael Dahan <yael@ezata-drinks.co.il>',
  'Sent: Monday 14 September 2026 09:12',
  'To: offers@akay.ie',
  'Subject: September stock list',
  '',
  'Jameson 12x70cl @ EUR 13.50',
].join('\n');

r = run({ meta: { fromAddress: 'offers@akay.ie', envelopeFrom: 'offers@akay.ie', sourceMessageId: 'm4' }, body: OUTLOOK });
check('our own envelope is not the supplier', r.fromAddress, '');
check('the real supplier is found in the body', r.existingSupplierId, 'recEZAT');
check('and it says where from', r.evidenceUsed.includes('address found in the message body'), true);
check('body was actually read', r.bodyRead, true);

section('Issue 5 — a genuinely new supplier, named after the COMPANY');

const NEW_SUPPLIER = [
  'Dear Anil,', 'Please find our September list attached.', '',
  'Best regards,', 'Marco Bianchi', 'Sales Director',
  'Bergamo Beverages S.R.L.', 'marco@bergamo-beverages.it', '+39 035 123456',
].join('\n');

r = run({ meta: { fromAddress: 'offers@akay.ie', senderName: 'Marco Bianchi', sourceMessageId: 'm5' }, body: NEW_SUPPLIER });
check('will be created', r.needCreate, true);
check('named after the company', r.createName, 'Bergamo Beverages S.R.L.');
check('never the person', r.createName === 'Marco Bianchi', false);
check('with the company address', r.createEmail, 'marco@bergamo-beverages.it');

r = run({ meta: { fromAddress: 'orders@vinos-iberia.es', senderName: 'Pedro', sourceMessageId: 'm6' } });
check('no signature: name derived from the domain', r.createName, 'Vinos Iberia');
check('still not the person', r.createName === 'Pedro', false);

section('Reading the whole body must not create a supplier from a CC list');

const TWO_OUTSIDERS = [
  'FYI — forwarding this on.', '',
  'From: Marco <marco@bergamo-beverages.it>',
  'Cc: Klaus Meier <klaus@rheinland-logistik.de>', '',
  'Our September list attached.',
].join('\n');

r = run({ meta: { fromAddress: 'offers@akay.ie', sourceMessageId: 'm7' }, body: TWO_OUTSIDERS });
check('two outside companies in one mail: nothing is created', r.needCreate, false);
check('and it is left for a human', /UNRESOLVED/.test(r.via), true);

const CC_PLUS_STATED = [
  'Our September list attached.', '',
  'Kind regards, Marco',
  'Cc: klaus@rheinland-logistik.de',
].join('\n');

r = run({ meta: { fromAddress: 'marco@bergamo-beverages.it', sourceMessageId: 'm8' }, body: CC_PLUS_STATED });
check('but a STATED external sender still creates, CC or no CC', r.needCreate, true);
check('under its own domain', r.createEmail, 'marco@bergamo-beverages.it');

section('Our own mail never becomes a supplier');

r = run({ meta: { fromAddress: 'offers@akay.ie', envelopeFrom: 'offers@akay.ie', senderName: 'Akay Offers', sourceMessageId: 'm9' }, body: 'No offer here.' });
check('not resolved', r.existingSupplierId, null);
check('nothing created', r.needCreate, false);
check('generic domains never auto-create',
  run({ meta: { fromAddress: 'someone@gmail.com', senderName: 'Someone', sourceMessageId: 'm10' } }).needCreate, false);

section('Both pipelines run the same source');

const EXCEL = run({ meta: { fromAddress: 'ahmet@halitlar.com', sourceMessageId: 'm11' }, metaNode: 'Read Workbook' });
const PDF = run({ meta: { fromAddress: 'ahmet@halitlar.com', sourceMessageId: 'm11' }, metaNode: 'Parse Offers' });
check('Excel (Read Workbook) and PDF (Parse Offers) agree', [EXCEL.existingSupplierId, EXCEL.via], [PDF.existingSupplierId, PDF.via]);

section('The body is matched on message id, not taken blindly');

const nodes = {
  'Fetch Suppliers': SUPPLIERS.map((json) => ({ json })),
  'Read Workbook': [{ json: { fromAddress: 'offers@akay.ie', sourceMessageId: 'mine' } }],
  'Gmail Trigger': [
    { json: { id: 'someone-elses', text: 'From: yael@ezata-drinks.co.il' } },
    { json: { id: 'mine', text: 'From: info@javadistri.nl' } },
  ],
};
const $multi = (n) => { if (!(n in nodes)) throw new Error(n); return { first: () => nodes[n][0], all: () => nodes[n] }; };
r = nodeFn($multi, { log: () => {} })[0].json;
check('a multi-email poll reads THIS mail, not the first one', r.existingSupplierId, 'recJAVA');

section('Missing inputs are never a crash');

const $bare = () => { throw new Error('node not present'); };
r = nodeFn($bare, { log: () => {} })[0].json;
check('no nodes at all: unresolved, nothing created', [r.existingSupplierId, r.needCreate], [null, false]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
