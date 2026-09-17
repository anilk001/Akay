/**
 * n8n Code node — "Validate & Compose"
 * Workflow: Instant Quote Intake — quote.akay.ie (pXGfSBEn5ZdOT4nt)
 * Mode: Run Once for All Items
 *
 * The Trade Desk API calls the intake webhook once it has priced a buyer's
 * uploaded list. This node is the only place the payload is interpreted: every
 * node after it reads plain fields, so a change in what the API sends is one
 * edit here rather than a hunt through expressions.
 *
 * THE THREE THINGS THE WORKFLOW EXISTS FOR:
 *   1. the buyer's own file and the priced copy end up on one Enquiries record,
 *      linked to the Client;
 *   2. ak@akay.ie gets the priced file by email;
 *   3. every line we could NOT price becomes a `Wanted` row — see
 *      `unmatchedLines` below and `extract-wanted-lines.js` next to this file.
 * The first two need a file, so a missing file is the one fatal error.
 *
 * WHY THE UNMATCHED LINES ARE THE VALUABLE HALF.
 * A line that matched earned us a quote. A line that did not is a customer
 * telling us what to stock, with their name on it — and until now it went
 * nowhere: the buyer downloaded a file with gaps in it and the gaps were
 * forgotten. Routing them into `Wanted` puts them in front of the existing
 * matcher, so when the stock does arrive the buyer who asked is already
 * attached to it, and into the Monday buying brief
 * (`../unmatched-demand-digest/`).
 *
 * The parsing below stays in this node because this is the only place the
 * payload is interpreted: every node after it reads plain fields.
 *
 * WHY A MISSING EMAIL IS NOT FATAL.
 * The email is what links the enquiry to a Client. But an unattributable list
 * is still a buying signal — what a real buyer wants, in their own words — and
 * throwing it away to keep the CRM tidy loses the more valuable half. Without
 * an email the enquiry is logged with no client link, and the desk can chase it
 * from the file itself. This also means the workflow does not care whether the
 * front end asks for contact details before pricing or at download: either way
 * what arrives is logged.
 *
 * WHY THE FILES ARE STRIPPED FROM `Raw Message`.
 * The raw payload is kept for audit, but two base64 blobs in a text cell make
 * the record unopenable in the Airtable UI and help nobody — the files are on
 * the record as attachments, which is where someone would look for them.
 *
 * THE 5 MB GUARD.
 * Airtable's upload endpoint refuses anything over 5 MB. base64 is about 4/3 of
 * the raw bytes, so a file near the limit is rejected by Airtable *after* the
 * enquiry was created — leaving a record that silently has no file. Catching it
 * here means the enquiry still gets written, the note says the file was too
 * large, and nobody is left believing a copy was kept.
 */

// One Instant Quote upload: the buyer's own file, the priced copy we
// handed back, and whatever contact details they gave. Everything is
// normalised here so every node downstream reads plain fields.
const raw = $input.first().json;
const body = raw.body || raw;
const s = (v) => (v === null || v === undefined ? '' : String(v)).trim();

const email = s(body.email).toLowerCase();
const contactName = s(body.name);
const company = s(body.company);
const phone = s(body.phone);
const country = s(body.country);
const note = s(body.note);

const fileName = s(body.fileName) || 'buying-list.xlsx';
const fileType = s(body.fileType) || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const file = s(body.file);
const quotedFileName = s(body.quotedFileName) || ('priced-' + fileName);
const quotedFileType = s(body.quotedFileType) || fileType;
const quotedFile = s(body.quotedFile);

const lines = Array.isArray(body.lines) ? body.lines : [];
const summary = (body.summary && typeof body.summary === 'object') ? body.summary : {};

const errors = [];
if (s(body.company_website)) errors.push('honeypot triggered');
// An email is what links the enquiry to a client, but a list we cannot
// attribute is still worth keeping — only a missing file is fatal.
if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('invalid email address');
if (!file) errors.push('no inquiry file received');

// Airtable rejects an upload over 5 MB, and base64 is ~4/3 of the raw bytes.
const MAX_B64 = 5 * 1024 * 1024;
const inquiryTooBig = file.length > MAX_B64;
const quotedTooBig = quotedFile.length > MAX_B64;

const lineRows = lines.slice(0, 200).map(function (l) {
  const bits = [s(l.description) || s(l.name) || '(unnamed line)'];
  if (s(l.matched)) bits.push('matched: ' + s(l.matched));
  if (s(l.qty)) bits.push('qty: ' + s(l.qty));
  if (s(l.price)) bits.push(s(l.price));
  return '- ' + bits.join(' | ');
});

