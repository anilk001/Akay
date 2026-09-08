const items = $input.all().map(i => i.json);
const ids = new Set();

for (const item of items) {
  if (item.offerId) ids.add(item.offerId);
  if (Array.isArray(item.bundleOfferIds)) item.bundleOfferIds.forEach(id => ids.add(id));
  if (item._offerId) ids.add(item._offerId);
  if (Array.isArray(item._offerIds)) item._offerIds.forEach(id => ids.add(id));
}

if (!ids.size) {
  try {
    const rec = $('Reconcile').first().json;
    if (Array.isArray(rec._offerIds)) rec._offerIds.forEach(id => ids.add(id));
    if (rec._offerId) ids.add(rec._offerId);
  } catch (e) { }
}

// Approval declined / expired: the halt item is the Wait node's webhook
// payload and names no offer, so read the group this run actually claimed.
// Without this step the fallback below unticks EVERY queued offer, including
// groups that were deferred to a later run and were never approved or declined.
if (!ids.size) {
  try {
    const br = $('Build Recipients').first().json;
    if (Array.isArray(br.bundleOfferIds)) br.bundleOfferIds.forEach(id => ids.add(id));
    if (br.offerId) ids.add(br.offerId);
  } catch (e) { }
}

if (!ids.size) {
  try {
    const searchResults = $('Find Sendable Offers').all().map(i => i.json);
    for (const r of searchResults) {
      if (r.id) ids.add(r.id);
    }
  } catch (e) { }
}

if (!ids.size) return [{ json: { note: 'No offer IDs found to clear — queue flag may need manual untick' } }];

return [...ids].map(id => ({ json: { id, 'Queued for Dispatch': false } }));
