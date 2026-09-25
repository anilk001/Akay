/**
 * Sent Mail → Client Capture — "Build Archive Stamps" Code node.
 *
 * Runs after "Airtable POST new Clients". Pairs each created Client (by email)
 * with the Capsule Archive row it was promoted from and stamps that row with
 * Promoted To Client / Promoted Date, so the Enquiry → Client Linker never
 * promotes the same person a second time and the archive shows who went live.
 * Emits one PATCH batch per 10 rows, plus rowsJson for the Postgres mirror.
 */
const TODAY = new Date().toISOString().slice(0, 10);
const ARCHIVE = 'tblu5B3Icdobqx0UV';

const created = {};
$input.all().forEach(function (it) {
  ((it.json && it.json.records) || []).forEach(function (r) {
    const e = String((r.fields && r.fields.Email) || '').toLowerCase();
    if (e) created[e] = r.id;
  });
});

const seen = {};
const patches = [];
$('Build Client Creates').all().forEach(function (it) {
  ((it.json && it.json.promoted) || []).forEach(function (p) {
    const cid = created[p.email];
    if (!cid || seen[p.archiveId]) return;
    seen[p.archiveId] = true;
    patches.push({ id: p.archiveId, fields: { 'Promoted To Client': cid, 'Promoted Date': TODAY } });
  });
});
if (!patches.length) return [];

const out = [];
for (let i = 0; i < patches.length; i += 10) {
  const batch = patches.slice(i, i + 10);
  out.push({ json: {
    table: ARCHIVE,
    body: { records: batch, typecast: false },
    rowsJson: JSON.stringify(batch.map(function (r) { return { airtable_id: r.id, fields: r.fields }; })),
  } });
}
return out;
