// Catalogue search for the AKAY offers assistant.
//
// The chatbot cannot see the whole catalogue — 2,800+ offers is far too much to
// put in front of the model on every turn — so it calls search_offers() instead.
// This module is that search: plain string scoring over the public index, with
// no dependencies, so both the Netlify function and any test can import it.
//
// Everything here operates on the SAME public-safe offer shape the cards render
// (see src/data/airtable.mjs). It never sees supplier, buy price or margin.

// Words that carry no signal in a product query. "70cl bottle of jameson please"
// should search for "jameson" + the volume, not for "of" and "please".
const STOP = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'me', 'my', 'i', 'we', 'us', 'you',
  'give', 'send', 'get', 'got', 'want', 'need', 'like', 'have', 'has', 'is',
  'are', 'do', 'does', 'can', 'could', 'would', 'please', 'pls', 'offer',
  'offers', 'price', 'prices', 'pricing', 'quote', 'quotes', 'deal', 'deals',
  'stock', 'available', 'availability', 'on', 'in', 'to', 'with', 'some', 'any',
  'what', 'whats', 'how', 'much', 'cost', 'buy', 'order', 'looking', 'about',
]);

// "70", "70cl", "700ml", "0.7l" all mean the same bottle. Collapsing them to one
// token is what lets "Jameson 70" match a row whose spec reads "6 x 700ml" —
// which is how roughly half the catalogue is written.
function normalizeVolumes(s) {
  return s
    .replace(/(\d+(?:\.\d+)?)\s*(?:cl|centilitre|centiliter)\b/g, (_, n) => `${round(n)}cl`)
    .replace(/(\d+(?:\.\d+)?)\s*(?:ml|millilitre|milliliter)\b/g, (_, n) => `${round(n / 10)}cl`)
    .replace(/(\d+(?:\.\d+)?)\s*(?:l|lt|ltr|litre|liter)\b/g, (_, n) => `${round(n * 100)}cl`);
}
function round(n) {
  const v = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(v) ? String(v) : String(v);
}

// A bare number in a query is nearly always a bottle size ("jameson 70",
// "smirnoff 1"), so treat it as one. Sizes we actually sell, in cl.
const BARE_VOLUME = new Set(['5', '10', '15', '20', '25', '33', '35', '37.5', '50', '70', '75', '100', '150', '175', '200']);

