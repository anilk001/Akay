/**
 * Defence in depth. Everything here was already asserted by the Airtable
 * formula; we assert it again in code because a formula typo silently widens
 * the delete set, and the cost of that is the whole audit trail. A row that
 * fails re-validation is dropped from the batch, not deleted.
 *
 * Only three fields are requested upstream so items stay tiny - building fat
 * per-item objects is what OOM-crashed run 11091.
 */

const gate = $('Backup Gate').first().json;
const cutoffMs = Date.parse(gate.cutoff);
const BLOCKED = ['Draft', 'Ready to Send'];

const rows = $input.all();
const keep = [];
let skippedNoDate = 0;
let skippedTooNew = 0;
let skippedPending = 0;

for (const r of rows) {
  const j = r.json || {};
  const fields = j.fields || j;
  const id = j.id || fields.id || '';
  const sent = fields['Sent Date'];
  const dispatch = String(fields['Dispatch Status'] || '');
  if (!id) continue;
  if (!sent) { skippedNoDate++; continue; }
  const t = Date.parse(sent);
  if (!isFinite(t)) { skippedNoDate++; continue; }
  if (t >= cutoffMs) { skippedTooNew++; continue; }
  if (BLOCKED.indexOf(dispatch) !== -1) { skippedPending++; continue; }
  keep.push({ recordId: id, logId: String(fields['Log ID'] || ''), sentDate: sent, dispatchStatus: dispatch });
}

// A candidate set this large means the filter is wrong, not that the business
// suddenly sent 25,000 emails. Fail loudly and delete nothing.
if (keep.length > gate.abortIfMoreThan) {
  throw new Error('Purge aborted: ' + keep.length + ' rows matched, exceeding the ' + gate.abortIfMoreThan + ' safety ceiling. Nothing was deleted.');
}

const batch = keep.slice(0, gate.maxPerRun);

return batch.map((b, i) => ({ json: Object.assign({}, b, {
  _candidateTotal: keep.length,
  _batchSize: batch.length,
  _remainingAfter: keep.length - batch.length,
  _skippedNoDate: skippedNoDate,
  _skippedTooNew: skippedTooNew,
  _skippedPending: skippedPending,
}) }));
