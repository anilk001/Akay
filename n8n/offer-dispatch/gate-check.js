/**
 * n8n Code node — "Gate Check"  (workflow dAYMAj6mZD3hTV4T, Offer Dispatch — Akay)
 * Mode: Run Once for All Items   <-- CHANGED from "Run Once for Each Item"
 *
 * WHY THE MODE CHANGED. Per-item, an offer that failed the gate emitted its
 * own gatePassed:false item. "Gate Passed?" routed that item to
 * Halt — Report Reason → Untick Queue on Halt → Fail Loudly on Halt, and that
 * last node THROWS. So one expired offer in a queue of three stopped the other
 * two from going out and turned the whole run red — and you only found out
 * about the second bad offer on the next attempt, because the first throw
 * ended the execution.
 *
 * Running once for all items lets the run proceed with whatever passed and
 * carry the rest along as `skippedOffers` (surfaced in the approval email), and
 * halts only when NOTHING passes — in which case the halt reason names every
 * failing condition on every offer at once, so one fix-and-re-queue cycle
 * clears them all instead of one per cycle.
 *
 * A skipped offer keeps its Queued for Dispatch tick: it was never dispatched,
 * so it stays in the queue and gets another chance once the field is fixed.
 * Only a run where nothing passed unticks, which is what Untick Queue on Halt
 * reads `bundleOfferIds` for.
 */

const offers = $input.all().map((i) => i.json);

const passed = [];
const skipped = [];

for (const offer of offers) {
  const f = offer.fields || offer;
  const failures = [];
  const check = (label, actual, ok) => {
    if (!ok) failures.push(`${label} = ${JSON.stringify(actual ?? null)}`);
  };

  check('Status', f['Status'], f['Status'] === 'Live');
  check('Is Expired', f['Is Expired'], f['Is Expired'] === 'No');
  check('Do Not Broadcast', f['Do Not Broadcast'], !f['Do Not Broadcast']);
  check('Offer Approval Status', f['Offer Approval Status'], f['Offer Approval Status'] === 'Approved');

  const formulaSaysYes = String(f['Send Eligible']).toLowerCase() === 'yes';
  if (formulaSaysYes && failures.length) {
    failures.push('Send Eligible says Yes but a component condition failed — formula and gate check disagree');
  }
  if (!formulaSaysYes && !failures.length) {
    failures.push('Send Eligible says No but every component condition passed — formula and gate check disagree');
  }

  const offerName = f['Offer Name'] || '(unnamed)';

  if (failures.length) {
    skipped.push({ offerId: offer.id, offerName, failures });
  } else {
    passed.push({
      offerId: offer.id,
      offerName,
      bondStatus: f['Bond/Customs Status'] || null,
      offerFields: f,
    });
  }
}

if (!passed.length) {
  const detail = skipped.map((s) => `"${s.offerName}" — ${s.failures.join('; ')}`).join('  |  ');
  return [{
    json: {
      gatePassed: false,
      offerId: skipped.length === 1 ? skipped[0].offerId : null,
      bundleOfferIds: skipped.map((s) => s.offerId),
      offerName: skipped.length === 1 ? skipped[0].offerName : `${skipped.length} offer(s)`,
      skippedOffers: skipped,
      haltReason: skipped.length
        ? `Dispatch blocked — no queued offer passed the gate. Failing condition(s) on all ${skipped.length} offer(s): ${detail}`
        : 'Dispatch blocked — no offers reached Gate Check at all.',
    },
  }];
}

return passed.map((p) => ({ json: { ...p, gatePassed: true, skippedOffers: skipped } }));
