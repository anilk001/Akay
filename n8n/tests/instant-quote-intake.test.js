/**
 * Tests for the "Validate & Compose" Code node of Instant Quote Intake.
 *
 * The node source is LOADED AND EXECUTED, not re-typed here — same approach as
 * the trade-terms tests, so a rule changed in the node is a rule the tests see.
 * An n8n Code node is a function body, so it is wrapped in `new Function` and
 * handed fakes for the two globals it uses, `$input` and `$now`.
 *
 * What is worth asserting here is what the workflow would get wrong silently:
 * an upload logged with no file, contact details dropped on the floor, or a
 * file too large for Airtable written as if it had been stored.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildIntakePayload } from '../instant-quote-intake/trade-desk-api/post-to-intake.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'instant-quote-intake', 'validate-and-compose.js');
const nodeFn = new Function('$input', '$now', readFileSync(SRC, 'utf8'));

const NOW = {
  toFormat: () => '20260914-101500',
  toISODate: () => '2026-09-14',
};

const B64 = 'UHJvZHVjdCxRdHkK'; // "Product,Qty\n"

function run(body) {
  return nodeFn({ first: () => ({ json: { body } }) }, NOW)[0].json;
}

let n = 0;
const eq = (a, b, what) => { assert.equal(a, b, what); n += 1; };
const ok = (v, what) => { assert.ok(v, what); n += 1; };

// --- the one fatal error -----------------------------------------------------
// Both things this workflow exists to do need the file, so nothing else is
// worth attempting without it.
const noFile = run({ email: 'buyer@example.com' });
eq(noFile.ok, false, 'an upload with no file is rejected');
ok(noFile.errorText.includes('no inquiry file'), 'and says why');

// --- a missing email is NOT fatal -------------------------------------------
// An unattributable buying list is still a buying signal. It is logged with no
// client to link to rather than thrown away.
const anon = run({ file: B64, fileName: 'list.csv' });
eq(anon.ok, true, 'an upload with no contact details is still accepted');
eq(anon.email, '', 'with no email to match a client on');
eq(anon.displayName, 'Unattributed upload', 'and a name that says so on the record');

// A malformed address is a different thing from no address: it means the form
// or the API sent something broken, and silently filing it loses the buyer.
const badEmail = run({ file: B64, email: 'not-an-address' });
eq(badEmail.ok, false, 'a malformed email is rejected');
ok(badEmail.errorText.includes('invalid email'), 'and says which field');

// --- contact details survive intact -----------------------------------------
const full = run({
  file: B64,
  fileName: 'my list.xlsx',
  quotedFile: B64,
  email: 'Buyer@Example.COM',
  name: 'Jane Buyer',
  company: 'Buyer Wholesale Ltd',
  phone: '+353871234567',
  country: 'Ireland',
  lines: [{ description: 'Jameson 70cl', matched: 'Jameson 6x70cl', qty: 50, price: '17.95' }],
  summary: { lineCount: 1, matchedCount: 1, total: 897.5, currency: 'EUR' },
});
eq(full.ok, true, 'a complete upload passes');
eq(full.email, 'buyer@example.com', 'the email is lower-cased for matching the Clients table');
eq(full.displayName, 'Buyer Wholesale Ltd', 'the company names the record when given');
eq(full.enquiryId, 'IQ-20260914-101500', 'the enquiry id marks the source and the minute');
ok(full.notesBlock.includes('+353871234567'), 'the phone reaches the enquiry note');
ok(full.notesBlock.includes('897.5 EUR'), 'so does the quoted total');
ok(full.lineSummary.includes('matched: Jameson 6x70cl'), 'and what each line was priced against');
eq(full.hasInquiryFile, true, 'the buyer file is flagged for upload');
eq(full.hasQuotedFile, true, 'so is the priced file');
eq(full.quotedFileName, 'priced-my list.xlsx', 'the priced file is named after theirs when the API does not name it');

// Falling back to the contact name, then the email, keeps the record readable
// when a buyer fills in less than the form asked for.
eq(run({ file: B64, name: 'Jane Buyer' }).displayName, 'Jane Buyer', 'contact name is the second choice');
eq(run({ file: B64, email: 'jane@example.com' }).displayName, 'jane@example.com', 'the email is the last');

// --- the files never reach the audit cell -----------------------------------
// A megabyte of base64 in a text cell makes the record unopenable, and the
// files are on the record as attachments anyway.
ok(!full.rawPayload.includes(B64), 'the raw payload keeps no copy of the file blobs');
ok(full.rawPayload.includes('Buyer Wholesale Ltd'), 'but keeps everything else for audit');

// --- Airtable's 5 MB ceiling ------------------------------------------------
// Rejected by Airtable after the enquiry exists, this would leave a record that
// silently has no file. Caught here, the enquiry still gets written and the
// note says what happened.
const huge = 'A'.repeat(5 * 1024 * 1024 + 1);
const tooBig = run({ file: huge, email: 'buyer@example.com' });
eq(tooBig.ok, true, 'an oversized file does not lose the enquiry');
eq(tooBig.hasInquiryFile, false, 'the upload is skipped');
eq(tooBig.file, '', 'and the blob is dropped rather than half-sent');
ok(tooBig.notesBlock.includes('too large'), 'the record says the file was not stored');

// --- the honeypot -----------------------------------------------------------
const bot = run({ file: B64, email: 'bot@example.com', company_website: 'http://spam.example' });
eq(bot.ok, false, 'a filled honeypot is rejected');

// --- unmatched lines become the buying brief --------------------------------
// A line the API priced has `matched`. One without it is a customer telling us
// what to stock, and it is the only record of that fact — so what the parser
// gets right here is what the Wanted row and the Monday digest get right.
const mixed = run({
  file: B64,
  email: 'jane@buyer.ie',
  company: 'Buyer Wholesale Ltd',
  lines: [
    { description: 'Jameson 12 x 70cl 40%', matched: 'Jameson 6x70cl', qty: 50, price: '17.95 EUR/btl' },
    { description: 'Johnnie Walker Black Label 12 x 70cl 40% T1', qty: 20, target: '22.50 EUR' },
    { description: 'Heineken 24 x 330ml can pallets', qty: 4 },
    { description: 'Hendricks Gin 6 x 0.7L', qty: 10, cost: 26 },
  ],
  summary: { lineCount: 4, matchedCount: 1, currency: 'EUR' },
});

eq(mixed.unmatchedCount, 3, 'only the lines with no match are carried forward');
ok(mixed.notesBlock.includes('Lines we could not price: 3'), 'and the enquiry record says how many');

const [jw, heineken, hendricks] = mixed.unmatchedLines;
eq(jw.brand, 'Johnnie Walker Black Label', 'the brand is what was typed before the pack');
eq(jw.volumeMl, 700, '70cl is 700ml');
eq(jw.bond, 'T1', 'a bond marker in the line is kept — T1 and T2 are different products');
eq(jw.targetPrice, 22.5, "the buyer's own target is the reason the row is actionable");
eq(jw.currency, 'EUR', 'read from the line itself');
eq(heineken.qtyUnit, 'Pallets', 'the unit comes from the words the buyer used');
eq(hendricks.volumeMl, 700, '0.7L is the same 700ml, so it groups with 70cl');
eq(hendricks.category, 'Spirits', 'category is inferred when a word gives it away');
eq(hendricks.currency, 'EUR', "a bare cost falls back to the quote's currency");

// Every select value must be a real option or empty — Airtable rejects the
// WHOLE batch on one unknown value, and this repo writes with typecast off.
const CATEGORIES = ['', 'Beer', 'Spirits', 'Champagne', 'Wine', 'Grocery', 'Confectionery', 'Toiletries', 'Soft Drinks', 'Other FMCG'];
const UNITS = ['', 'Cases', 'Pallets', 'Containers', 'Bottles', 'Pieces'];
const CURRENCIES = ['', 'EUR', 'USD', 'GBP', 'AED', 'SGD', 'Other'];
const BONDS = ['', 'Either', 'T1', 'T2', 'Bonded', 'Duty Paid', 'On Floor', 'Other'];
const wild = run({
  file: B64,
  lines: [
    { description: 'Something nobody has a word for, 99 blorks', qty: 3, category: 'Fictional' },
    { description: 'Mystery item', qty: 1 },
  ],
});
for (const line of wild.unmatchedLines) {
  ok(CATEGORIES.includes(line.category), `category "${line.category}" is a real option or empty`);
  ok(UNITS.includes(line.qtyUnit), `qty unit "${line.qtyUnit}" is a real option or empty`);
  ok(CURRENCIES.includes(line.currency), `currency "${line.currency}" is a real option or empty`);
  ok(BONDS.includes(line.bond), `bond status "${line.bond}" is a real option or empty`);
}

// An all-matched upload is the good case, not an empty-list bug.
const allMatched = run({
  file: B64,
  lines: [{ description: 'Jameson 70cl', matched: 'Jameson 6x70cl', qty: 10 }],
});
eq(allMatched.unmatchedCount, 0, 'nothing to source when every line priced');
eq(allMatched.unmatchedLines.length, 0, 'and no empty rows are invented');

// --- the fan-out into Wanted rows -------------------------------------------
const EXTRACT = join(dirname(fileURLToPath(import.meta.url)), '..', 'instant-quote-intake', 'extract-wanted-lines.js');
const extractFn = new Function('$input', '$', readFileSync(EXTRACT, 'utf8'));

function extract(compose, enquiry) {
  const $node = (name) => {
    if (name !== 'Validate & Compose') throw new Error(`unexpected node reference: ${name}`);
    return { first: () => ({ json: compose }) };
  };
  return extractFn({ first: () => ({ json: enquiry }) }, $node).map((i) => i.json);
}

const wanted = extract(mixed, { id: 'recENQUIRY1234567', fields: { Client: ['recCLIENT12345678'] } });
eq(wanted.length, 3, 'one Wanted row per unpriced line');
eq(wanted[0].Status, 'Open', 'open until the matcher or a human closes it');
eq(wanted[0].Source, 'Enquiry', 'a real option on Wanted.Source — "Instant Quote" is not one yet');
ok(wanted[0]['Trader Notes'].includes('Instant Quote'), 'so the origin is stamped where the digest can count it');
eq(wanted[0]['Claude Review Status'], 'Pending Review', 'a guessed brand arrives visibly unreviewed');
assert.deepEqual(wanted[0]['Source Enquiry'], ['recENQUIRY1234567'], 'linked back to the enquiry it came from');
n += 1;
assert.deepEqual(wanted[0].Client, ['recCLIENT12345678'], 'and to the buyer who asked');
n += 1;
ok(wanted[0]['Wanted ID'] !== wanted[1]['Wanted ID'], 'each row gets its own id');

// The reason empties are dropped rather than sent: '' fails a single select.
ok(!('Category' in wanted[0]), 'an unresolved select is omitted, never sent as an empty string');
ok(!('Qty Unit' in wanted[0]), 'same for a unit nobody stated');
ok('Category' in wanted[2], 'but a resolved one is written');

// No client on the enquiry must not stop the demand being captured.
const anonWanted = extract(mixed, { id: 'recENQUIRY1234567', fields: {} });
eq(anonWanted.length, 3, 'an unattributed upload still produces rows');
ok(!('Client' in anonWanted[0]), 'with no client link rather than an empty one');

eq(extract(allMatched, { id: 'recENQUIRY1234567', fields: {} }).length, 0, 'a fully priced upload writes nothing');

// --- the other end of the contract ------------------------------------------
// `post-to-intake.js` is the module that belongs in trade-desk-api. Running a
// REAL Trade Desk pricing result through it and then through both nodes is the
// only place the two halves are checked against each other: if the API's
// response shape moves, or the adapter stops marking a line as unmatched, the
// buying brief quietly goes empty and nothing else would notice.
//
// The row shape below is the one the shipped SPA reads (quote/assets/*.js):
// description, match {brand, productName, variant, volumeMl, pcsPerCase,
// warehouse, stockCases, confidence, matchMethod}, needsReview, quantity,
// quantityBasis, customerPriceBase, wholesalePrice, wholesaleCurrency,
// wholesaleBasis, lineSaving, marginPct, note, sourceRow, rowId.
const apiResult = {
  summary: {
    totalRows: 4, matchedRows: 2, needsReviewRows: 1, comparableRows: 2,
    totalWholesaleValue: 8420.5, totalCustomerValue: 8991,
    savingPct: 6.3, totalSaving: 570.5, currency: 'EUR',
  },
  results: [
    {
      rowId: 'r1', sourceRow: 2, description: 'Jameson 12 x 70cl',
      match: { brand: 'Jameson', productName: 'Irish Whiskey', variant: '12x70cl', volumeMl: 700, pcsPerCase: 12, warehouse: 'Shannon', stockCases: 340, confidence: 0.98, matchMethod: 'exact' },
      needsReview: false, quantity: 50, quantityBasis: 'Cases',
      customerPriceBase: 18.4, wholesalePrice: 17.95, wholesaleCurrency: 'EUR', wholesaleBasis: 'Per Bottle',
      lineSaving: 270, marginPct: 2.4,
    },
    {
      rowId: 'r2', sourceRow: 3, description: 'Absolut blue 1ltr',
      match: { brand: 'Absolut', productName: 'Vodka', variant: '6x1L', volumeMl: 1000, pcsPerCase: 6, stockCases: 12, confidence: 0.55, matchMethod: 'fuzzy' },
      needsReview: true, quantity: 20, quantityBasis: 'Cases',
      customerPriceBase: 11.2, wholesalePrice: 11.05, wholesaleCurrency: 'EUR', wholesaleBasis: 'Per Bottle',
      lineSaving: 18, marginPct: 1.3,
    },
    {
      rowId: 'r3', sourceRow: 4, description: 'Johnnie Walker Black Label 12 x 70cl T1',
      match: null, needsReview: false, quantity: 20, quantityBasis: 'Cases',
      customerPriceBase: 22.5, wholesalePrice: null, lineSaving: null, marginPct: null,
      note: 'no live offer',
    },
    {
      rowId: 'r4', sourceRow: 5, description: 'Hendricks Gin 6 x 0.7L',
      match: null, needsReview: false, quantity: 10, quantityBasis: 'Cases',
      customerPriceBase: null, wholesalePrice: null, lineSaving: null, marginPct: null,
    },
  ],
};

const payload = buildIntakePayload({
  result: apiResult,
  upload: { name: 'march-buy.xlsx', type: 'application/vnd.ms-excel', buffer: Buffer.from('Product,Qty\n') },
  quoted: { name: 'march-buy-priced.xlsx', type: 'application/vnd.ms-excel', buffer: Buffer.from('Product,Qty,Price\n') },
  contact: { email: 'Jane@Buyer.IE', company: 'Buyer Wholesale Ltd' },
});

eq(payload.lines.length, 4, 'every row travels, matched or not');
ok(!!payload.lines[0].matched, 'a confident match carries the SKU it matched');
eq(payload.lines[0].price, '17.95 EUR/Bottle', 'with our price as the buyer already saw it');
ok(!!payload.lines[1].matched, 'a low-confidence match still counts as quoted');
eq(payload.lines[1].needsReview, true, 'but travels flagged so the desk can look');
ok(!('matched' in payload.lines[2]), 'an unmatched line carries no `matched` key — this is what creates the demand row');
eq(payload.lines[2].target, 22.5, "and carries the buyer's own price, which is what makes it actionable");

// Margin-shaped numbers stay in the API. `marginPct` sits under "Line saving"
// in the SPA so it is probably the buyer's saving, but "probably" is not a
// reason to copy it into Airtable and from there into a weekly email.
const wire = JSON.stringify(payload);
ok(!wire.includes('marginPct'), 'no margin field is forwarded');
ok(!wire.includes('lineSaving'), 'nor the per-line saving');
ok(!wire.includes('alternatives'), 'nor the alternatives list');

// …and the whole chain, end to end.
const composed = run(payload);
eq(composed.ok, true, 'the webhook accepts a real Trade Desk payload');
eq(composed.unmatchedCount, 2, 'two lines had nothing to price against');
const rows = extract(composed, { id: 'recENQUIRY1234567', fields: { Client: ['recCLIENT12345678'] } });
eq(rows.length, 2, 'so two Wanted rows are written');
eq(rows[0].Brand, 'Johnnie Walker Black Label', 'parsed from what the buyer typed');
eq(rows[0]['Target Price'], 22.5, "with their own target carried through from the API");
eq(rows[0]['Bond/Customs Status'], 'T1', 'and the bond marker they wrote');
eq(rows[0]['Qty Unit'], 'Cases', 'and the unit the API reported');
eq(rows[1].Brand, 'Hendricks Gin', 'the second line too');
ok(!('Target Price' in rows[1]), 'a line with no stated price says nothing rather than zero');

console.log(`instant-quote-intake: ${n} assertions passed`);
