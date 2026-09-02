/**
 * n8n Code node — "Reconcile"
 * Mode: Run Once for All Items
 *
 * Runs after the per-recipient Resend calls. Emits ONE ITEM PER RECIPIENT so
 * the downstream Airtable "Create" writes one Offers Sent Log row each. Each
 * log row's Offer link now points at EVERY bundle member (multipleRecordLinks
 * accepts an array), not just the first offer, and the aggregate `_offerIds`
 * is carried on every row so the later broadcast-marking step can mark all of
 * them, not only one.
 *
 * Send metadata is read from 'Build Sends', not from $input, because the HTTP
 * Request node ('Send via Resend') replaces item JSON with the API response —
 * see the 2026-08-03 incident note this fix originally carried.
 */

const recipients = $('Build Recipients').first().json;
const expected = recipients.recipientCount;

const sends = $('Build Sends').all().map((i) => i.json || {});
const results = $input.all().map((i) => i.json || {});

if (sends.length !== results.length) {
  throw new Error(
    'Cannot reconcile: Build Sends produced ' + sends.length + ' payload(s) but ' +
    'Send via Resend returned ' + results.length + ' response(s). Index alignment ' +
    'is unsafe, so log rows would be attributed to the wrong clients. Aborting ' +
    'before writing anything.'
  );
}

const rows = [];
const failures = [];
const now = new Date().toISOString();
const bundleOfferIds = (sends[0] && Array.isArray(sends[0].offerIds) && sends[0].offerIds.length)
  ? sends[0].offerIds
  : (recipients.offerId ? [recipients.offerId] : []);

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const s = sends[i];

  const messageId = r.id || r.messageId || (r.data && r.data.id) || null;
  const ok = Boolean(messageId) && !r.error;

  const fields = {
    'Log ID': (s.offerId || 'offer') + '-' + (s.clientId || 'client') + '-' + now.slice(0, 10),
    'Channel': 'Email',
    'Sent Date': now,
    'Dispatch Status': ok ? 'Sent' : 'Failed',
    'Client Name Cache': s.clientName || '',
    'Client Email Cache': s.clientEmail || '',
    'Notes': ok ? 'Resend message id ' + messageId : 'Send failed: ' + errText(r),
  };
  if (s.clientId) fields['Client'] = [s.clientId];
  const offerIdsForRow = (Array.isArray(s.offerIds) && s.offerIds.length) ? s.offerIds : (s.offerId ? [s.offerId] : []);
  if (offerIdsForRow.length) fields['Offer'] = offerIdsForRow;

  rows.push(fields);
  if (!ok) failures.push((s.clientName || s.clientEmail || 'unknown') + ': ' + errText(r));
}

const sent = rows.filter((f) => f['Dispatch Status'] === 'Sent').length;
const complete = rows.length === expected && expected > 0 && failures.length === 0;
const summary = complete
  ? 'Dispatch complete — ' + sent + '/' + expected + ' sent, marking Broadcasted'
  : 'Dispatch INCOMPLETE — ' + sent + ' sent of ' + expected + ' expected, ' + failures.length +
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
