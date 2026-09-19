/**
 * n8n Code node — "Reconcile"  (workflow dAYMAj6mZD3hTV4T, Offer Dispatch — Akay)
 * Mode: Run Once for All Items
 *
 * Maps Resend message ids back to clients and builds the Sent Log rows.
 *
 * Input is now ONE ITEM PER BATCH (see build-sends.js), not one per recipient.
 * Resend's docs for /emails/batch state: "each entry in data corresponds to
 * the email at the same index in the batch payload (0-based)". That documented
 * ordering is the whole basis for attributing a message id to a client, so the
 * length checks below are not paranoia — if the response does not line up, the
 * rows would name the wrong people and we refuse to write any.
 */

const recipients = $('Build Recipients').first().json;
const expected = recipients.recipientCount;

const batches = $('Build Sends').all().map((i) => i.json || {});
const responses = $input.all().map((i) => i.json || {});

if (batches.length !== responses.length) {
  throw new Error(
    'Cannot reconcile: Build Sends produced ' + batches.length + ' batch(es) but ' +
    'Send via Resend returned ' + responses.length + ' response(s). Index alignment ' +
    'is unsafe, so log rows would be attributed to the wrong clients. Aborting ' +
    'before writing anything.'
  );
}

const rows = [];
const failures = [];
const now = new Date().toISOString();
const bundleOfferIds = (batches[0] && Array.isArray(batches[0].offerIds) && batches[0].offerIds.length)
  ? batches[0].offerIds
  : (recipients.offerId ? [recipients.offerId] : []);

for (let b = 0; b < batches.length; b++) {
  const batch = batches[b];
  const resp = responses[b] || {};
  const members = Array.isArray(batch.members) ? batch.members : [];
  const label = 'batch ' + (b + 1) + '/' + batches.length;

  // "Send via Resend" runs with onError: continueRegularOutput, so a request
  // that failed outright arrives here as an item carrying an error instead of
  // a data array. Every member of that batch is then a failure — one bad
  // request is 100 unsent emails, and they must all show up in the log.
  const data = Array.isArray(resp.data) ? resp.data : null;
  let batchError = null;
  if (resp.error) batchError = errText(resp);
  else if (!data) batchError = label + ' returned no data array: ' + preview(resp);

  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const entry = (!batchError && data) ? data[i] : null;
    const messageId = entry ? (entry.id || entry.messageId || null) : null;
    const ok = Boolean(messageId);

    let note;
    if (ok) note = 'Resend message id ' + messageId;
    else if (batchError) note = 'Send failed: ' + batchError;
    else if (!data || i >= data.length) note = 'Send failed: ' + label + ' returned ' + ((data && data.length) || 0) + ' result(s) for ' + members.length + ' email(s) — no result for this address';
    else note = 'Send failed: no message id returned for this address';

    const fields = {
      'Log ID': (m.offerId || 'offer') + '-' + (m.clientId || 'client') + '-' + now.slice(0, 10),
      'Channel': 'Email',
      'Sent Date': now,
      'Dispatch Status': ok ? 'Sent' : 'Failed',
      'Client Name Cache': m.clientName || '',
      'Client Email Cache': m.clientEmail || '',
      'Notes': note,
    };
    if (m.clientId) fields['Client'] = [m.clientId];
    const offerIdsForRow = (Array.isArray(m.offerIds) && m.offerIds.length) ? m.offerIds : (m.offerId ? [m.offerId] : []);
    if (offerIdsForRow.length) fields['Offer'] = offerIdsForRow;

    rows.push(fields);
    if (!ok) failures.push((m.clientName || m.clientEmail || 'unknown') + ': ' + note.replace(/^Send failed: /, ''));
  }
}

const sent = rows.filter((f) => f['Dispatch Status'] === 'Sent').length;
const complete = rows.length === expected && expected > 0 && failures.length === 0;
const summary = complete
  ? 'Dispatch complete — ' + sent + '/' + expected + ' sent across ' + batches.length + ' batch(es), marking Broadcasted'
  : 'Dispatch INCOMPLETE — ' + sent + ' sent of ' + expected + ' expected across ' + batches.length + ' batch(es), ' + failures.length +
    ' failed. Status left as Live so the offer stays in Ready to Send and can be retried.';

return rows.map((fields) => ({
  json: {
    ...fields,
    _markBroadcasted: complete,
    _offerId: recipients.offerId,
    _offerIds: bundleOfferIds,
    _expected: expected,
    _sent: sent,
    _failed: failures.length,
    _summary: summary,
  },
}));

function errText(r) {
  if (!r) return 'no response';
  if (typeof r.error === 'string') return r.error;
  if (r.error && r.error.message) return r.error.message;
  if (r.message) return String(r.message);
  return 'no message id returned';
}

function preview(r) {
  try {
    return JSON.stringify(r).slice(0, 200);
  } catch (e) {
    return '(unserialisable response)';
  }
}
