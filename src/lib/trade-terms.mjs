// Turning the structured trade-terms fields into words a buyer can act on.
//
// The ingestion normaliser (n8n/trade-terms-normaliser/) resolves MOQ and lead
// time into typed fields and records in `MOQ Source` which tier of the cascade
// answered: the line itself, the supplier's default, or a category rule. This
// module is the other half of that bargain — the site has to word the answer
// honestly, because "this supplier stated 50 cases" and "we assumed 50 because
// that is what they usually do" are not the same claim to make to a buyer.
//
// So every label comes back with an `estimated` flag, and the templates say
// "typically" rather than stating a minimum the supplier never gave.
//
// Shared by the build (src/data/airtable.mjs), the offer pages, the search
// index and tests/trade-terms-display.test.js. Pure functions only — no
// Airtable, no DOM.

// A minimum that came from anywhere but the offer line is an estimate, and the
// site must not present it as a commitment.
const ESTIMATED_SOURCES = new Set(['Supplier Default', 'Category Rule']);

// Singular/plural per MOQ Type. Types that are already whole-load concepts
// ("Container", "Full Truckload") read naturally with a count in front.
const UNIT_WORDS = {
  Cases: ['case', 'cases'],
  Cartons: ['carton', 'cartons'],
  Bottles: ['bottle', 'bottles'],
  Pieces: ['piece', 'pieces'],
  Pallets: ['pallet', 'pallets'],
  Container: ['container', 'containers'],
  'Full Truckload': ['full load', 'full loads'],
};

export function isEstimated(moqSource = '') {
  return ESTIMATED_SOURCES.has(String(moqSource).trim());
}

/**
 * The minimum order, as a buyer would say it.
 *
 * Structured fields win. The legacy free-text `MOQ` column is the fallback, so
 * rows the parser has not reached yet still show whatever the supplier wrote —
 * losing information to a migration would be worse than showing it unpolished.
 *
 * @returns {{text: string, estimated: boolean}} — text '' means "say nothing",
 *   which the templates render as "On request" rather than an empty row.
 */
export function moqLabel(offer = {}) {
  const type = String(offer.moqType || '').trim();
  const qty = Number.isFinite(offer.moqQty) && offer.moqQty > 0 ? offer.moqQty : null;
  const estimated = isEstimated(offer.moqSource);

  if (type === 'No Minimum') return { text: 'No minimum', estimated: false };

  if (type === 'Order Value') {
    const cur = String(offer.moqCurrency || '').trim();
    if (qty && cur) return { text: `${cur} ${formatNumber(qty)}`, estimated };
    // A value minimum with no amount says nothing useful; fall through rather
    // than print a bare currency code.
  } else if (type && UNIT_WORDS[type]) {
    const [one, many] = UNIT_WORDS[type];
    if (qty) return { text: `${formatNumber(qty)} ${qty === 1 ? one : many}`, estimated };
    // "Container" with no count still tells a buyer the shape of the order.
    if (type === 'Container' || type === 'Full Truckload') {
      return { text: `${one.charAt(0).toUpperCase()}${one.slice(1)}`, estimated };
    }
  }

  // "Applies — Unspecified" and anything unparsed: a minimum exists, its size
  // was never stated. Never invent one.
  const legacy = String(offer.moq || '').trim();
  if (legacy) return { text: legacy, estimated: false };
  if (type) return { text: 'On request', estimated: false };
  return { text: '', estimated: false };
}

/**
 * Lead time in words. 0 is ex-stock — a real answer, not a blank.
 *
 * Weeks are used only for exact multiples, so "21 days" reads as "3 weeks" but
 * "10 days" is not rounded into "1 week" and quietly understated.
 */
export function leadTimeLabel(offer = {}) {
  const days = Number.isFinite(offer.leadTimeDays) && offer.leadTimeDays >= 0
    ? Math.round(offer.leadTimeDays) : null;

  if (days === null) {
    const legacy = String(offer.leadTime || '').trim();
    return legacy || '';
  }
  if (days === 0) return 'Ex-stock';
  if (days === 1) return '1 day';
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  }
  return `${days} days`;
}

// ── Facet buckets ───────────────────────────────────────────────────────────
// Coarse on purpose. A buyer filters by the shape of the commitment — "can I
// take a pallet?" — not by an exact case count, and a facet per distinct
// quantity would be a list of hundreds.

export function moqBucket(offer = {}) {
  const type = String(offer.moqType || '').trim();
  if (!type) return '';
  if (type === 'No Minimum') return 'No minimum';
  if (type === 'Order Value') return 'Minimum order value';
  if (type === 'Container' || type === 'Full Truckload') return 'Full load only';
  if (type === 'Pallets') return 'Pallet minimum';
  if (type === 'Applies — Unspecified') return '';
  return 'Unit minimum';
}

export function leadTimeBucket(offer = {}) {
  const days = Number.isFinite(offer.leadTimeDays) && offer.leadTimeDays >= 0
    ? Math.round(offer.leadTimeDays) : null;
  if (days === null) return '';
  if (days === 0) return 'Ex-stock';
  if (days <= 7) return 'Within a week';
  if (days <= 28) return '1–4 weeks';
  return 'Over 4 weeks';
}

/**
 * Everything the templates and the search index need, derived once at build
 * time so no wording logic has to be duplicated in the browser.
 */
export function tradeTermsView(offer = {}) {
  const moq = moqLabel(offer);
  return {
    moqLabel: moq.text,
    moqEstimated: moq.estimated,
    moqBucket: moqBucket(offer),
    leadLabel: leadTimeLabel(offer),
    leadBucket: leadTimeBucket(offer),
  };
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-IE');
}