export function normalizeText(s = '') {
  return normalizeVolumes(
    String(s)
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9.]+/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

// Turns a free-text query into the terms we actually match on.
export function queryTerms(query = '') {
  const out = [];
  for (const raw of normalizeText(query).split(' ')) {
    if (!raw) continue;
    // Trailing dots survive normalisation ("no.21." -> "no.21"); strip them.
    const t = raw.replace(/\.+$/, '');
    if (!t || STOP.has(t)) continue;
    if (/^\d+(\.\d+)?$/.test(t) && BARE_VOLUME.has(t)) { out.push(`${t}cl`); continue; }
    if (/^\d+(\.\d+)?$/.test(t)) continue;   // stray quantity like "10 cases"
    if (t.length < 2) continue;
    out.push(t);
  }
  return Array.from(new Set(out));
}

// Precomputed once per offer so scoring a 2,800-row catalogue stays cheap.
export function haystack(o) {
  return normalizeText([o.name, o.brand, o.variants, o.spec, o.category, o.origin].filter(Boolean).join(' '));
}

function scoreOffer(hay, terms) {
  let hits = 0;
  let exact = 0;
  for (const t of terms) {
    if (!hay.includes(t)) continue;
    hits++;
    // A term on a word boundary ("jameson") beats an incidental substring
    // ("gin" inside "virgin"), so whole-word matches rank higher.
    if (new RegExp(`(^| )${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(hay)) exact++;
  }
  if (!hits) return 0;
  return hits * 10 + exact;
}

const STOCK_RANK = { in: 0, warn: 1, enq: 2 };

/**
 * Search the catalogue for one product query.
 *
 * Returns the best matches cheapest-first. The catalogue carries many near
 * duplicates of the same product at different prices (different suppliers, same
 * public listing), so results are deduped on name+spec+price and capped — a
 * buyer asking for "Jameson" wants the keenest few lines, not all 18.
 */
export function searchOffers(offers, query, { limit = 8 } = {}) {
  const terms = queryTerms(query);
  if (!terms.length) return [];

  const scored = [];
  for (const o of offers) {
    const hay = o._hay || haystack(o);
    const score = scoreOffer(hay, terms);
    if (!score) continue;
    // Every term present is a real match; a partial hit is a fallback we only
    // fall back to when nothing matches in full.
    scored.push({ o, score, full: score >= terms.length * 10 });
  }
  if (!scored.length) return [];

  // A partial match is only worth showing when most of the query actually hit.
  // Without this floor, "Chateau Nonexistent 1787" latches onto whatever line
  // happens to contain "chateau" and the assistant confidently quotes an
  // unrelated wine — far worse than saying we do not list it.
  const anyFull = scored.some((s) => s.full);
  const minHits = Math.max(2, Math.ceil(terms.length * 0.6));
  const pool = anyFull
    ? scored.filter((s) => s.full)
    : scored.filter((s) => Math.floor(s.score / 10) >= minHits);
  if (!pool.length) return [];

  pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sa = STOCK_RANK[a.o.stock] ?? 3;
    const sb = STOCK_RANK[b.o.stock] ?? 3;
    if (sa !== sb) return sa - sb;
    const pa = Number.isFinite(a.o.unitAmount) ? a.o.unitAmount : Infinity;
    const pb = Number.isFinite(b.o.unitAmount) ? b.o.unitAmount : Infinity;
    return pa - pb;
  });

  // When the buyer named a size ("Jameson 70"), every result should be that
  // size. When they did NOT ("Jameson"), ranking purely by unit price buries the
  // standard bottle under 5cl miniatures — cheapest per unit, useless to a trade
  // buyer. So an unsized query returns one line per pack format instead: the
  // model then sees the real spread and can ask which size they meant.
  const sized = terms.some((t) => t.endsWith('cl'));
  const seen = new Set();
  const formats = new Set();
  const out = [];
  for (const { o } of pool) {
    const key = `${normalizeText(o.name)}|${normalizeText(o.spec)}|${o.currency}|${o.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!sized) {
      const vol = (normalizeText(o.spec).match(/(\d+(?:\.\d+)?)cl/) || [])[1] || normalizeText(o.spec);
      if (formats.has(vol)) continue;
      formats.add(vol);
    }
    out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}

const STOCK_LABEL = { in: 'In stock', warn: 'Limited', enq: 'Enquire' };

/** One catalogue line, in the wording used on the cards. */
export function offerLine(o) {
  const bits = [o.name];
  if (o.spec) bits.push(o.spec);
  if (o.priceDetail) bits.push(o.priceDetail);
  else if (o.amount != null) bits.push(`${o.currency} ${o.amount.toFixed(2)}`);
  if (o.terms) bits.push(o.terms);
  const stock = STOCK_LABEL[o.stock] || 'Enquire';
  const qty = typeof o.qty === 'number' && o.qty > 0 ? `${stock}, ${o.qty.toLocaleString()} cases` : stock;
  return `${bits.join(' — ')} [${qty}]`;
}

/**
 * The message body used for both the WhatsApp deep link and the emailed quote,
 * so a buyer gets an identical list whichever channel they pick.
 */
export function quoteText(offers, { name = '', note = '' } = {}) {
  const who = name ? ` This is ${name}.` : '';
  const lines = offers.map((o) => `• ${offerLine(o)}`).join('\n');
  const tail = note ? `\n\nNote: ${note}` : '';
  return `Hi Anil, please quote me on the following:${who}\n\n${lines}${tail}`;
}

/** wa.me deep link — opens WhatsApp with the quote request already typed out. */
export function whatsappLink(offers, opts = {}, phone = '353872382368') {
  return `https://wa.me/${phone}?text=${encodeURIComponent(quoteText(offers, opts))}`;
}
