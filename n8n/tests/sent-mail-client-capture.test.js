/**
 * Tests for Sent Mail → Client Capture ("Pick New Recipients" and "Build Client
 * Creates"). Same harness as the other n8n tests: the node source is executed,
 * not re-typed, so these cannot drift from what is pasted into n8n. `$` is faked
 * to hand each node the upstream items it reads by name.
 *
 * The cases that matter most are the refusals: a supplier, a colleague at
 * akay.ie, a no-reply mailbox, a broadcast and an archived opt-out must never
 * become a Client, because a Clients row is what enrols someone in offer sends.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sent-mail-client-capture');
const pickFn = new Function('$', readFileSync(join(DIR, 'pick-new-recipients.js'), 'utf8'));
const buildSrc = readFileSync(join(DIR, 'build-client-creates.js'), 'utf8');
const buildDry = new Function('$', buildSrc);
const buildLive = new Function('$', buildSrc.replace('const DRY_RUN = true;', 'const DRY_RUN = false;'));
const stampFn = new Function('$input', '$', readFileSync(join(DIR, 'build-archive-stamps.js'), 'utf8'));

const quiet = console.log;
function silent(fn) { console.log = () => {}; try { return fn(); } finally { console.log = quiet; } }

function fake(map) {
  return (name) => ({ all: () => (map[name] || []).map((json) => ({ json })) });
}
const addr = (address, name = '') => ({ value: [{ address, name }] });

function mail(over) {
  return { id: 'm1', date: '2026-09-24T10:00:00.000Z', subject: '', text: '', to: addr('buyer@wholesale.de', 'Hans Buyer'), ...over };
}

const BASE = {
  'Clients Keys': [{ id: 'recC1', 'Client Name': 'Known Ltd', Email: 'Known@Client.com' }],
  'Contacts Keys': [{ id: 'recK1', Email: 'colleague@contact.com' }],
  'Supplier Emails': [{ id: 'recS1', 'Supplier Name': 'Big Supplier', Email: 'sales@supplier.nl' }, { id: 'recS2', 'Supplier Name': 'Gmail Supplier', Email: 'someone@gmail.com' }],
};

function pick(mails, extra = {}) {
  const out = silent(() => pickFn(fake({ ...BASE, ...extra, 'Sent Mail': mails })));
  return out.length ? out[0].json : { candidates: [], summary: null };
}

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) console.log(`       want ${JSON.stringify(want)}\n       got  ${JSON.stringify(got)}`);
}
function section(t) { console.log(`\n--- ${t} ---`); }

section('categories');
{
  const c = pick([mail({ subject: 'Jameson and Hennessy offer', text: 'Hi Hans,\n\nJameson 6x70cl at EUR 17.95, Hennessy VS 12x70cl.\n\nKind regards,\nAnil' })]).candidates[0];
  check('spirits mail → Spirits', c.categories, ['Spirits']);
  check('Spirits → Capsule Tag the offer sends select on', c.capsuleTags, ['Indv spirits']);
  check('name from the header', c.name, 'Hans Buyer');
  check('country from ccTLD', c.country, 'Germany');
  check('last contact is the send date', c.lastDate, '2026-09-24');
}
{
  const c = pick([mail({ subject: 'Heineken 24x33cl', text: 'Heineken and Carlsberg cans, T2.' })]).candidates[0];
  check('beer mail → Beer / Indv beers', [c.categories, c.capsuleTags], [['Beer'], ['Indv beers']]);
}
{
  const c = pick([mail({ subject: 'Grocery and confectionery list', text: 'Nutella, Kinder Bueno, Lavazza coffee, pasta and sunflower oil.' })]).candidates[0];
  check('mixed grocery/confectionery keeps both', c.categories, ['Grocery', 'Confectionery']);
}
{
  const text = Array(8).fill('Jameson 6x70cl\nJohnnie Walker Black\nAbsolut vodka').join('\n') + '\nGuinness 1 pallet';
  const c = pick([mail({ subject: 'Spirits price list', text })]).candidates[0];
  check('one Guinness line does not make a spirits list a beer client', c.categories, ['Spirits']);
}
{
  const c = pick([mail({ subject: 'Following up', text: 'Hi, great to meet you yesterday. Speak soon.' })]).candidates[0];
  check('nothing to go on → no category, never a guess', [c.categories, c.capsuleTags], [[], []]);
}
{
  const text = 'Hi,\nPlease see attached.\n\nKind regards,\nAnil Khetan\nAkay Irl Ltd — spirits, beers, wines, groceries, confectionery\n\nOn Mon, 22 Sep 2026 at 10:00, Hans <buyer@wholesale.de> wrote:\n> Do you have Red Bull 24x250ml?';
  const c = pick([mail({ subject: 'Re: enquiry', text })]).candidates[0];
  check('signature ignored, quoted client request kept', c.categories, ['Soft Drinks']);
}
{
  const c = pick([mail({ subject: 'Offer', text: 'Please find attached', attachments: [{ filename: 'Loendersloot whisky list.xlsx' }] })]).candidates[0];
  check('attachment name counts', c.categories, ['Spirits']);
}
check('word boundaries: "sale", "team", "price" are not ale/tea/rice',
  pick([mail({ subject: 'For sale', text: 'Our team will send the price.' })]).candidates[0].categories, []);
check('rosé is matched with its accent', pick([mail({ subject: 'Rosé and prosecco' })]).candidates[0].categories, ['Wine']);

section('who is NOT a new client');
{
  const r = pick([mail({ to: addr('known@client.com') }), mail({ to: addr('KNOWN@CLIENT.COM') })]);
  check('existing client, any case', r.candidates.length, 0);
}
check('linked contact', pick([mail({ to: addr('colleague@contact.com') })]).candidates.length, 0);
check('supplier address', pick([mail({ to: addr('sales@supplier.nl') })]).candidates.length, 0);
check('anyone else on a supplier domain', pick([mail({ to: addr('ops@supplier.nl') })]).candidates.length, 0);
check('supplier on gmail does not block every gmail address',
  pick([mail({ to: addr('newbuyer@gmail.com') })]).candidates.map((c) => c.email), ['newbuyer@gmail.com']);
check('internal akay.ie', pick([mail({ to: addr('kai@akay.ie') })]).candidates.length, 0);
check('no-reply mailbox', pick([mail({ to: addr('noreply@shop.com') })]).candidates.length, 0);
check('service domain', pick([mail({ to: addr('support@airtable.com') })]).candidates.length, 0);
{
  const many = { value: Array.from({ length: 11 }, (_, i) => ({ address: `b${i}@list.com` })) };
  check('more than 10 recipients is a broadcast', pick([mail({ to: many })]).candidates.length, 0);
}
{
  const r = pick([mail({ to: addr('a@buyer.fr'), cc: addr('b@buyer.fr'), bcc: addr('c@buyer.fr') })]);
  check('to, cc and bcc all count', r.candidates.map((c) => c.email), ['a@buyer.fr', 'b@buyer.fr', 'c@buyer.fr']);
}
{
  const r = pick([mail({ to: 'Jane Doe <Jane@Shop.PL>, raw@shop.pl' })]);
  check('plain-string headers parse too', r.candidates.map((c) => [c.email, c.name]), [['jane@shop.pl', 'Jane Doe'], ['raw@shop.pl', 'raw@shop.pl']]);
}

section('aggregation and output');
{
  const r = pick([
    mail({ id: 'm1', date: '2026-09-23T09:00:00Z', subject: 'Heineken offer' }),
    mail({ id: 'm2', date: '2026-09-24T09:00:00Z', subject: 'Jameson offer' }),
  ]);
  check('one candidate per address across messages', r.candidates.length, 1);
  check('latest date wins', r.candidates[0].lastDate, '2026-09-24');
  check('both mails feed the categories', r.candidates[0].categories.slice().sort(), ['Beer', 'Spirits']);
  check('archive formula over just the new addresses', r.formula, 'LOWER({Email})="buyer@wholesale.de"');
}
check('colleague of an existing client is flagged', pick([mail({ to: addr('other@client.com') })]).candidates[0].sameCompanyAs, 'Known Ltd');
check('nobody new → no item, downstream skipped', silent(() => pickFn(fake({ ...BASE, 'Sent Mail': [mail({ to: addr('kai@akay.ie') })] }))), []);

section('Build Client Creates');
function build(fn, candidates, archive = []) {
  return silent(() => fn(fake({ 'Pick New Recipients': [{ candidates, summary: {} }], 'Find Archive Matches': archive })));
}
const spiritsBuyer = pick([mail({ subject: 'Jameson offer' })]).candidates[0];
{
  const out = build(buildDry, [spiritsBuyer]);
  check('DRY_RUN emits one summary and no create batch', out.map((o) => o.json.kind), ['dry-run']);
  const f = out[0].json.wouldCreate[0].fields;
  check('record fields', [f['Client Name'], f.Email, f.Status, f['Preferred Channel'], f['Last Contact Date'], f.Country, f['Interest Categories'], f['Capsule Tags']],
    ['Hans Buyer', 'buyer@wholesale.de', 'Pending Review', 'Email', '2026-09-24', 'Germany', ['Spirits'], ['Indv spirits']]);
  check('Buying Notes say where it came from and why', /ak@akay\.ie.*Jameson offer[\s\S]*Spirits: jameson/.test(f['Buying Notes']), true);
}
{
  const out = build(buildLive, [spiritsBuyer]);
  check('live: create batch, typecast off', [out[0].json.kind, out[0].json.body.typecast, out[0].json.body.records.length], ['create', false, 1]);
}
{
  const many = Array.from({ length: 23 }, (_, i) => ({ ...spiritsBuyer, email: `b${i}@x.de` }));
  check('batches of 10', build(buildLive, many).map((o) => o.json.body.records.length), [10, 10, 3]);
}
{
  const blank = pick([mail({ subject: 'Hello' })]).candidates[0];
  const f = build(buildDry, [blank])[0].json.wouldCreate[0].fields;
  check('no category → fields omitted, note asks a person', [f['Interest Categories'], f['Capsule Tags'], /please set Interest Categories/.test(f['Buying Notes'])], [undefined, undefined, true]);
}
{
  const out = build(buildLive, [spiritsBuyer], [{ id: 'recA1', fields: { Email: 'Buyer@Wholesale.de', 'Do Not Contact': true } }]);
  check('archived opt-out is refused', out, []);
}
{
  const archive = [{ id: 'recA2', fields: { Email: 'buyer@wholesale.de', 'Client Name': 'Wholesale GmbH', Phone: '+49301234', Country: 'Germany', 'Interest Categories': [{ name: 'Beer' }], 'Capsule Tags': ['Indv beers', 'Not A Clients Option'] } }];
  const out = build(buildLive, [spiritsBuyer], archive);
  const f = out[0].json.body.records[0].fields;
  check('archive row promoted: name/phone carried, interests unioned', [f['Client Name'], f.Phone, f['Interest Categories'], f['Capsule Tags']],
    ['Wholesale GmbH', '+49301234', ['Spirits', 'Beer'], ['Indv spirits', 'Indv beers']]);
  check('promotion recorded for the stamp step', out[0].json.promoted, [{ email: 'buyer@wholesale.de', archiveId: 'recA2' }]);

  const stamped = silent(() => stampFn(
    { all: () => [{ json: { records: [{ id: 'recNEW', fields: { Email: 'buyer@wholesale.de' } }] } }] },
    (name) => ({ all: () => (name === 'Build Client Creates' ? out : []) }),
  ));
  check('archive row stamped with the new client id', stamped[0].json.body.records, [{ id: 'recA2', fields: { 'Promoted To Client': 'recNEW', 'Promoted Date': new Date().toISOString().slice(0, 10) } }]);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
