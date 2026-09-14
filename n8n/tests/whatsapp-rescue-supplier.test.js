/**
 * Tests for the WhatsApp "Resolve WA Supplier" rescue node.
 *
 * Issue 6: WhatsApp offers landing with a blank supplier. The phone-only node
 * before it is unchanged; this asserts what the rescue adds, and — just as
 * importantly — everything it must refuse to touch.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'supplier-resolver', 'whatsapp-rescue-supplier.js');
const nodeFn = new Function('$input', '$', 'console', readFileSync(SRC, 'utf8'));

const SUPPLIERS = [
  sup('recHAL1', 'Halitlar Gida Ltd', 'sales5@halitlar.com', { 'Trust Score': 'High', 'Default Validity Days': 21, 'Default Currency': 'USD' }),
  sup('recHAL2', 'Halitlar Gida', 'export@halitlar.com'),
  sup('recJAVA', 'Java Distri B.V.', 'info@javadistri.nl', { 'Trust Score': 'Medium' }),
  sup('recEZAT', 'EZATA Drinks', 'yael@ezata-drinks.co.il'),
  sup('recNEWP', 'Newport Global', 'a@shared-host.com'),
  sup('recPIKA', 'Pika Trading', 'b@shared-host.com'),
  sup('recSKIP', 'Overpriced Traders', 'x@overpriced.com', { 'Skip Offer Ingestion': true }),
  sup('recDEAD', 'Gone Away Ltd', 'y@goneaway.com', { Status: 'Blacklisted' }),
];

function sup(id, name, email, extra = {}) {
  return { id, fields: { 'Supplier Name': name, Email: email, Status: 'Active', ...extra } };
}

/** An item as the phone-only node emits it when it could NOT identify anyone. */
const UNKNOWN = (over = {}) => ({
  waRecordId: 'recWA1', sourceMessageId: 'wamid.1',
  senderNumber: '+90 555 000 0000', senderName: '', messageText: '',
  messageType: 'text', fileName: 'WhatsApp', sheetName: '',
  parseThis: true, supplierKnown: false, supplierRecordId: null,
  exceptionReason: 'No supplier has WhatsApp number +90 555 000 0000 — parsed for review, no Offer created',
  ...over,
});

function run(json, suppliers = SUPPLIERS) {
  const $ = (name) => {
    if (name !== 'Fetch Suppliers') throw new Error(`no node "${name}"`);
    return { all: () => suppliers.map((j) => ({ json: j })) };
  };
  return nodeFn({ item: { json } }, $, { log: () => {} }).json;
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

section('Issue 6 — identity that was sitting in the message all along');

let r = run(UNKNOWN({ senderName: 'Halitlar Gida' }));
check('sender display name identifies the supplier', r.supplierRecordId, 'recHAL1');
check('and it is now known', r.supplierKnown, true);
check('trust comes with it, so approval works as for a phone match', r.supplierTrust, 'High');
check('so does validity', r.supplierValidityDays, 21);
check('and the currency default', r.profileDefaults, { currency: 'USD' });
check('the review reason is cleared', r.exceptionReason, undefined);
check('and it records how', /sender name/.test(r.rescuedVia), true);

check('a group/chat name identifies it',
  run(UNKNOWN({ sheetName: 'Java Distri — Offers' })).supplierRecordId, 'recJAVA');

check('a signature address in the message identifies it',
  run(UNKNOWN({ messageText: 'Jameson 13.50 EUR\n\nYael\nyael@ezata-drinks.co.il' })).supplierRecordId, 'recEZAT');

check('an unknown address on a known company domain identifies it',
  run(UNKNOWN({ messageText: 'Offer attached. ahmet@halitlar.com' })).supplierRecordId, 'recHAL1');

check('a company written out in the message identifies it',
  run(UNKNOWN({ messageText: 'New list below.\nJava Distri B.V.\n\nJameson 13.50' })).supplierRecordId, 'recJAVA');

section('What it must refuse to do');

r = run(UNKNOWN({ senderName: 'Halitlar Gida', supplierKnown: true, supplierRecordId: 'recJAVA', supplierName: 'Java Distri B.V.' }));
check('never overrides a phone match', r.supplierRecordId, 'recJAVA');
check('and does not even run', r.rescueTried, undefined);

r = run(UNKNOWN({ parseThis: false, ingestStatus: 'Duplicate', senderName: 'Halitlar Gida' }));
check('never revives a duplicate', [r.parseThis, r.supplierKnown], [false, false]);

r = run(UNKNOWN({ parseThis: false, ingestStatus: 'Skipped', skipReason: 'Message is a document', senderName: 'Halitlar Gida' }));
check('never revives a skipped message', r.parseThis, false);
check('and keeps its reason', r.skipReason, 'Message is a document');

r = run(UNKNOWN({ messageText: 'Offer from c@shared-host.com' }));
check('two companies on one mail host is not a match', r.supplierKnown, false);
check('both are named for the human', r.rescueCandidates.sort(), ['Newport Global', 'Pika Trading']);
check('and the note says so', /AMBIGUOUS/.test(r.exceptionReason), true);

check('an unrelated company never matches',
  run(UNKNOWN({ senderName: 'Javana Foods' })).supplierKnown, false);
check('a bare legal form never matches',
  run(UNKNOWN({ senderName: 'Ltd' })).supplierKnown, false);
check('our own address is never a supplier',
  run(UNKNOWN({ messageText: 'forwarded by offers@akay.ie' })).supplierKnown, false);

r = run(UNKNOWN({ senderName: 'Unknown Reseller', messageText: 'Jameson 13.50' }));
check('no evidence: stays unknown', r.supplierKnown, false);
check('keeps the original review reason', /No supplier has WhatsApp number/.test(r.exceptionReason), true);
check('it NEVER creates a supplier', 'needCreate' in r, false);

section('A supplier we have stopped trading with stays stopped');

r = run(UNKNOWN({ senderName: 'Overpriced Traders' }));
check('Skip Offer Ingestion is honoured even when identified by name', r.parseThis, false);
check('marked Skipped', r.ingestStatus, 'Skipped');
check('with the reason and how it was identified', /Skip Offer Ingestion is ticked/.test(r.skipReason), true);
check('not marked known — no offer is written', r.supplierKnown, false);

r = run(UNKNOWN({ senderName: 'Gone Away' }));
check('a Blacklisted supplier is not parsed either', r.parseThis, false);
check('and says why', /Status is Blacklisted/.test(r.skipReason), true);

section('The rest of the item is carried through untouched');

r = run(UNKNOWN({ senderName: 'Halitlar Gida', messageText: 'Jameson 13.50' }));
check('WhatsApp record id', r.waRecordId, 'recWA1');
check('source message id', r.sourceMessageId, 'wamid.1');
check('message text', r.messageText, 'Jameson 13.50');
check('the shape nodes 03/04 read', [r.fileName, r.messageType], ['WhatsApp', 'text']);

section('No supplier book is not a crash');

r = run(UNKNOWN({ senderName: 'Halitlar Gida' }), []);
check('stays unknown, nothing thrown', r.supplierKnown, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
