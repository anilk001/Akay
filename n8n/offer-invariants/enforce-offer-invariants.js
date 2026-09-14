/**
 * n8n Code node — "Enforce Offer Invariants"
 * Mode: Run Once for All Items
 *
 * The last node before every "Create Offers" Airtable node, in all four
 * ingestion pipelines. One gate, one source of truth, one place to change.
 *
 * WHY A SHARED GATE RATHER THAN FOUR MORE FIXES.
 * Every rule below already exists somewhere. Listing Approved is stripped in
 * three different nodes, by three different mechanisms, in three different
 * workflows. Margin is applied by four copies of "Apply Default Margin".
 * Validity has a fallback in the Excel payload builder, another in the PDF
 * one, and a whole node of its own in WhatsApp. That is why the same symptom
 * keeps coming back on whichever pipeline was not edited that day: the rule is
 * written down four times, so it is only ever three-quarters true.
 *
 * WHAT THIS NODE REFUSES TO DO.
 * It does not guess a margin. "Apply Default Margin" has already had its turn,
 * with the supplier default and the 5% company default behind it, so a record
 * arriving here with no margin means something genuinely broke upstream — and
 * the one response that is never acceptable is to invent a number and let the
 * offer go Live. Sell Price falls back to Buy Price when Margin % is blank, so
 * a margin-less offer that reaches the site is showing the COST PRICE.
 *
 * It also does not silently drop the record. A dropped offer is a supplier
 * email nobody ever answers. Anything failing an invariant is written anyway,
 * demoted to Status = Hold with Claude Review Status = Pending Review and the
 * reason spelled out in Notes, where the daily digest and Annika both see it.
 *
 * HOLD vs DEFAULT — the rule for deciding which.
 *   Hold    when getting it wrong misstates the trade: no margin, no supplier,
 *           no price, no currency, no product name. These reach a client.
 *   Default when the safe value is obvious and errs toward LESS exposure:
 *           a missing expiry becomes 30 days, because an offer with no expiry
 *           never expires and sits Live at a stale price forever.
 *
 * OUTPUT SHAPE. "Create Offers" uses Map Automatically, so every top-level key
 * on an item becomes an Airtable column. This node therefore emits Airtable
 * field names and nothing else — no counters, no flags, no debug keys. The run
 * summary goes to console.log, where the execution log keeps it.
 */

// Formula, lookup and rollup fields. Writing to any of these errors the whole
// Airtable batch — with batch size 10 and no error output configured, one of
// these on one row means ten offers silently never arrive. That is the leading
// cause of "the offers just did not upload".
const READ_ONLY = new Set([
  'Sell Price', 'Pack Format', 'Is Expired', 'Auto Expiry Date', 'Send Eligible',
  'Public Listing', 'Public Product Description', 'Public Spec', 'Price Display',
  'Public Terms', 'Stock Display', 'whatsapp link', 'Price Per Unit & Case',
  'Days Live', 'Freshness', 'Offer Value',
  'Supplier Name', 'Supplier Email', 'Supplier Country',
  'Supplier Trust Level', 'Supplier Payment Terms',
]);

// Ticked by Anil or Annika by hand, never by ingestion (Anil, 2026-08-13).
// Deleted rather than skipped, so nothing upstream can smuggle one through
// Map Automatically.
const HUMAN_ONLY = ['Listing Approved', 'Send Approval Status'];

// Used only when a record arrives with no usable Auto Expiry Days. Matches the
// FALLBACK_VALIDITY_DAYS the payload builders already use.
const FALLBACK_VALIDITY_DAYS = 30;

const out = [];
const summary = { total: 0, clean: 0, held: 0, expiryDefaulted: 0, reasons: {} };

for (const item of $input.all()) {
  const rec = { ...(item.json || {}) };
  summary.total++;

  for (const field of HUMAN_ONLY) delete rec[field];
  for (const field of READ_ONLY) delete rec[field];

  const failures = [];

  if (!text(rec['Product Name'])) failures.push('no Product Name');

  if (!(positive(rec['Buy Price']))) failures.push('no Buy Price');

  if (!text(rec['Currency'])) failures.push('no Currency');

  // The margin invariant. Percent fields arrive as a fraction (0.05 = 5%), and
  // 0 is a failure rather than a value: a zero margin and a missing one are
  // indistinguishable on the site, and both publish at cost.
  if (!positive(rec['Margin %'])) failures.push('no Margin % (Sell Price would publish at the buy price)');

  // An offer with no supplier is an orphan — the price is real but nobody can
  // say who to buy it from, and the Supplier Email / Country / Trust lookups
  // are all blank because they resolve through this link.
  if (!link(rec['Supplier'])) failures.push('no Supplier link');

  // Expiry defaults rather than holds — see the HOLD vs DEFAULT note above.
  if (!positive(rec['Auto Expiry Days'])) {
    rec['Auto Expiry Days'] = FALLBACK_VALIDITY_DAYS;
    rec['Notes'] = note(rec['Notes'], `Auto Expiry Days was missing at ingestion; defaulted to ${FALLBACK_VALIDITY_DAYS} days.`);
    summary.expiryDefaulted++;
  }

  if (failures.length) {
    rec['Status'] = 'Hold';
    rec['Offer Approval Status'] = 'Awaiting Approval';
    rec['Claude Review Status'] = 'Pending Review';
    rec['Notes'] = note(
      rec['Notes'],
      `HELD BY INVARIANT GATE — not published, not sendable. Missing: ${failures.join('; ')}. ` +
      'Fix the field(s) and set Status back to Live; the website tick stays with Anil or Annika.'
    );
    summary.held++;
    for (const f of failures) summary.reasons[f] = (summary.reasons[f] || 0) + 1;
  } else {
    summary.clean++;
  }

  out.push({ json: rec });
}

console.log(
  `Offer invariants: ${summary.total} record(s) — ${summary.clean} clean, ${summary.held} held` +
  `${summary.expiryDefaulted ? `, ${summary.expiryDefaulted} expiry defaulted` : ''}` +
  `${summary.held ? ` | ${Object.entries(summary.reasons).map(([r, n]) => `${r} x${n}`).join(', ')}` : ''}`
);

return out;

// ── helpers ─────────────────────────────────────────────────────────────────

/** Trimmed string, reading through Airtable's {id,name} select shape. */
function text(v) {
  const a = Array.isArray(v) ? v[0] : v;
  if (a === null || a === undefined) return '';
  return (typeof a === 'object' ? String(a.name ?? '') : String(a)).trim();
}

/** A number strictly greater than zero. Accepts the "5.95" that a parser or a
 *  spreadsheet cell hands over as a string; rejects '', null, 0, NaN and
 *  anything that is not a number at all. */
function positive(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

/** An Airtable record-link value that actually points at something. */
function link(v) {
  if (!Array.isArray(v)) return false;
  return v.some((id) => typeof id === 'string' && id.trim().startsWith('rec'));
}

/** Append a sentence to Notes without losing what is already there. */
function note(existing, addition) {
  return `${String(existing ?? '').trim()} ${addition}`.trim();
}
