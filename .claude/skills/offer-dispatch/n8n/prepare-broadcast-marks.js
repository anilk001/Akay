/**
 * n8n Code node — "Prepare Broadcast Marks"
 * Mode: Run Once for All Items
 *
 * Added 2026-08-04 for bundle support. Turns the bundle's offer ID list
 * (Reconcile._offerIds) into one item per offer, so the downstream Airtable
 * update marks EVERY bundle member Broadcasted — not just one hardcoded ID.
 * Only reached when Dispatch Complete? already confirmed _markBroadcasted.
 */
const rec = $('Reconcile').first().json;
const ids = (Array.isArray(rec._offerIds) && rec._offerIds.length)
  ? rec._offerIds
  : (rec._offerId ? [rec._offerId] : []);

if (!ids.length) {
  throw new Error('Dispatch marked complete but no offer ID(s) found to mark Broadcasted — refusing to silently skip this step.');
}

return ids.map((id) => ({ json: { id, Status: 'Broadcasted' } }));

