/**
 * n8n Code node — "Claim Dispatch Group"   (Offer Dispatch — Akay, dAYMAj6mZD3hTV4T)
 * Mode: Run Once for All Items
 * Added 2026-09-02. Sits on the OK branch of "Recipients OK?", before Compose Email.
 *
 * SOURCE OF TRUTH: repo .claude/skills/offer-dispatch/n8n/claim-dispatch-group.js.
 *
 * WHY. The "Queued for Dispatch" flag used to be cleared only at the very END
 * of a run — after approval, after the send, after the Sent Log. Approval takes
 * anything from minutes to hours, and Anil queues the next group while the
 * previous one is still waiting: on 2026-09-01 run 29311 (09:16, 1,277
 * recipients) and run 29315 (09:25) were in flight at the same time, and the
 * 08:00 schedule can also land on top of a hand-triggered run. Every one of
 * those runs re-reads the queue, and Build Recipients picks the group
 * deterministically (oldest Offer Date first) — so two concurrent runs pick the
 * SAME group and, once both are approved, the whole audience is mailed twice.
 * It did not happen on 2026-09-01 only because the second group's Offer Date
 * sorted first. Nothing in the workflow prevented it.
 *
 * FIX. Untick the flag on the chosen group the moment it is chosen, so no other
 * run can see it. The two existing clear steps (after Mark Broadcasted, and on
 * the halt path) stay and are harmless — unticking twice is a no-op.
 *
 * CONSEQUENCE TO KNOW. A run that is cancelled mid-approval (the 3-day limit,
 * or a manual stop) now leaves the offer UN-queued, exactly as a halt already
 * did. Re-queue by hand; the approval mail names the group.
 */
const rec = $('Build Recipients').first().json;
const ids = (Array.isArray(rec.bundleOfferIds) && rec.bundleOfferIds.length)
  ? rec.bundleOfferIds
  : (rec.offerId ? [rec.offerId] : []);

if (!ids.length) {
  throw new Error('Claim Dispatch Group: Build Recipients passed but named no offer id(s) — refusing to continue without knowing what to claim.');
}

return ids.map((id) => ({ json: { id, 'Queued for Dispatch': false } }));
