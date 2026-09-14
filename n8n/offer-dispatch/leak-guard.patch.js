/**
 * PATCH — "Offer Dispatch — Akay" (dAYMAj6mZD3hTV4T)
 * Nodes: "Compose Email" and "Verify HTML" (the same block appears in both)
 * Status: NOT YET APPLIED in n8n. Repo record of the change and why.
 *
 * ── THE BUG ─────────────────────────────────────────────────────────────────
 * The guard that stops our buy price reaching a client only runs when the sell
 * price differs from the buy price:
 *
 *     if (Number.isFinite(buy) && buy > 0 && (!Number.isFinite(sell) || Math.abs(sell - buy) > 0.005)) {
 *       // ...search the composed text for the buy price and refuse to send
 *     }
 *
 * The intent was reasonable: when margin is genuinely zero, the sell price IS
 * the buy price, so finding that number in the email is not a leak and the
 * check would halt every legitimate send.
 *
 * The effect is the opposite of the intent. Sell Price fell back to Buy Price
 * whenever Margin % was blank, so a MISSING margin looked identical to a
 * deliberate zero one — and the guard disarmed itself at precisely the moment
 * there was something to guard against. "Margin not applied" and "the guard
 * that would have caught it" failed together, by construction.
 *
 * ── WHY THIS IS STILL WORTH DOING ───────────────────────────────────────────
 * The Airtable fix on 2026-09-14 already closes the hole from the other side:
 * Sell Price is now BLANK rather than Buy Price when Margin % is missing, so
 * Price Display and Price Per Unit & Case are blank too, and Compose Email
 * already halts on an empty PRICE_LINE — "Refusing to send — required field(s)
 * empty". A margin-less offer can no longer be composed at all.
 *
 * So this is no longer the only thing standing in the way. It is worth
 * applying anyway because a guard that switches itself off is worse than no
 * guard: it reads as protection in every review of this workflow, and the next
 * person to change the Sell Price formula will not know it was load-bearing.
 *
 * ── THE CHANGE ──────────────────────────────────────────────────────────────
 * Run the check unconditionally, and decide on MARGIN rather than on whether
 * two numbers happen to be equal. A stated zero margin is a real business
 * decision and still sends; a missing one never reaches here.
 *
 * In "Compose Email", replace the condition on the `const buy` block with:
 */

// ── REPLACEMENT (Compose Email) ─────────────────────────────────────────────
const buy = Number(f['Buy Price']);
const margin = Number(f['Margin %']);

// Deliberate zero margin — a real trade decision — is the ONLY case where the
// buy price is allowed to appear, because then it is also the sell price.
// Everything else runs the check, including the case that used to skip it:
// margin missing, so sell silently equalled buy.
const zeroMarginByChoice = Number.isFinite(margin) && margin === 0;

if (Number.isFinite(buy) && buy > 0 && !zeroMarginByChoice) {
  const forms = [buy.toFixed(2)];
  if (!Number.isInteger(buy)) forms.push(String(buy));
  let found = null;
  for (const form of forms) {
    if (new RegExp(`(^|[^0-9.,])${escapeRe(form)}([^0-9]|$)`).test(hay)) { found = form; break; }
  }
  if (!found && Number.isInteger(buy)) {
    const CURRENCY = '(?:eur|usd|gbp|aed|sgd|chf|[$€£])';
    if (new RegExp(`${CURRENCY}\\s*${escapeRe(String(buy))}(?![0-9.,])`).test(hay)) found = String(buy);
  }
  if (found) leaks.push(`buy price ${found}`);
}

// ── REPLACEMENT (Verify HTML) ───────────────────────────────────────────────
// Same decision, the node's own shorter form:
//
//   const buy = Number(f['Buy Price']);
//   const margin = Number(f['Margin %']);
//   const zeroMarginByChoice = Number.isFinite(margin) && margin === 0;
//   if (Number.isFinite(buy) && buy > 0 && !zeroMarginByChoice) {
//     const form = buy.toFixed(2);
//     if (new RegExp('(^|[^0-9.,])' + form.replace('.', '\\.') + '([^0-9]|$)').test(hay)) {
//       leaks.push('buy price ' + form);
//     }
//   }
//
// NOTE: "Verify HTML" reads its offer fields from
//   $('Gate Check').all().map((i) => i.json).filter((g) => g.gatePassed)[0]
// so "Margin %" must be among the fields "Find Sendable Offers" requests.
// Check that before applying, or margin reads as NaN, zeroMarginByChoice is
// false, and the guard runs on every send — which is the safe direction, but
// would newly halt sends of genuinely zero-margin offers.
