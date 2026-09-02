// n8n Code node — "Drop Cross-Channel Duplicates" (Run Once for All Items)
//
// WhatsApp wins (Anil, 2026-09-02): the same supplier offer routinely arrives
// on more than one channel — the Sasa Toblerone/Lindt lines came in by
// WhatsApp at 16:32 and again by email at 19:21, creating four duplicate
// records. An offer already in Airtable from the LAST 7 DAYS with the same
// product name, buy price and currency means this email line is a repeat, so
// it is dropped here before anything is created. Matching is deliberately on
// those three fields only: warehouse and incoterm phrasing vary between
// channels for the same offer, and an exact price+product+currency collision
// inside a week is the same offer, not a coincidence.
//
// UNIT SPELLINGS ARE CANONICALIZED before comparing: the WhatsApp parser wrote
// "Toblerone Milk 100gr" while the email LLM wrote "Toblerone Milk 100g" for
// the SAME line, so a bare string match catches only half the duplicates.
// 100g/100gr/100 grams fold to one form; likewise ml, cl and l. Digits are
// never converted (70cl is NOT folded to 700ml), so distinct sizes stay
// distinct.
//
// The email itself must still get its done-label: when EVERY line is a
// duplicate, a sentinel (no Product Name) is emitted and "Any New Offers?"
// routes it straight to "Emails to Mark Done" — same stranding class as the
// "Any New Products?" sentinel, where 0 items would strand the run and the
// label poll would refetch the email forever.
const canonUnits = (s) => String(s ?? '').toLowerCase()
  .replace(/(\d+)\s*(?:grams?|grs?|gr|g)\b/g, '$1g')
  .replace(/(\d+)\s*(?:millilitres?|milliliters?|mls?)\b/g, '$1ml')
  .replace(/(\d+)\s*(?:centilitres?|centiliters?|cls?)\b/g, '$1cl')
  .replace(/(\d+)\s*(?:litres?|liters?|ltrs?|l)\b/g, '$1l');
const norm = (v) => canonUnits(v).replace(/[^a-z0-9]/g, '');
const price = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : ''; };
const selectName = (v) => { const a = Array.isArray(v) ? v[0] : v; if (a === null || a === undefined) return ''; return typeof a === 'object' ? (a.name ?? '') : a; };
const keyOf = (name, buy, cur) => [norm(name), price(buy), String(selectName(cur) ?? '').toUpperCase().trim()].join('|');

const existing = new Set();
try {
  for (const it of $('Fetch Recent Offers').all()) {
    const f = it.json.fields || it.json;
    if (f['Product Name']) existing.add(keyOf(f['Product Name'], f['Buy Price'], f['Currency']));
  }
} catch (e) { /* fetch did not run — nothing to dedupe against */ }

const kept = [];
const dropped = [];
for (const it of $('Offers to Create').all()) {
  const o = it.json;
  const k = keyOf(o['Product Name'], o['Buy Price'], o['Currency']);
  if (existing.has(k)) dropped.push(o['Product Name'] + ' @ ' + o['Buy Price'] + ' ' + selectName(o['Currency']));
  else kept.push({ json: o });
}

if (dropped.length) console.log('Cross-channel duplicates dropped (offer already exists within 7 days — WhatsApp wins): ' + dropped.join('; '));

if (kept.length === 0) {
  return [{ json: { __allDuplicates: true, droppedCount: dropped.length, droppedOffers: dropped.join('; ') } }];
}
return kept;
