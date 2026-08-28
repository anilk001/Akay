// Intro sentences for brand and category pages, composed strictly from the
// data on the lines that page is showing (§1).
//
// The temptation on 691 near-identical pages is boilerplate — "the finest
// selection of premium spirits at unbeatable prices" — which reads as spam to a
// buyer and as a doorway page to a crawler. Everything here is a count or a
// distinct value read off the offers themselves, so a page can only claim what
// the catalogue can back. Every clause is dropped when its data is missing,
// which is why the sentences are assembled from parts rather than templated.

const INCOTERM_TOKENS = /^(EXW|FCA|FOB|CFR|CIF|DAP|DDP|DAT|CPT|FAS)\b/i;

// "EXW Loendersloot" -> "Loendersloot". Public Terms is populated on every live
// line and is the only field that reliably carries a location, since Warehouse
// is filled on about a tenth of them.
function loadingPoint(offer) {
  const explicit = String(offer.warehouse || '').trim();
  if (explicit && explicit !== 'Other') return explicit;
  const terms = String(offer.terms || '').trim();
  if (!terms) return '';
  const rest = terms.replace(INCOTERM_TOKENS, '').trim();
  return rest && rest !== 'Other' ? rest : '';
}

function incoterm(offer) {
  const direct = String(offer.incoterm || '').trim();
  if (direct && direct !== 'Other') return direct;
  const m = String(offer.terms || '').match(INCOTERM_TOKENS);
  return m ? m[1].toUpperCase() : '';
}

// "12 x 100cl x 40% alc" -> 12. The pack count is the first number in Public
// Spec by construction of that formula.
function packCount(offer) {
  const m = String(offer.spec || '').match(/^\s*(\d+)\s*[x×]/i);
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 2000 ? n : null;
}

function unitSize(offer) {
  const m = String(offer.spec || '').match(/(\d+(?:[.,]\d+)?)\s*(cl|ml|l|g|kg)\b/i);
  return m ? `${m[1].replace(',', '.')}${m[2].toLowerCase()}` : '';
}

function uniq(values) {
  return [...new Set(values.filter((v) => v !== null && v !== undefined && String(v).trim() !== ''))];
}

// "a, b and c", with a cap so a 40-value list does not run to three lines.
// When the list overflows, the shown values stay comma-separated and the
// overflow becomes the final clause — otherwise you get "a, b and c and 5
// others", which reads as a mistake.
function list(values, max = 4) {
  const v = values.slice(0, max);
  const more = values.length - v.length;
  if (more > 0) return `${v.join(', ')} and ${more} other${more === 1 ? '' : 's'}`;
  if (v.length > 1) return `${v.slice(0, -1).join(', ')} and ${v[v.length - 1]}`;
  return v[0] || '';
}

export function aggregationFacts(offers) {
  const packs = uniq(offers.map(packCount)).sort((a, b) => a - b);
  const sizes = uniq(offers.map(unitSize));
  const tiers = uniq(offers.map((o) => o.tier));
  const points = uniq(offers.map(loadingPoint));
  const incoterms = uniq(offers.map(incoterm)).sort();
  const currencies = uniq(offers.map((o) => o.currency)).sort();
  const categories = uniq(offers.map((o) => o.category)).sort();
  const brands = uniq(offers.map((o) => o.brand)).sort();
  const inStock = offers.filter((o) => o.stock === 'in').length;

  return { packs, sizes, tiers, points, incoterms, currencies, categories, brands, inStock, lines: offers.length };
}

// Brand page intro. Returns an array of sentences so the template can drop them
// into separate paragraphs without string surgery.
export function brandIntro(brand, offers) {
  const f = aggregationFacts(offers);
  if (!f.lines) {
    return [
      `We are not showing any live ${brand} lines right now. Stock in this brand moves in and out of the catalogue as consignments are sold and replaced.`,
      'Tell us what you need and we will quote against incoming stock, or let you know when it lands.',
    ];
  }

  const out = [];

  const scope = f.categories.length === 1
    ? `${f.categories[0].toLowerCase()}`
    : `${list(f.categories.map((c) => c.toLowerCase()))}`;
  out.push(
    `${f.lines} live ${brand} ${f.lines === 1 ? 'line' : 'lines'} in ${scope}, priced by the case for trade buyers` +
    (f.currencies.length ? ` in ${list(f.currencies)}` : '') + '.'
  );

  const second = [];
  if (f.packs.length) {
    second.push(
      f.packs.length === 1
        ? `Cases of ${f.packs[0]}`
        : `Case formats from ${f.packs[0]} to ${f.packs[f.packs.length - 1]} units`
    );
  }
  if (f.sizes.length) second.push(`unit sizes ${list(f.sizes, 5)}`);
  if (second.length) out.push(`${second.join(', ')}.`);

  const third = [];
  if (f.tiers.length) third.push(`Customs status on these lines: ${list(f.tiers)}`);
  if (f.points.length) third.push(`loading from ${list(f.points, 5)}`);
  if (f.incoterms.length) third.push(`offered ${list(f.incoterms, 6)}`);
  if (third.length) out.push(`${third.join('; ')}.`);

  if (f.inStock) {
    out.push(`${f.inStock} of these ${f.inStock === 1 ? 'line is' : 'lines are'} in stock now; the rest are quoted against confirmed availability.`);
  }

  return out;
}

// Category page intro. Same discipline, but leads on brand breadth rather than
// pack format — that is what a buyer scanning a category actually wants to know.
export function categoryIntro(category, offers) {
  const f = aggregationFacts(offers);
  if (!f.lines) {
    return [`No live ${category.toLowerCase()} lines at the moment. Send us your requirement and we will quote against incoming stock.`];
  }

  const out = [
    `${f.lines} live ${category.toLowerCase()} ${f.lines === 1 ? 'line' : 'lines'} across ${f.brands.length} ` +
    `${f.brands.length === 1 ? 'brand' : 'brands'}, sold by the case and pallet to trade buyers` +
    (f.currencies.length ? ` in ${list(f.currencies)}` : '') + '.',
  ];

  const second = [];
  if (f.tiers.length) second.push(`Customs status across the category: ${list(f.tiers)}`);
  if (f.points.length) second.push(`loading points include ${list(f.points, 5)}`);
  if (f.incoterms.length) second.push(`offered ${list(f.incoterms, 6)}`);
  if (second.length) out.push(`${second.join('; ')}.`);

  if (f.inStock) {
    out.push(`${f.inStock} ${f.inStock === 1 ? 'line is' : 'lines are'} in stock now.`);
  }

  return out;
}