// ── Unmatched lines → Wanted rows ───────────────────────────────────────────
//
// A line is unmatched when the API told us it priced nothing against it. Each
// one is parsed into the columns the `Wanted` table actually has, verified
// against the live schema on 2026-09-17:
//
//   Status              Open | Matched | Offered | Won | Lost | Expired
//   Category            Beer | Spirits | Champagne | Wine | Grocery |
//                       Confectionery | Toiletries | Soft Drinks | Other FMCG
//   Qty Unit            Cases | Pallets | Containers | Bottles | Pieces
//   Currency            EUR | USD | GBP | AED | SGD | Other
//   Bond/Customs Status Either | T1 | T2 | Bonded | Duty Paid | On Floor | Other
//   Source              Enquiry | Digest Link | WhatsApp | Email | Manual
//
// Airtable rejects the WHOLE batch on one unknown select value, and this repo
// writes with typecast off on purpose. So every select below is either a value
// from those lists or an empty string, and `extract-wanted-lines.js` drops the
// empties rather than sending them. A guess is never worth a failed write.

const CATEGORY_WORDS = [
  ['Spirits', /\b(whisk(?:e)?y|bourbon|vodka|gin|rum|tequila|cognac|brandy|liqueur|aperitif|absinthe|mezcal|schnapps|spirit)\b/i],
  ['Champagne', /\b(champagne|prosecco|cava|spumante)\b/i],
  ['Wine', /\b(wine|merlot|shiraz|chardonnay|sauvignon|rioja|bordeaux|rose)\b/i],
  ['Beer', /\b(beer|lager|ale|stout|pilsner|cider)\b/i],
  ['Soft Drinks', /\b(cola|soda|juice|water|energy drink|soft drink|tonic|lemonade)\b/i],
  ['Confectionery', /\b(chocolate|candy|sweets|biscuit|wafer|gum|confection)\b/i],
  ['Toiletries', /\b(shampoo|shower gel|deodorant|toothpaste|soap|lotion|razor|perfume|fragrance|cosmetic)\b/i],
  ['Grocery', /\b(coffee|tea|oil|pasta|rice|sauce|cereal|milk|grocery)\b/i],
];

const UNIT_WORDS = [
  ['Pallets', /\bpallets?\b/i],
  ['Containers', /\b(containers?|20ft|40ft|fcl)\b/i],
  ['Cases', /\b(cases?|cartons?|cs\b|ctns?)\b/i],
  ['Bottles', /\b(bottles?|btls?)\b/i],
  ['Pieces', /\b(pieces?|pcs?|units?)\b/i],
];

const BOND_WORDS = [
  ['T1', /\bt1\b/i],
  ['T2', /\bt2\b/i],
  ['Bonded', /\b(bonded|under bond|in bond)\b/i],
  ['Duty Paid', /\bduty[\s-]?paid\b/i],
];

const CURRENCIES = ['EUR', 'USD', 'GBP', 'AED', 'SGD'];

// Same unit vocabulary as src/lib/normalise.mjs, so a size written any of the
// ways a buyer writes it lands on the same number of millilitres and the
// digest can group "0.7L", "70cl" and "700ml" as one product.
const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(millilit(?:re|er)s?|centilit(?:re|er)s?|lit(?:re|er)s?|ltrs?|ml|cl|l)\b/gi;

function volumeMlOf(text) {
  const re = new RegExp(UNIT_RE.source, 'gi');
  let m;
  while ((m = re.exec(String(text)))) {
    const v = parseFloat(String(m[1]).replace(',', '.'));
    const u = m[2].toLowerCase();
    let ml = null;
    if (u === 'ml' || u.indexOf('millilit') === 0) ml = v;
    else if (u === 'cl' || u.indexOf('centilit') === 0) ml = v * 10;
    else if (u === 'l' || u.indexOf('lit') === 0 || u.indexOf('ltr') === 0) ml = v * 1000;
    if (ml) return Math.round(ml);
  }
  return null;
}

function firstMatch(pairs, text) {
  for (const pair of pairs) if (pair[1].test(text)) return pair[0];
  return '';
}

/**
 * The brand is what the buyer typed before they started describing the pack:
 * "Johnnie Walker Black 12 x 70cl 40%" -> "Johnnie Walker Black". Stopping at
 * the first token containing a digit is crude, but on a buying list it is
 * right far more often than it is wrong — and the row is written with
 * `Claude Review Status: Pending Review`, so a wrong guess is visible as
 * unreviewed rather than presented as fact.
 */
function brandOf(text) {
  const words = String(text).replace(/[(),;|]/g, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (/\d/.test(w) || /^(x|case|cases|btl|bottle|bottles|pack|pk|ctn|carton)$/i.test(w)) break;
    out.push(w);
    if (out.length === 4) break;
  }
  return out.join(' ').trim();
}

