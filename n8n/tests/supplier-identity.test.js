/**
 * Tests for the "Resolve Supplier Identity" Code node.
 *
 * The node source is LOADED AND EXECUTED rather than re-typed.
 *
 * The cases are the three reported failures, stated as data:
 *   - a colleague at a supplier we already trade with must NOT become a new
 *     supplier record (issue 4);
 *   - a supplier whose address is in the body of a forward must be found and,
 *     if genuinely new, created under the COMPANY name (issue 5);
 *   - a WhatsApp offer must use the sender name, group name and message text,
 *     not just the phone number (issue 6).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'supplier-resolver', 'resolve-supplier-identity.js');
const nodeFn = new Function('$input', readFileSync(SRC, 'utf8'));

/** The supplier book these tests resolve against. */
const SUPPLIERS = [
  sup('recHAL1', 'Halitlar Gida Ltd', 'sales5@halitlar.com', { WhatsApp: '+90 532 111 2233', 'Trust Score': 'High', 'Default Margin %': 0.07 }),
  sup('recHAL2', 'Halitlar Gida', 'export@halitlar.com'),
  sup('recHAL3', 'HALITLAR GIDA LTD', 'mehmet@halitlar.com'),
  sup('recJAVA', 'Java Distri B.V.', 'info@javadistri.nl', { WhatsApp: '0031612345678' }),
  sup('recEZAT', 'EZATA Drinks', 'yael@ezata-drinks.co.il'),
  sup('recSHARED1', 'Newport Global', 'a@shared-host.com'),
  sup('recSHARED2', 'Pika Trading', 'b@shared-host.com'),
  sup('recGMAIL', 'CSE Ltd', 'cse.offers@gmail.com'),
];

function sup(id, name, email, extra = {}) {
  return { id, fields: { 'Supplier Name': name, Email: email, Status: 'Active', 'Trust Score': 'Medium', ...extra } };
}

