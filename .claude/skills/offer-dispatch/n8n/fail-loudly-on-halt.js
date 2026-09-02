/**
 * n8n Code node — "Fail Loudly on Halt"   (Offer Dispatch — Akay, dAYMAj6mZD3hTV4T)
 * Mode: Run Once for All Items
 *
 * SOURCE OF TRUTH: repo .claude/skills/offer-dispatch/n8n/fail-loudly-on-halt.js.
 *
 * A halt IS a failed dispatch attempt, so surface it as one. "Halt — Report
 * Reason" is a NoOp that reported the reason to nobody, which is why a queued
 * offer could simply never go out with no notification anywhere. Throwing here
 * makes the ERROR HANDLER workflow (this workflow's errorWorkflow setting)
 * email ak@akay.ie with the reason.
 *
 * This node must stay LAST on the halt path: Untick Queue on Halt and Write
 * Clear Flag on Halt run first, so the offer is never left stuck ticked. It
 * does need re-queueing by hand once the cause is fixed.
 *
 * Updated 2026-09-02. Only the gate nodes put a `haltReason` on their item.
 * The two halt paths that matter most carried none, so the alert read
 * "no reason recorded" on 21497 and 29315 (approval declined) and on 28559
 * (all 507 sends rejected by Resend with a 401 — the one alert that should
 * have said "check the Resend key"). The reason is now recovered from the
 * node that actually decided the halt: Await Approval on a decline or timeout,
 * Reconcile on a failed or partial send (with the first failure messages, so a
 * 401 reads as a 401), and Composed? / Recipients OK? via their haltReason.
 */
const upstream = $('Halt — Report Reason').all().map((i) => i.json || {});

let reason = upstream.map((u) => u.haltReason).filter(Boolean)[0] || '';
let sentSummary = '';

if (!reason) {
  try {
    const a = $('Await Approval').first().json || {};
    if (a.data && a.data.approved === false) {
      reason = 'Approval DECLINED (or the 3-day approval window expired without a click)' +
        (a.data.respondedAt ? ' at ' + a.data.respondedAt : '') + '. Nothing was sent.';
    }
  } catch (e) { /* approval never ran on this path */ }
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
        reason += ' >>> Resend rejected the API key: every send failed for the same reason, so fix the "Bearer Auth account" credential before re-queueing.';
      }
    }
  } catch (e) { /* Reconcile did not run on this halt path */ }
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
  } catch (e) { /* not on this path */ }
}
if (!offers.size) {
  try {
    const br = $('Build Recipients').first().json || {};
    (br.bundleOfferIds || []).forEach((id) => offers.add(id));
    if (br.offerId) offers.add(br.offerId);
  } catch (e) { /* not on this path */ }
}

const sentNothing = !sentSummary || /\b0 sent\b/.test(sentSummary);

throw new Error(
  (sentNothing ? 'Offer dispatch HALTED and sent nothing. ' : 'Offer dispatch ended INCOMPLETE — some emails WERE sent. ') +
  'Reason: ' + reason +
  (offers.size ? '. Offer(s): ' + [...offers].join(', ') : '') +
  '. Queued for Dispatch has been cleared, so re-queue once the cause is fixed.'
);
