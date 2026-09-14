/**
 * Tests for the Email Body pipeline's "Carry Existing Supplier Id Forward".
 *
 * Issue 4 in its worst form: this pipeline matched suppliers on the exact
 * address and nothing else, so the SECOND contact at a known supplier — not
 * just the third — became a duplicate, named after the bare domain string.
 *
 * The contract that must not break is asserted first: one output item per
 * original email, in the original order, because "Attach New Supplier &
 * Finalize Offers" reads this node positionally.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'supplier-resolver', 'email-body-carry-supplier.js');
const nodeFn = new Function('$input', '$', readFileSync(SRC, 'utf8'));

const SUPPLIERS = [
  sup('recHAL1', 'Halitlar Gida Ltd', 'sales5@halitlar.com'),
  sup('recHAL2', 'Halitlar Gida', 'export@halitlar.com'),
  sup('recJAVA', 'Java Distri B.V.', 'info@javadistri.nl'),
  sup('recEZAT', 'EZATA Drinks', 'yael@ezata-drinks.co.il'),
  sup('recNEWP', 'Newport Global', 'a@shared-host.com'),
  sup('recPIKA', 'Pika Trading', 'b@shared-host.com'),
];

function sup(id, name, email) {
  return { id, fields: { 'Supplier Name': name, Email: email, Status: 'Active' } };
}

/** originals = the false branch of "Has Working Column Map?"; input = the search rows. */
function run(originals, suppliers = SUPPLIERS) {
  const $ = (name) => {
    if (name !== 'Has Working Column Map?') throw new Error(`no node "${name}"`);
    return { all: (branch) => { if (branch !== 1) throw new Error('wrong branch'); return originals.map((json) => ({ json })); } };
  };
  const $input = { all: () => suppliers.map((json) => ({ json })) };
  return nodeFn($input, $);
}
const one = (o) => run([o])[0].json;

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(t) { console.log(`\n--- ${t} ---`); }

section('The contract Attach New Supplier reads positionally');

const batch = run([
  { fromAddress: 'sales5@halitlar.com', sourceMessageId: 'm1' },
  { fromAddress: 'stranger@brand-new-co.de', sourceMessageId: 'm2' },
  { fromAddress: 'info@javadistri.nl', sourceMessageId: 'm3' },
]);
check('one output item per original email', batch.length, 3);
check('in the original order', batch.map((b) => b.json.sourceMessageId), ['m1', 'm2', 'm3']);
check('every item carries a resolvable pairedItem', batch.every((b) => typeof b.pairedItem.item === 'number'), true);
check('original fields survive', batch[0].json.fromAddress, 'sales5@halitlar.com');
check('existingProfileId still set to null as before', batch[0].json.existingProfileId, null);

section('Exact address still matches, as before');

let r = one({ fromAddress: 'sales5@halitlar.com' });
check('matched', r.existingSupplierId, 'recHAL1');
check('no create', r.createSupplier, false);

section('Issue 4 — the SECOND contact at a known supplier is no longer a duplicate');

r = one({ fromAddress: 'ahmet@halitlar.com', senderName: 'Ahmet Yilmaz' });
check('resolves to the company on file', r.existingSupplierId, 'recHAL1');
check('by domain', /domain halitlar\.com/.test(r.supplierVia), true);
check('creates NOTHING', r.createSupplier, false);
check('and names the real supplier, not the domain string', r.existingSupplierName, 'Halitlar Gida Ltd');

check('a third, fourth, fifth contact likewise',
  ['mehmet@halitlar.com', 'orders@halitlar.com', 'ops@halitlar.com']
    .map((a) => one({ fromAddress: a }).existingSupplierId),
  ['recHAL1', 'recHAL1', 'recHAL1']);

section('Issue 4 — two real companies on one mail host must not create a third');

r = one({ fromAddress: 'c@shared-host.com', senderName: 'Someone New' });
check('not matched', r.existingSupplierId, null);
check('flagged ambiguous', r.supplierAmbiguous, true);
check('both named', r.supplierCandidates.sort(), ['Newport Global', 'Pika Trading']);
check('and createSupplier is false — Need New Supplier? must not create', r.createSupplier, false);

section('A genuinely new supplier is named after the COMPANY');

r = one({ fromAddress: 'marco@bergamo-beverages.it', senderName: 'Marco Bianchi' });
check('will be created', r.createSupplier, true);
check('named from the domain, not the bare domain string', r.createName, 'Bergamo Beverages');
check('never "bergamo-beverages.it"', r.createName === 'bergamo-beverages.it', false);
check('never the person', r.createName === 'Marco Bianchi', false);
check('with the address', r.createEmail, 'marco@bergamo-beverages.it');

r = one({
  fromAddress: 'm@bergamo-beverages.it',
  prose: 'Dear Anil,\nList attached.\n\nBest regards,\nMarco Bianchi\nBergamo Beverages S.R.L.',
});
check('a signature company line wins over the domain guess', r.createName, 'Bergamo Beverages S.R.L.');

section('Company identity found in the body');

check('an address in the body matches a known supplier',
  one({ fromAddress: '', prose: 'Forwarded.\nFrom: Yael <yael@ezata-drinks.co.il>\nJameson 13.50' }).existingSupplierId, 'recEZAT');
check('the sender display name matches',
  one({ fromAddress: 'sales@unknown-host.pl', senderName: 'Java Distri' }).existingSupplierId, 'recJAVA');

section('Guards');

check('a generic domain never auto-creates',
  one({ fromAddress: 'someone@gmail.com', senderName: 'Someone' }).createSupplier, false);
check('our own address is never a supplier',
  one({ fromAddress: 'offers@akay.ie' }).createSupplier, false);
check('an unrelated company does not match',
  one({ fromAddress: 'x@javana.com', senderName: 'Javana Foods' }).existingSupplierId, null);

r = one({ fromAddress: '', prose: 'FYI\nFrom: marco@bergamo-beverages.it\nCc: klaus@rheinland-logistik.de' });
check('two outside companies in one mail: nothing created', r.createSupplier, false);

section('Empty inputs are never a crash');

check('no originals', run([]).length, 0);
r = run([{ fromAddress: 'x@new-co.com' }], [])[0].json;
check('no supplier book: still proposes a create', [r.existingSupplierId, r.createSupplier, r.createName], [null, true, 'New Co']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