function run(evidence, suppliers = SUPPLIERS) {
  const json = { suppliers, evidence };
  return nodeFn({ item: { json } }).json;
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

section('Exact address still wins, as before');

let r = run({ channel: 'email', fromAddress: 'sales5@halitlar.com' });
check('matched', [r.supplierRecordId, r.confidence], ['recHAL1', 'exact']);
check('supplier defaults come back with it', [r.trustScore, r.defaultMargin], ['High', 0.07]);
check('nothing to create', r.needCreate, false);

check('angle brackets and case are tolerated',
  run({ fromAddress: '"Mehmet" <Mehmet@Halitlar.com>' }).supplierRecordId, 'recHAL3');

section('Issue 4 — a colleague at a known supplier is NOT a new supplier');

r = run({ channel: 'email', fromAddress: 'ahmet@halitlar.com', senderName: 'Ahmet Yilmaz' });
check('resolves to the company on file, despite three contacts there', r.supplierRecordId, 'recHAL1');
check('by domain', r.confidence, 'strong');
check('and creates nothing', r.needCreate, false);
check('the note says how many contacts are on file', /3 contact\(s\) on file/.test(r.matchedVia), true);

section('Issue 4 — genuinely different companies on one domain go to a person');

r = run({ channel: 'email', fromAddress: 'c@shared-host.com', senderName: 'Someone New' });
check('not resolved', r.supplierRecordId, null);
check('flagged ambiguous', r.ambiguous, true);
check('both candidates named', r.candidates.sort(), ['Newport Global', 'Pika Trading']);
check('and a third record is NOT created', r.needCreate, false);

section('Generic domains are never a company');

r = run({ channel: 'email', fromAddress: 'someone.else@gmail.com', senderName: 'Someone Else' });
check('gmail does not resolve to the gmail supplier', r.supplierRecordId, null);
check('and does not auto-create off a generic domain', r.needCreate, false);

section('Issue 5 — the real sender is found in the body, with no forward marker');

const OUTLOOK_FORWARD = [
  'Hi Anil, please see the offer below.',
  '',
  'From: Yael Dahan <yael@ezata-drinks.co.il>',
  'Sent: Monday 14 September 2026 09:12',
  'To: offers@akay.ie',
  'Subject: September stock list',
  '',
  'Jameson 12x70cl @ EUR 13.50',
].join('\n');

r = run({ channel: 'email', fromAddress: 'offers@akay.ie', bodyText: OUTLOOK_FORWARD });
check('the forwarder is ignored', r.statedAddress, '');
check('the real supplier is found in the body', r.supplierRecordId, 'recEZAT');
check('and it says where it came from', r.evidenceUsed.includes('address found in the message body'), true);

section('Issue 5 — a genuinely new supplier is created under the COMPANY name');

const NEW_SUPPLIER_MAIL = [
  'Dear Anil,',
  'Please find our September list attached.',
  '',
  'Best regards,',
  'Marco Bianchi',
  'Sales Director',
  'Bergamo Beverages S.R.L.',
  'marco@bergamo-beverages.it',
  '+39 035 123456',
].join('\n');

r = run({ channel: 'email', fromAddress: 'offers@akay.ie', senderName: 'Marco Bianchi', bodyText: NEW_SUPPLIER_MAIL });
check('nothing existing matched', r.supplierRecordId, null);
check('a supplier will be created', r.needCreate, true);
check('named after the COMPANY, not the person', r.createName, 'Bergamo Beverages S.R.L.');
check('with the company address', r.createEmail, 'marco@bergamo-beverages.it');

r = run({ channel: 'email', fromAddress: 'orders@vinos-iberia.es', senderName: 'Pedro' });
check('with no signature, the name is derived from the domain', r.createName, 'Vinos Iberia');
check('still never the person', r.createName === 'Pedro', false);

section('Our own envelope is never a supplier');

r = run({ channel: 'email', fromAddress: 'offers@akay.ie', senderName: 'Akay Offers' });
check('not resolved', r.supplierRecordId, null);
check('and nothing created from our own address', r.needCreate, false);
check('note asks for a human', /NEEDS ATTENTION/.test(r.note), true);

section('Issue 6 — WhatsApp uses every piece of identity on the message');

check('phone number, as before',
  run({ channel: 'whatsapp', senderNumber: '+90 532 111 2233' }).supplierRecordId, 'recHAL1');

check('a local number matches an international one',
  run({ channel: 'whatsapp', senderNumber: '31612345678' }).supplierRecordId, 'recJAVA');

r = run({ channel: 'whatsapp', senderNumber: '+90 555 999 0000', senderName: 'Halitlar Gida' });
check('an unknown number still resolves on the sender display name', r.supplierRecordId, 'recHAL1');
check('recorded as such', r.evidenceUsed.includes('sender display name'), true);

r = run({ channel: 'whatsapp', senderNumber: '+31 6 99 99 99 99', groupName: 'Java Distri — Offers' });
check('a group name resolves it', r.supplierRecordId, 'recJAVA');

r = run({ channel: 'whatsapp', senderNumber: '+972 50 000 0000', bodyText: 'Jameson 13.50 EUR\n\nYael\nyael@ezata-drinks.co.il' });
check('a signature address in the message resolves it', r.supplierRecordId, 'recEZAT');

r = run({ channel: 'whatsapp', senderNumber: '+1 555 000 0000', senderName: '+1 555 000 0000' });
check('a genuinely anonymous message resolves to nothing', r.supplierRecordId, null);
check('and creates nothing', r.needCreate, false);
check('so no offer can be written against it', r.confidence, 'none');

section('Company naming variants are the same company');

for (const [label, name] of [
  ['legal suffix dropped', 'Halitlar Gida'],
  ['different suffix', 'Halitlar Gida Limited'],
  ['upper case', 'HALITLAR GIDA LTD'],
  ['trailing punctuation', 'Halitlar Gida Ltd.'],
]) {
  check(`"${name}" -> Halitlar (${label})`, run({ channel: 'whatsapp', senderName: name }).supplierRecordId, 'recHAL1');
}

check('a short or generic name never matches',
  run({ channel: 'whatsapp', senderName: 'Ltd' }).supplierRecordId, null);
check('an unrelated company does not match',
  run({ channel: 'whatsapp', senderName: 'Javana Foods' }).supplierRecordId, null);

section('Placeholder names — the old auto-create left 98 of 395 records named "Person (domain)"');

const LEGACY = [
  sup('recGK1', 'Garry (greeneking.co.uk)', 'garry@greeneking.co.uk'),
  sup('recGK2', 'Fraser (greeneking.co.uk)', 'fraser@greeneking.co.uk'),
  sup('recSN1', 'Garry (shepherd-neame.co.uk)', 'garry@shepherd-neame.co.uk'),
  sup('recSN2', 'C Holland', 'c.holland@shepherd-neame.co.uk'),
  sup('recST1', 'Standard Trading', 'alfred@standardtrading.co'),
  sup('recST2', 'standardtrading.co', 'sales@standardtrading.co'),
  sup('recBT1', 'Innes Mcbeath', 'innes@btinternet.com'),
  sup('recBT2', 'David Taylor', 'david@btinternet.com'),
  sup('recREAL', 'Halitlar Gida Ltd', 'sales@halitlar.com'),
];

r = run({ channel: 'email', fromAddress: 'newperson@greeneking.co.uk', senderName: 'New Person' }, LEGACY);
check('two placeholder names on one domain are ONE company', r.supplierRecordId, 'recGK1');
check('not ambiguous', r.ambiguous, false);
check('nothing created', r.needCreate, false);

r = run({ channel: 'email', fromAddress: 'newperson@shepherd-neame.co.uk' }, LEGACY);
check('a placeholder cannot contradict a real name — resolves', r.supplierRecordId !== null, true);
check('and links to the properly named record, not the placeholder', r.supplierName, 'C Holland');

r = run({ channel: 'email', fromAddress: 'newperson@standardtrading.co' }, LEGACY);
check('a bare-domain name is a placeholder too', r.supplierName, 'Standard Trading');

r = run({ channel: 'email', fromAddress: 'someone@btinternet.com', senderName: 'Someone' }, LEGACY);
check('a consumer ISP domain is generic: two BT users are not one company', r.supplierRecordId, null);
check('and not flagged ambiguous either', r.ambiguous, false);
check('and never auto-created off it', r.needCreate, false);

r = run({ channel: 'whatsapp', senderNumber: '+44 7000 000000', senderName: 'Garry' }, LEGACY);
check('a placeholder is never matched BY NAME — another Garry is not Greene King', r.supplierRecordId, null);

check('a placeholder is still reached through its own address',
  run({ channel: 'email', fromAddress: 'garry@greeneking.co.uk' }, LEGACY).supplierRecordId, 'recGK1');

check('a real company name is unaffected by any of this',
  run({ channel: 'whatsapp', senderName: 'Halitlar Gida' }, LEGACY).supplierRecordId, 'recREAL');

section('No supplier book at all is not a crash');

r = run({ channel: 'email', fromAddress: 'x@new-co.com' }, []);
check('resolves to nothing', r.supplierRecordId, null);
check('and proposes a create', [r.needCreate, r.createName], [true, 'New Co']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
