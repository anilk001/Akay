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
 * THE TWO THINGS THE WORKFLOW EXISTS FOR:
 *   1. the buyer's own file and the priced copy end up on one Enquiries record,
 *      linked to the Client;
 *   2. ak@akay.ie gets the priced file by email.
 * Both need a file, so a missing file is the one fatal error.
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
} }];
