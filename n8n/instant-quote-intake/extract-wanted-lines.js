/**
 * n8n Code node — "Extract Wanted Lines"
 * Workflow: Instant Quote Intake — quote.akay.ie (pXGfSBEn5ZdOT4nt)
 * Mode: Run Once for All Items
 * Sits after: Airtable → Create Enquiry
 * Feeds:      Airtable → Create Wanted, set to Map Automatically. The keys
 *             below are real Wanted columns and the unresolved ones are
 *             deleted, so auto-map sends exactly what resolved and nothing
 *             else. Manual mapping would send '' for a deleted key and fail
 *             the whole batch. See this folder's README.
 *
 * Fans the unmatched lines out into one item per `Wanted` row. It interprets
 * nothing — `validate-and-compose.js` already parsed every line — it only
 * reshapes into Airtable column names and attaches the two record ids that
 * exist only once the Enquiry has been written.
 *
 * WHY IT READS THE ENQUIRY RECORD RATHER THAN A SET NODE.
 * The Airtable create node emits `{ id, fields: {...} }` for the row it just
 * wrote, and the Client link is already on that row — so the enquiry id and
 * the client id both come from this node's own input, with no extra node to
 * keep in step.
 *
 * WHY EVERY EMPTY VALUE IS DROPPED.
 * Airtable rejects the whole batch on one bad select value, and this repo
 * writes with typecast off deliberately. The compose node emits '' for
 * anything it could not resolve to a real option; sending '' to a single
 * select fails the write, so the key is removed instead. A `Wanted` row with
 * no Category is a row someone can fix in five seconds — a failed batch loses
 * every line in the upload.
 *
 * WHY THE ROWS ARE MARKED FOR REVIEW.
 * `Brand` is a guess when the API did not send one (the buyer's own wording,
 * cut at the first number). `Claude Review Status: Pending Review` is the
 * existing column for exactly this, so a guess arrives visibly unreviewed
 * rather than as fact.
 *
 * IF NOTHING WENT UNPRICED this node returns [] and the branch simply ends —
 * that is the good week, not an error.
 */

// The Enquiry row Airtable just created.
const created = ($input.first() && $input.first().json) || {};
const enquiryRecordId = str(created.id);
const enquiryFields = (created.fields && typeof created.fields === 'object') ? created.fields : {};
// The Client link is already on the enquiry; Airtable returns it as an array
// of record ids.
const clientLink = Array.isArray(enquiryFields.Client) ? enquiryFields.Client.filter(Boolean) : [];

const compose = ($('Validate & Compose').first() && $('Validate & Compose').first().json) || {};
const lines = Array.isArray(compose.unmatchedLines) ? compose.unmatchedLines : [];
const enquiryId = str(compose.enquiryId);
const createdDate = str(compose.enquiryDate);
const buyer = str(compose.displayName);

// `Wanted.Source` has no "Instant Quote" option — the live choices are
// Enquiry, Digest Link, WhatsApp, Email and Manual — and every row here does
// arrive through an Enquiry, so "Enquiry" is true rather than a fallback. The
// origin is stamped into Trader Notes as well, which is what the weekly digest
// counts. Add an "Instant Quote" option in Airtable and change this constant;
// nothing else needs touching.
const WANTED_SOURCE = 'Enquiry';

return lines.map(function (line, i) {
  const fields = {
    'Wanted ID': (enquiryId ? enquiryId.replace(/^IQ-/, 'W-IQ-') : 'W-IQ') + '-' + (i + 1),
    Status: 'Open',
    Source: WANTED_SOURCE,
    'Claude Review Status': 'Pending Review',
    'Product Name': str(line.productName),
    Brand: str(line.brand),
    Variant: str(line.variant),
    'Volume ML': posNum(line.volumeMl),
    Category: str(line.category),
    Qty: posNum(line.qty),
    'Qty Unit': str(line.qtyUnit),
    'Target Price': posNum(line.targetPrice),
    Currency: str(line.currency),
    'Bond/Customs Status': str(line.bond),
    'Created Date': createdDate,
    'Trader Notes': [
      'Source: Instant Quote (quote.akay.ie) — ' + (enquiryId || 'enquiry id unknown'),
      'Buyer: ' + (buyer || 'unattributed'),
      'We had nothing to price against this line.',
      'As written: ' + str(line.raw),
    ].join('\n'),
  };

  if (enquiryRecordId) fields['Source Enquiry'] = [enquiryRecordId];
  if (clientLink.length) fields.Client = clientLink;

  // Drop anything unresolved rather than writing a value the base would reject.
  Object.keys(fields).forEach(function (k) {
    const v = fields[k];
    if (v === '' || v === null || v === undefined) delete fields[k];
  });

  return { json: fields };
});

function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function posNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
