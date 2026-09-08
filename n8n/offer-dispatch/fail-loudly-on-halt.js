const upstream = $('Halt — Report Reason').all().map((i) => i.json || {});

let reason = upstream.map((u) => u.haltReason).filter(Boolean)[0] || '';
let sentSummary = '';

if (!reason) {
  // Approval path. The Wait node resumes with the clicked link's query string
  // (approved=true|false). When the 3-day window expires it passes its input
  // through unchanged, so there is no query at all.
  try {
    const w = $('Wait for Approval').first().json || {};
    const approved = w.query ? w.query.approved : undefined;
    if (approved === 'false') {
      reason = 'Approval DECLINED via the Decline link. Nothing was sent.';
    } else if (approved === undefined) {
      reason = 'Approval window (3 days) expired without an Approve or Decline click. Nothing was sent.';
    }
  } catch (e) { }
}

if (!reason) {
  try {
    const rows = $('Reconcile').all().map((i) => i.json || {});
    const first = rows[0] || {};
    if (first._summary) {
      const failures = rows
        .filter((r) => r['Dispatch Status'] === 'Failed')
        .map((r) => String(r['Notes'] || '').replace(/^Send failed: /, ''));
      const distinct = [...new Set(failures)].slice(0, 3);
      sentSummary = first._summary;
      reason = first._summary +
        (distinct.length ? ' First failure(s): ' + distinct.join(' | ') : '');
      if (failures.some((f) => /401|API key is invalid|unauthor/i.test(f))) {
        reason += ' >>> Resend rejected the API key: every send failed for the same reason, so fix the "Resend API Key" credential before re-queueing.';
      }
    }
  } catch (e) { }
}

if (!reason) reason = 'no reason recorded';

const offers = new Set();
for (const u of upstream) {
  [u.offerId, u._offerId, ...(Array.isArray(u.bundleOfferIds) ? u.bundleOfferIds : []), ...(Array.isArray(u._offerIds) ? u._offerIds : [])]
    .filter(Boolean).forEach((id) => offers.add(id));
}
if (!offers.size) {
  try {
    const rec = $('Reconcile').first().json || {};
    (rec._offerIds || []).forEach((id) => offers.add(id));
    if (rec._offerId) offers.add(rec._offerId);
  } catch (e) { }
}
if (!offers.size) {
  try {
    const br = $('Build Recipients').first().json || {};
    (br.bundleOfferIds || []).forEach((id) => offers.add(id));
    if (br.offerId) offers.add(br.offerId);
  } catch (e) { }
}

const sentNothing = !sentSummary || /\b0 sent\b/.test(sentSummary);

throw new Error(
  (sentNothing ? 'Offer dispatch HALTED and sent nothing. ' : 'Offer dispatch ended INCOMPLETE — some emails WERE sent. ') +
  'Reason: ' + reason +
  (offers.size ? '. Offer(s): ' + [...offers].join(', ') : '') +
  '. Queued for Dispatch has been cleared, so re-queue once the cause is fixed.'
);
