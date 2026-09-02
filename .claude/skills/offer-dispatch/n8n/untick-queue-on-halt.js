/**
 * Untick Queue on Halt — clears the dispatch queue flag when the workflow
 * halts for any reason (gate fail, backup missing, no recipients, approval
 * declined, or a send that failed for every recipient).
 *
 * Reads offer IDs ONLY from fields that are known to carry them:
 *   offerId / bundleOfferIds  (Gate Check, Build Recipients, Verify HTML)
 *   _offerId / _offerIds      (Reconcile)
 * then falls back to Reconcile directly, then to the triggering search.
 *
 * FIXED 2026-08-31: this used to also sweep in any `item.id` beginning "rec".
 * On the post-send halt path the input items are the Offers Sent Log records
 * that Write Sent Log has just created, so it collected 56 SENT LOG ids and
 * handed them to an update against the OFFERS table — a guaranteed
 * 422 ROW_DOES_NOT_EXIST. That made every failed dispatch report
 * "Write Clear Flag on Halt" as the failing node and buried the real cause;
 * on 2026-08-31 the real cause was an invalid Resend API key rejecting all 56
 * sends with a 401. A record id does not tell you which table it belongs to,
 * so the "rec" prefix is never sufficient to treat one as an Offer.
 */
const items = $input.all().map(i => i.json);
const ids = new Set();

for (const item of items) {
  if (item.offerId) ids.add(item.offerId);
  if (Array.isArray(item.bundleOfferIds)) item.bundleOfferIds.forEach(id => ids.add(id));
  if (item._offerId) ids.add(item._offerId);
  if (Array.isArray(item._offerIds)) item._offerIds.forEach(id => ids.add(id));
}

// Reconcile is the authoritative source on the post-send halt path, where the
// incoming items are Sent Log rows and carry no offer reference of their own.
if (!ids.size) {
  try {
    const rec = $('Reconcile').first().json;
    if (Array.isArray(rec._offerIds)) rec._offerIds.forEach(id => ids.add(id));
    if (rec._offerId) ids.add(rec._offerId);
  } catch (e) { /* Reconcile did not run on this halt path */ }
}

if (!ids.size) {
  try {
    const searchResults = $('Find Sendable Offers').all().map(i => i.json);
    for (const r of searchResults) {
      if (r.id) ids.add(r.id);
    }
  } catch (e) { /* node may not exist in this path */ }
}

if (!ids.size) return [{ json: { note: 'No offer IDs found to clear — queue flag may need manual untick' } }];

return [...ids].map(id => ({ json: { id, 'Queued for Dispatch': false } }));

