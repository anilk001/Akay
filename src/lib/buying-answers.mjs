// Plain-language answers for brand and offer pages, built only from fields the
// catalogue already publishes. Search engines and AI assistants quote pages
// that answer a buyer's question; before this, brand pages were a grid of
// cards and offer pages a spec table.
//
// Rule: every sentence here must be true for every line it describes. Counts,
// price floors and sizes are computed from the offers on the page; trading
// minimums come from TRADING_TERMS and are stated only where the whole page
// falls under one of them. Nothing here reads a field outside the public
// allowlist, and warehouse names arrive already normalised by normaliseLocation().
import { TRADING_TERMS, QUOTE_URL } from './site.mjs';

// Which house minimum a category trades under. A category not listed here
// ("Other") has no stated house minimum: its pages say the minimum is given
// with the quote.
const MINIMUM_BY_CATEGORY = {
  Spirits: 'spirits',
  Champagne: 'champagne',
  Beer: 'ftl',
  Wine: 'ftl',
  'Soft Drinks': 'ftl',
  Grocery: 'fmcg',
  Confectionery: 'fmcg',
  Toiletries: 'fmcg',
  'Other FMCG': 'fmcg',
  Household: 'fmcg',
};
const MINIMUM_TEXT = {
  spirits: { short: 'EUR 5,000 minimum order', long: TRADING_TERMS.spiritsMinimum },
  champagne: { short: 'EUR 15,000 minimum order', long: TRADING_TERMS.champagneMinimum },
  fmcg: { short: 'EUR 10,000 minimum order', long: TRADING_TERMS.fmcgMinimum },
  ftl: { short: 'Full truck load (FTL)', long: TRADING_TERMS.ftlMinimum },
};

export function houseMinimum(category) {
  const key = MINIMUM_BY_CATEGORY[String(category || '').trim()];
  return key ? MINIMUM_TEXT[key] : null;
}

/** 'under-bond' | 'duty-paid' | '' from the public Bond/Customs Status text. */
export function dutyClass(tier = '') {
  const t = String(tier).toLowerCase();
  if (/\bt1\b|bond/.test(t)) return 'under-bond';
  if (/\bt2\b|duty.?paid|\bdp\b/.test(t)) return 'duty-paid';
  return '';
}

function formatVolume(ml) {
  if (!Number.isFinite(ml) || ml <= 0) return '';
  if (ml >= 1000) return `${+(ml / 1000).toFixed(2)}L`;
  if (ml % 10 === 0) return `${ml / 10}cl`;
  return `${ml}ml`;
}

function topValues(values, n) {
  const counts = new Map();
  for (const v of values) {
    const k = String(v || '').trim();
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([k]) => k);
}