/** Anything the buyer wrote that is not the brand — pack, strength, bond note. */
function variantOf(text, brand) {
  const rest = String(text).slice(brand.length).trim().replace(/^[-–·,:]+\s*/, '');
  return rest.slice(0, 120);
}

function currencyOf(text, fallback) {
  const up = String(text).toUpperCase();
  for (const c of CURRENCIES) if (up.indexOf(c) !== -1) return c;
  if (/€/.test(text)) return 'EUR';
  if (/\$/.test(text)) return 'USD';
  if (/£/.test(text)) return 'GBP';
  const fb = String(fallback || '').toUpperCase();
  if (CURRENCIES.indexOf(fb) !== -1) return fb;
  // 'Other' is a real option, but only claim it when the buyer named something.
  return fb ? 'Other' : '';
}

function numberOf(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The API marks a line it priced with `matched`. No `matched` means we had
// nothing to offer — which is the whole point of this list.
const unmatchedLines = lines
  .filter(function (l) { return !s(l.matched); })
  .slice(0, 200)
  .map(function (l, i) {
    const description = s(l.description) || s(l.name) || '(unnamed line)';
    // The buyer's own cost or target, when their file carried one. This is
    // what makes the row actionable: what they want AND what they pay now.
    const target = numberOf(l.target !== undefined ? l.target : (l.targetPrice !== undefined ? l.targetPrice : l.cost));
    const brand = s(l.brand) || brandOf(description);
    const haystack = description + ' ' + s(l.unit) + ' ' + s(l.note);
    return {
      index: i + 1,
      raw: description,
      brand: brand,
      productName: description.slice(0, 200),
      variant: variantOf(description, brand),
      volumeMl: volumeMlOf(description),
      category: s(l.category) && CATEGORY_WORDS.some(function (c) { return c[0] === s(l.category); })
        ? s(l.category)
        : firstMatch(CATEGORY_WORDS, haystack),
      qty: numberOf(l.qty),
      qtyUnit: firstMatch(UNIT_WORDS, haystack),
      targetPrice: target,
      currency: target ? currencyOf(description + ' ' + s(l.target) + ' ' + s(l.cost), summary.currency) : '',
      bond: firstMatch(BOND_WORDS, haystack),
    };
  });

const stamp = $now.toFormat('yyyyLLdd-HHmmss');
const displayName = company || contactName || email || 'Unattributed upload';

const notesBlock = [
  'Source: quote.akay.ie (Instant Quote upload)',
  'File: ' + fileName,
  'Lines read: ' + (summary.lineCount !== undefined ? summary.lineCount : lines.length),
  'Lines priced: ' + (summary.matchedCount !== undefined ? summary.matchedCount : 'not stated'),
  'Quote total: ' + (summary.total !== undefined ? (summary.total + ' ' + (summary.currency || '')) : 'not stated'),
  'Company: ' + (company || 'not stated'),
  'Contact: ' + (contactName || 'not stated'),
  'Phone: ' + (phone || 'not stated'),
  'Country: ' + (country || 'not stated'),
  'Lines we could not price: ' + unmatchedLines.length +
    (unmatchedLines.length ? ' (logged to Wanted)' : ''),
  'Buyer note: ' + (note || 'none'),
  inquiryTooBig ? 'NOTE: the uploaded file was too large to store in Airtable.' : '',
  quotedTooBig ? 'NOTE: the priced file was too large to store in Airtable.' : '',
].filter(Boolean).join('\n');

// The raw payload is kept for audit, minus the two file blobs: they are
// stored as attachments, and a megabyte of base64 in a text cell helps nobody.
const rawForLog = Object.assign({}, body);
delete rawForLog.file;
delete rawForLog.quotedFile;

return [{ json: {
  ok: errors.length === 0,
  errorText: errors.join('; '),
  enquiryId: 'IQ-' + stamp,
  enquiryDate: $now.toISODate(),
  email: email,
  contactName: contactName,
  company: company,
  phone: phone,
  country: country,
  displayName: displayName,
  lineSummary: lineRows.join('\n') || 'No line detail sent with the upload.',
  requestedQty: s(summary.lineCount) || String(lines.length || ''),
  notesBlock: notesBlock,
  rawPayload: JSON.stringify(rawForLog, null, 2),
  fileName: fileName,
  fileType: fileType,
  file: inquiryTooBig ? '' : file,
  hasInquiryFile: !!file && !inquiryTooBig,
  quotedFileName: quotedFileName,
  quotedFileType: quotedFileType,
  quotedFile: quotedTooBig ? '' : quotedFile,
  hasQuotedFile: !!quotedFile && !quotedTooBig,
  // Consumed by extract-wanted-lines.js, which fans this out into one
  // Wanted row per line. Empty when every line priced — the good case.
  unmatchedLines: unmatchedLines,
  unmatchedCount: unmatchedLines.length,
} }];
