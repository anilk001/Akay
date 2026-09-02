/**
 * n8n Code node — "Gate Check"
 * Mode: Run Once for Each Item
 *
 * Re-verifies every dispatch condition on the triggering Offer record.
 *
 * UPDATED 2026-08-04: Send Approval Status and Price Level were removed from
 * this check. Send Eligible's own formula was simplified to 4 conditions on
 * 2026-07-31 (dropping those same two), and Send Approval Status has now been
 * deleted from the Offers table entirely — checking it here would fail every
 * single offer. The four conditions below match Send Eligible's real formula.
 *
 * Send Eligible (fldgV6jqX8OX8J6js), verbatim from the base:
 *   IF(AND(
 *     {Status}="Live", {Is Expired}="No", NOT({Do Not Broadcast}),
 *     {Offer Approval Status}="Approved"
 *   ), "Yes", "No")
 */

const offer = $input.item.json;
const f = offer.fields || offer;

const failures = [];

const check = (label, actual, ok) => {
  if (!ok) failures.push(`${label} = ${JSON.stringify(actual ?? null)}`);
};

check('Status', f['Status'], f['Status'] === 'Live');
check('Is Expired', f['Is Expired'], f['Is Expired'] === 'No');
check('Do Not Broadcast', f['Do Not Broadcast'], !f['Do Not Broadcast']);
check('Offer Approval Status', f['Offer Approval Status'], f['Offer Approval Status'] === 'Approved');

// Belt and braces: the formula's own verdict must agree with our reading of the
// parts. A disagreement means the formula was changed and this node was not —
// stop rather than trust either one.
const formulaSaysYes = String(f['Send Eligible']).toLowerCase() === 'yes';
if (formulaSaysYes && failures.length) {
  failures.push('Send Eligible says Yes but a component condition failed — formula and gate check disagree');
}
if (!formulaSaysYes && !failures.length) {
  failures.push('Send Eligible says No but every component condition passed — formula and gate check disagree');
}

if (failures.length) {
  return {
    json: {
      offerId: offer.id,
      offerName: f['Offer Name'] || '(unnamed)',
      gatePassed: false,
      haltReason: `Dispatch blocked. Failing condition(s): ${failures.join('; ')}`,
      failures,
    },
  };
}

return {
  json: {
    offerId: offer.id,
    offerName: f['Offer Name'] || '(unnamed)',
    gatePassed: true,
    bondStatus: f['Bond/Customs Status'] || null,
    offerFields: f,
  },
};