function listJoin(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`;

/**
 * Facts and FAQ for a brand page. Returns { summary: string[], faq: [{q, a}] }.
 * Every string is plain text (the template escapes it).
 */
export function brandAnswers(brand, offers) {
  const count = offers.length;
  const underBond = offers.filter((o) => dutyClass(o.tier) === 'under-bond').length;
  const dutyPaid = offers.filter((o) => dutyClass(o.tier) === 'duty-paid').length;

  // Lowest price per currency, only where the price basis is known, so a
  // per-bottle price is never compared with a per-case one.
  const floors = [];
  for (const basis of ['case', 'unit']) {
    const priced = offers.filter((o) => o.amount != null && o.currency
      && (basis === 'case' ? /case|pack/.test(o.priceBasis || '') : /unit|bottle|btl|can|piece|jar/.test(o.priceBasis || '')));
    const byCurrency = new Map();
    for (const o of priced) {
      const cur = byCurrency.get(o.currency);
      if (cur == null || o.amount < cur) byCurrency.set(o.currency, o.amount);
    }
    for (const [currency, amount] of byCurrency) floors.push(`${currency} ${amount.toFixed(2)} per ${basis === 'case' ? 'case' : 'bottle or unit'}`);
  }

  const places = topValues(offers.map((o) => o.warehouse), 3);
  const incoterm = topValues(offers.map((o) => o.incoterm), 1)[0] || '';
  const sizes = [...new Set(offers.map((o) => o.volumeMl).filter((v) => Number.isFinite(v) && v > 0))]
    .sort((a, b) => a - b).map(formatVolume).filter(Boolean);
  const categories = [...new Set(offers.map((o) => o.category).filter(Boolean))];
  const minimums = [...new Set(categories.map((c) => houseMinimum(c)?.long || null))];
  const oneMinimum = minimums.length === 1 && minimums[0] ? minimums[0] : null;

  const summary = [];
  let first = `AKAY Trade currently lists ${plural(count, `${brand} offer`)}`;
  if (floors.length) first += `, from ${listJoin(floors)}`;
  first += '.';
  if (underBond || dutyPaid) {
    const verb = (n) => (n === 1 ? 'is' : 'are');
    const parts = [];
    if (dutyPaid) parts.push(`${dutyPaid.toLocaleString('en-IE')} ${verb(dutyPaid)} duty-paid (T2)`);
    if (underBond) parts.push(`${underBond.toLocaleString('en-IE')} ${verb(underBond)} under bond (T1)`);
    first += ` Of these, ${listJoin(parts)}.`;
  }
  summary.push(first);
  if (places.length) {
    summary.push(`Most stock is held in ${listJoin(places)}${incoterm ? `, largely on ${incoterm} terms` : ''}.`);
  }
  summary.push(
    `${oneMinimum ? `${oneMinimum}. ` : ''}Send a list of the ${brand} lines you need to ${QUOTE_URL.replace('https://', '')} and it comes back priced on every matched line, or ask on WhatsApp.`,
  );

  const faq = [];
  if (underBond || dutyPaid) {
    faq.push({
      q: `Is ${brand} available under bond (T1)?`,
      a: underBond
        ? `Yes. ${underBond.toLocaleString('en-IE')} of the ${plural(count, 'live offer')} are under bond (T1, duty suspended)${dutyPaid ? ` and ${dutyPaid.toLocaleString('en-IE')} are duty-paid (T2)` : ''}. Each offer shows its duty status.`
        : `Not at the moment. The ${plural(count, 'live offer')} listed are duty-paid (T2). Ask if you need T1 stock; it is often available on request.`,
    });
  }
  if (sizes.length) {
    faq.push({
      q: `What sizes of ${brand} are on offer?`,
      a: `${listJoin(sizes.slice(0, 10))}${sizes.length > 10 ? ` and ${sizes.length - 10} more` : ''}.`,
    });
  }
  faq.push({
    q: `What is the minimum order for ${brand}?`,
    a: oneMinimum
      ? `${oneMinimum}. Where an offer states its own minimum, that minimum applies.`
      : 'Each offer shows its minimum where the supplier has stated one; otherwise the minimum is given with the quote.',
  });
  faq.push({
    q: `How do I get a price for several ${brand} lines at once?`,
    a: `Upload your buying list at ${QUOTE_URL.replace('https://', '')} in any format. It comes back with our selling price on every line we can match. You can also email it to offers@akay.ie with "Requirement List" in the subject.`,
  });

  return { summary, faq };
}

/** FAQPage JSON-LD for the same questions the page shows. */
export function faqSchema(faq, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url,
    mainEntity: faq.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

const DUTY_EXPLAINER = {
  'under-bond': 'Under bond (T1): excise and duty are suspended. The goods move between bonded warehouses or leave the EU without duty being paid, so the buyer needs a bonded account, an excise number or an export route.',
  'duty-paid': 'Duty-paid (T2): excise has been settled in the country of the warehouse. The goods can be released to a trade buyer without bonded paperwork.',
};

/** Short plain-language notes for an offer page. Returns string[]. */
export function offerAnswers(offer) {
  const notes = [];
  const duty = DUTY_EXPLAINER[dutyClass(offer.tier)];
  if (duty) notes.push(duty);
  if (!offer.moqLabel) {
    const house = houseMinimum(offer.category);
    if (house) notes.push(house === MINIMUM_TEXT.ftl
      ? `${house.long}.`
      : `${house.long}. The minimum is per order, so this line can be combined with others to reach it.`);
  }
  notes.push(`To buy, send the quantity on WhatsApp or email, or add this line to a buying list and upload it at ${QUOTE_URL.replace('https://', '')} to get it priced with the rest.`);
  return notes;
}
