/**
 * Sent Mail → Client Capture — "Build Client Creates" Code node.
 *
 * Turns the candidates from "Pick New Recipients" into Airtable create batches
 * for Clients, after checking each address against the Capsule Archive (fetched
 * by "Find Archive Matches" with one OR() over just these addresses).
 *
 *   - An archive row marked Do Not Contact is REFUSED. Anil writing to someone
 *     personally does not undo their opt-out from the mailing list, and a
 *     Clients row would put them straight back into the offer sends.
 *   - Any other archive row is PROMOTED: its name, phone, country and tags are
 *     carried across and unioned with the categories the email was about, the
 *     same way the Enquiry → Client Linker promotes enquirers. The archive row
 *     is stamped afterwards by "Build Archive Stamps".
 *
 * Every record is Status "Pending Review" — the base's marker for a client a
 * workflow created and a person has not yet looked at — and says in Buying
 * Notes which email created it and which words chose its categories, so a
 * wrong guess can be seen and fixed in one glance.
 *
 * Every select value written here is a real option on Clients; the POST runs
 * with typecast OFF so a typo fails loudly instead of inventing an option.
 *
 * DRY_RUN = true writes nothing: one summary item shows what WOULD be created.
 */
const DRY_RUN = true;
const RUN_TAG = 'sent-mail capture ' + new Date().toISOString().slice(0, 10);

const INTEREST_OPTIONS = ['Beer', 'Spirits', 'Wine', 'Grocery', 'Confectionery', 'Toiletries', 'Soft Drinks', 'Other FMCG', 'Indv Spirits', 'Indv groceries'];

// Clients.Capsule Tags options as of 2026-09-25. Archive tags outside this list are
// dropped rather than sent: with typecast off, one unknown option fails all ten rows.
const CAPSULE_TAG_OPTIONS = ["beers", "spirits", "wines", "groceries", "toiletries", "confectionery", "beverages", "vip", "No Mailing", "Indv groceries", "Indv Confectionery", "Indv beverages", "Indv perfumes & cosmetics", "Indv wines", "Indv toiletries", "indv sunglasses", "Indv beers", "border Shops", "Indv cognac", "Africa", "beverages uk", "cognacs", "Indv Pharma", "red bull", "Indv spirits", "Iron Ore Buyer", "Indv Sunflower Oil", "Diwali Greetings", "sunglasses & frames", "watches", "bags & accessories", "Indv Cigars", "T1 Spirits", "champagnes", "Tequila", "Macallan", "Spirits T2 ONLY", "T2 Beers", "Duty Free", "Russia Spirits Clients", "Russia Beer Clients", "VIP Spirits", "consultant beer industry", "Cash Buyers Spirits", "Stocklots", "Indv Cigarettes", "Indv champagne", "Xmas Gifts", "perfumes & cosmetics", "non trading contact", "ISSA Members", "cigarettes", "airline supply", "WhatsApp Contact", "Country Unknown", "Valentiin", "Indv Spirits"];

function items(name) { try { return $(name).all(); } catch (e) { return []; } }
function flat(item) { const j = (item && item.json) || {}; return j.fields ? Object.assign({ id: j.id }, j.fields) : j; }
function names(v) { return (Array.isArray(v) ? v : (v ? [v] : [])).map(function (x) { return x && x.name ? x.name : x; }).filter(Boolean); }
function union(a, b) { const out = a.slice(); b.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); }); return out; }

const pick = items('Pick New Recipients')[0];
const candidates = (pick && pick.json && pick.json.candidates) || [];
if (!candidates.length) return [];

const archive = {};
items('Find Archive Matches').map(flat).forEach(function (a) {
  if (!a.id) return;
  const e = String(a.Email || '').trim().toLowerCase();
  if (e && !archive[e]) archive[e] = a;
});

const records = [];
const promoted = [];
const refused = [];
candidates.forEach(function (c) {
  const a = archive[c.email];
  if (a && a['Do Not Contact']) { refused.push(c.email); return; }

  const categories = c.categories.filter(function (k) { return INTEREST_OPTIONS.indexOf(k) >= 0; });
  const notes = [
    'Auto-added by ' + RUN_TAG + ' from mail sent by ak@akay.ie on ' + (c.lastDate || '?') + (c.subjects.length ? ' — "' + c.subjects.join('" / "') + '"' : '') + '.',
    categories.length ? 'Categories guessed from ' + c.evidence.join('; ') + '. Check before relying on them.' : 'No category could be read from the mail — please set Interest Categories.',
  ];
  if (c.sameCompanyAs) notes.push('Same email domain as existing client ' + c.sameCompanyAs + ' — may be a colleague.');

  const fields = {
    'Client Name': c.name,
    Email: c.email,
    Status: 'Pending Review',
    'Preferred Channel': 'Email',
  };
  if (c.lastDate) fields['Last Contact Date'] = c.lastDate;
  if (c.country) fields.Country = c.country;
  let interests = categories;
  let tags = c.capsuleTags.slice();

  if (a) {
    promoted.push({ email: c.email, archiveId: a.id });
    if (a['Client Name']) fields['Client Name'] = a['Client Name'];
    if (a.Phone) fields.Phone = a.Phone;
    if (a.Country) fields.Country = a.Country;
    interests = union(interests, names(a['Interest Categories']).filter(function (k) { return INTEREST_OPTIONS.indexOf(k) >= 0; }));
    tags = union(tags, names(a['Capsule Tags']).filter(function (t) { return CAPSULE_TAG_OPTIONS.indexOf(t) >= 0; }));
    notes.push('Promoted from Capsule Archive (' + a.id + ').');
  }
  if (interests.length) fields['Interest Categories'] = interests;
  if (tags.length) fields['Capsule Tags'] = tags;
  fields['Buying Notes'] = notes.join('\n');
  records.push({ fields: fields });
});

const summary = { dryRun: DRY_RUN, toCreate: records.length, promotedFromArchive: promoted.length, refusedDoNotContact: refused, scan: pick.json.summary };
console.log('sent-mail capture: ' + JSON.stringify(summary));
if (DRY_RUN) return [{ json: { kind: 'dry-run', summary: summary, wouldCreate: records } }];

const out = [];
for (let i = 0; i < records.length; i += 10) {
  out.push({ json: { kind: 'create', body: { records: records.slice(i, i + 10), typecast: false }, promoted: promoted } });
}
return out;
