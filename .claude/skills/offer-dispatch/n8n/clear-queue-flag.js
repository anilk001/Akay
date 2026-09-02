/**
 * Clear Queue Flag — runs after Mark Broadcasted.
 * Unticks 'Queued for Dispatch' on every bundle member so the offer
 * doesn't re-trigger on the next scheduled run.
 */
const rec = $('Reconcile').first().json;
const ids = (Array.isArray(rec._offerIds) && rec._offerIds.length)
  ? rec._offerIds
  : (rec._offerId ? [rec._offerId] : []);

return ids.map(id => ({ json: { id, 'Queued for Dispatch': false } }));

