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

console.log(`instant-quote-intake: ${n} assertions passed`);
