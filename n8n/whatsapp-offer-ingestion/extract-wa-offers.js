/**
 * n8n Code node — "Extract WA Offers"
 * Mode: Run Once for Each Item
 *
 * Pulls offers out of a WhatsApp message and emits them in the SAME row-and-
 * column-map shape the spreadsheet and email paths produce, so 03 (normalise)
 * and 04 (build payload) are reused untouched. Every hardening already paid for
 * — the prose-vs-price guard, the "Euro 70,75" fix, per-row price basis, the
 * 12/1000/40 magnitude rule, the expiry invariant, the no-approval-fields rule
 * — applies here for free.
 *
 * WHY THIS NODE PARSES BY PATTERN RATHER THAN BY COLUMN MAP.
 * A spreadsheet and an email table both have columns, so a profile can say
 * "price is column 8" and be right forever. A WhatsApp offer is a sentence:
 *
 *   Bacardi Carta Blanca 6x1L 37.5% (T2) – FTL @ EUR 5.95/btl | DAP Loen
 *
 * There is no column 8. The price is found by looking for something that is
 * shaped like a price, and the product is whatever sits in front of it. So the
 * profile lookup is replaced by pattern extraction, and the supplier is
 * identified by phone number instead (node 31).
 *
 * TWO MODES, chosen by how many lines look like a priced product line:
 *
 *   many  — a list. One offer per line. Real example: a single message
 *           carrying eleven spirits, each "product – qty @ price | terms".
 *   one   — a single product described over several lines, with the pack size,
 *           case count and best-before on lines of their own. Reading only the
 *           priced line would throw all of that away, so the whole message is
 *           harvested into one offer.
 *
 * WHAT IS DELIBERATELY REFUSED.
 * A price range ("0.49€ - 0.69 €"), an average ("~0.63€") and a message stating
 * two different prices for the same goods (all-in vs per-pallet) are all sent
 * to review rather than resolved. Picking one is a silent 10-40% error on a
 * number that ends up in a client quote, and there is a person available to
 * settle it in seconds.
 */

// ── Constants ───────────────────────────────────────────────────────────────
// All declared before the loops that use them: `const` does not hoist, and a
// helper-block constant referenced from a loop above it throws at runtime.

const CUR_SYM = '€|£|\\$';
const CUR_ABBR = 'eur|euros?|usd|gbp|aed|sgd';
const NUM = '\\d+(?:[.,]\\d+)?';
const UNIT = 'btl|bottle|bottles|btls|cs|case|cases|ctn|carton|pc|pcs|piece|pieces|pack|can|jar|unit|units';

// Three ways a price is written, in one expression:
//   EUR 5.95      currency first
//   5,95 €        currency last
//   138.00/btl    no currency at all, but an unmistakable per-unit suffix
// The optional tail captures "/btl" or "per pcs" so the per-unit basis travels
// with the number — on WhatsApp the basis changes from line to line, and taking
// it from a supplier-level default would be a 6-12x error on half the rows.
const PRICE_RE = new RegExp(
  '(?:' +
    `(?:${CUR_SYM}|\\b(?:${CUR_ABBR})\\b)\\s*${NUM}` +
    `|${NUM}\\s*(?:${CUR_SYM}|\\b(?:${CUR_ABBR})\\b)` +
    `|${NUM}\\s*\\/\\s*(?:${UNIT})\\b` +
  ')' +
  `(?:\\s*(?:\\/|\\bper\\b)\\s*(?:${UNIT})\\b)?`,
  'gi'
);

// What makes a fragment look like a product rather than a stock note or a
// payment term: a stated size, or a trade pack notation.
//
// This is the guard that keeps a list of terms from being read as a list of
// products. One real message prices the same liqueur twice — "price for all
// 3,30 eur" and "pallet price – 3,55 eur/btl". Neither fragment states a size,
// so neither is taken as a product line, and the message correctly falls
// through to single-offer mode where the two prices are then flagged.
const PRODUCT_SIGNAL = /\d+\s*(?:ml|cl|dl|ltr|l|cc|g|gr|gm|kg)\b|\d+\s*[x×\/]\s*\d+/i;

// Lines that are never a product, however they are shaped.
//
// The address pattern requires a local part before the @ and an alphabetic
// suffix after the dot. A looser "@something.something" also matches the price
// "@6.20€" — which threw away the one line naming the product and left the
// best-before date standing in as the product name.
const BOILERPLATE = /^(?:[\s\-–—*_=.]*)$|^(?:tel|fax|mob|mobile|phone|email|e-mail|mail|web|www|http|contact|regards|thanks|br)\b|^[+\d][\d\s()+-]{7,}$|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/i;

// Lines that state an attribute OF a product rather than naming one. A
// best-before written "bbd 04/2028" carries a slash between two numbers and so
// reads as a pack notation to any size-based test.
// The value must be a number for the line to count as an attribute. Without
// that condition "Stock Clearance: Haribo Mario Kart Veggie (160g)" is thrown
// away as a stock line and the product loses its name to a marketing sentence
// further down.
const ATTRIBUTE_LINE = /^(?:bbd|b\.b\.d|best before|exp(?:iry)?|ean|barcode|moq|prices?|available|availability|stock|qty|quantity|lead\s*time)\b\s*[:\-]?\s*(?=\d)/i;

// Words that make a "Label: value" line a term rather than a product. Used only
// by the weakest naming rule, where the alternative is taking the first line
// that happens to have letters in it — which turns "Offer price: minimum 500
// ctn", a follow-up in a negotiation, into a product called "Offer price".
const TERM_LABEL = /\b(?:price|offer|moq|qty|quantity|stock|terms|payment|packaging|available|lead|delivery|bbd|ean|origin|packing)\b/i;

// A stated approximation or a span. Any of these on the price line means the
// number is not a price we can quote from.
const INEXACT = /\b(?:average|approx(?:imately)?|around|about|starting|from)\b|~/i;

// Warehouse short forms that appear in place of the full name. Kept to ones the
// same corpus also spells out in full — "Loen" sits beside "EXW Loendersloot"
// from another supplier, so it is not a guess. Codes we cannot source (PLG) are
// deliberately left alone for a human rather than mapped to the nearest option.
const WAREHOUSE_ALIAS = { loen: 'Loendersloot', loendersloot: 'Loendersloot' };

const WAREHOUSES = ['Loendersloot', 'NL', 'Dubai', 'Poland', 'Riga', 'Spain', 'Vietnam',
                    'Greece', 'Indonesia', 'Czech', 'NewCorp', 'Vergèze', 'Bergamo'];

// Column positions for the synthetic row handed to 03. Arbitrary but fixed —
// they only have to agree with COLUMN_MAP below.
const COL = {
  productName: 0, buyPrice: 1, packFormat: 2, bondStatus: 3, incoterm: 4,
  warehouse: 5, leadTime: 6, moq: 7, stockCases: 8, bbd: 9, pcsCase: 10,
  casesPerPallet: 11, eanUnit: 12,
};
const COLUMN_MAP = { ...COL };

const item = $input.item.json;

const text = clean(String(item.messageText || ''));
const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

// Offer-wide terms, read once from the whole message. A parcel heading
// ("Glenlivet Parcel (Ex Loendersloot | 6-7 weeks)") states terms for the lines
// beneath it, and a single-product message states them on their own lines.
// Per-line terms override these where a line carries its own.
const wide = messageTerms(text);

// ── Which lines are priced product lines ────────────────────────────────────
const priced = [];
const unpriceable = [];
for (const line of lines) {
  const hits = findPrices(line);
  if (!hits.length) continue;
  const head = line.slice(0, hits[0].start).trim();
  if (PRODUCT_SIGNAL.test(head) && !BOILERPLATE.test(head)) priced.push({ line, head, hits });
  else if (head) unpriceable.push({ line, head });
}

const rows = [];
const exceptions = [];

if (priced.length >= 2) {
  // ── List mode ─────────────────────────────────────────────────────────────

  // A priced line that states no size is REPORTED, not dropped. One real
  // message lists eleven spirits, ten of them with a pack size and one —
  // "Cristal 2016 NGBX (T2) – 2,400 btls @ EUR 163/btl" — without. Silently
  // skipping it would lose a €163/bottle offer with nothing to show it ever
  // existed, which is the worst possible failure for an ingestion pipeline.
  for (const u of unpriceable) {
    exceptions.push({ productName: u.head, exceptionReason:
      `priced line states no pack size or volume, so it cannot be matched to a product ("${u.line}")` });
  }

  for (const p of priced) {
    if (p.hits.length > 1 && looksLikeRange(p.line, p.hits)) {
      exceptions.push({ productName: p.head, exceptionReason:
        `states a price range rather than a price ("${p.line}")` });
      continue;
    }
    if (INEXACT.test(p.line)) {
      exceptions.push({ productName: p.head, exceptionReason:
        `price is stated as an approximation ("${p.line}")` });
      continue;
    }
    rows.push(buildRow(p.head, p.hits[0].token, p.line.slice(p.hits[0].end), p.line));
  }

} else {
  // ── Single-offer mode ─────────────────────────────────────────────────────
  // Every price in the message, not just those on a product-shaped line.
  const all = [];
  for (const line of lines) {
    for (const h of findPrices(line)) all.push({ ...h, line });
  }

  if (!all.length) {
    return emit([], [], 'No price stated anywhere in the message');
  }

  const ranged = all.find((h) => looksLikeRange(h.line, findPrices(h.line)));
  if (ranged) {
    return emit([], [{ productName: '', exceptionReason:
      `states a price range rather than a price ("${ranged.line}")` }],
      'Price is a range, not a single figure');
  }

  const distinct = new Set(all.map((h) => h.token.replace(/\s+/g, '').toLowerCase()));
  if (distinct.size > 1) {
    return emit([], [{ productName: '', exceptionReason:
      `message states ${distinct.size} different prices (${[...distinct].join(', ')}) ` +
      'and does not say which applies' }],
      'More than one price in the message');
  }

  const chosen = all[0];
  if (INEXACT.test(chosen.line)) {
    return emit([], [{ productName: '', exceptionReason:
      `price is stated as an approximation ("${chosen.line}")` }],
      'Price is an approximation');
  }

  const productName = findProductName(lines, all.map((h) => h.line));
  if (!productName) {
    return emit([], [{ productName: '', exceptionReason:
      'a price is stated but no line identifies the product' }],
      'Could not identify which product the price refers to');
  }

  const row = buildRow(productName, chosen.token, chosen.line.slice(chosen.end), text);
  // Harvest the attributes scattered across the other lines. Only ever fills a
  // blank — anything already read off the priced line stays.
  const extra = messageAttributes(text);
  for (const [k, v] of Object.entries(extra)) {
    if (v !== null && v !== '' && !row[COL[k]]) row[COL[k]] = v;
  }
  rows.push(row);
}

return emit(rows, exceptions, null);

// ── output ───────────────────────────────────────────────────────────────────

function emit(dataRows, exceptionRows, reason) {
  return {
    json: {
      ...item,
      offersFound: dataRows.length,
      dataRows,
      columnMap: COLUMN_MAP,
      headerCells: [],
      // Merged UNDER anything the message itself states, matching the email
      // path: an explicit supplier setting wins over something inferred here.
      profileDefaults: { ...wide.defaults, ...(item.profileDefaults || {}) },
      preParseExceptions: exceptionRows,
      exceptionReason: reason
        || (exceptionRows.length ? exceptionRows[0].exceptionReason : null)
        || item.exceptionReason
        || null,
      proseNotes: wide.notes,
    },
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip WhatsApp formatting and pictographs so the text reads as plain prose.
 * Emoji are used as bullets ("✅ Bacardi ...") and would otherwise sit inside
 * the product name and stop it matching a Product record.
 */
function clean(raw) {
  return raw
    .replace(/\r/g, '')
    // Zero-width characters, which arrive from copy-pasted marketing text and
    // otherwise sit invisibly inside a product name and stop it matching.
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Pictographs, matched by Unicode property rather than by codepoint ranges.
    // Hand-written ranges are the wrong tool: they are unreadable, they miss
    // half of what suppliers actually use, and an over-wide one quietly eats
    // accented letters — 'Nescafé' without its é matches no product record.
    .replace(/\p{Extended_Pictographic}|[\u2190-\u21FF\u2B00-\u2BFF\uFE0F\u20E3]/gu, ' ')
    .replace(/[*_~`]+/g, ' ')
    // Dirhams are written "dhs" in Gulf offers and are the AED option.
    .replace(/\bdh?s\b/gi, 'AED')
    .replace(/[ \t]+/g, ' ');
}

/** Every price-shaped token in a line, with its position. */
function findPrices(line) {
  const out = [];
  const re = new RegExp(PRICE_RE.source, 'gi');
  let m;
  while ((m = re.exec(line)) !== null) {
    out.push({ token: normalisePer(m[0].trim()), start: m.index, end: m.index + m[0].length });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/** "2 EUR Per PCS" -> "2 EUR/PCS", which is the form 03 reads a basis from. */
function normalisePer(token) {
  return token.replace(/\s*\bper\b\s*/i, '/');
}

/**
 * Two prices joined by a dash or "to" are the ends of a range, not two offers.
 * Requires the separator between them to be nothing but a dash or "to", so a
 * genuine two-product line is not mistaken for one.
 */
function looksLikeRange(line, hits) {
  if (hits.length < 2) return false;
  const between = line.slice(hits[0].end, hits[1].start);
  return /^\s*(?:-|–|—|to)\s*$/i.test(between);
}

/**
 * The product a single-offer message is about, tried in descending order of
 * how much the message itself tells us. Returns '' rather than a guess when
 * nothing qualifies — a made-up product name creates a junk catalogue entry,
 * whereas an empty one sends the message to a person with its text intact.
 */
function findProductName(allLines, priceLines) {
  // A question is a negotiation, not an offer. "Would 5.65 EUR EXW Loendersloot
  // work for 700ml?" states a price and a size and would otherwise be read as a
  // product — it is a counter-offer from a buyer's side of a conversation.
  const candidates = allLines.filter((l) =>
    !BOILERPLATE.test(l) && !ATTRIBUTE_LINE.test(l) && !/\?\s*$/.test(l));

  // 1. A line stating a size — the strongest signal, and it survives being the
  //    same line as the price ("Nescafé special filtre 200g @6.20€").
  for (const l of candidates) {
    if (!PRODUCT_SIGNAL.test(l)) continue;
    const stripped = stripLabel(stripPrices(l));
    if (stripped && PRODUCT_SIGNAL.test(stripped)) return stripped;
  }

  // 2. An explicit announcement.
  for (const l of candidates) {
    const m = l.match(/\b(?:we are offering|we offer|offering|we have|offer(?:ing)? for)\b\s*:?\s*(.+)$/i);
    if (m && m[1].trim().length > 2) return stripPrices(m[1]);
  }

  // 3. The first line that reads like a name at all. Weak, but harmless: 04
  //    matches on Brand + Name + Volume + Bond, so a wrong name simply fails to
  //    match a Product and the offer is routed to review rather than created.
  for (const l of candidates) {
    if (priceLines.includes(l)) continue;
    if (!/[A-Za-z]{3}/.test(l)) continue;
    const label = l.match(/^([A-Za-z][A-Za-z ]{0,24}):/);
    if (label && TERM_LABEL.test(label[1])) continue;
    return l;
  }

  return '';
}

/**
 * Drop a leading "Label:" where what follows still names a product. Suppliers
 * head their broadcasts "Stock Clearance:", "Special Offer:", "New arrival:" —
 * useful to a reader, noise in a product name that has to match a catalogue.
 */
function stripLabel(line) {
  const m = String(line).match(/^[A-Za-z][A-Za-z ]{0,24}:\s*(.+)$/);
  return m && PRODUCT_SIGNAL.test(m[1]) ? m[1].trim() : String(line).trim();
}

/**
 * Separate a trailing quantity clause from the product name.
 *
 * List-mode lines are written "<product> – <how much> @ <price>", so the text
 * in front of the price carries both. Left joined, the product name reads
 * "Hennessy VS GBX 6x70cl 40% – 1,250 cs", which matches no Product record and
 * sends a perfectly good offer to review over punctuation.
 *
 * Only a trailing segment that is unmistakably a quantity is removed. Anything
 * else is left in the name, because a name with too much in it still matches on
 * a second look, whereas a name with a word chopped off does not.
 */
function splitQuantity(name) {
  const QTY = /^(?:ftl|full\s*truck(?:load)?|\d[\d,. ]*\s*(?:cs|cases?|ctns?|cartons?|btls?|bottles?|pcs|pieces?|pal|pallets?|units?))\b/i;
  const TERMS = /^(?:exw|ex\s*works?|fca|fob|cfr|cnf|cif|dap|ddp)\b/i;

  const parts = String(name).split(/\s+[–—-]\s+/);
  const qty = [];

  // Repeated, because a single line can end with several of these at once:
  // "Clase Azul Reposado Tequila 40% 70cl + GBX - EXW PLG - 1000 btls
  // available" carries both the delivery terms and the stock after the name.
  while (parts.length > 1) {
    const tail = parts[parts.length - 1].trim();
    if (!QTY.test(tail) && !TERMS.test(tail)) break;
    qty.unshift(tail);
    parts.pop();
  }

  let head = parts.join(' - ').trim();

  // A quantity stated BEFORE the product, with no dash to split on:
  // "1250 cs Martini Bianco 6x1L original T2". The loop above cannot reach this
  // shape - without a " - " the split yields a single part, so `parts.length > 1`
  // is false from the start and nothing is stripped. The quantity was therefore
  // left in the product name, which put the case count into Brand and into
  // productKey, so the same product quoted at a different quantity produced a
  // different key and a duplicate Product record.
  //
  // Reuses the same QTY vocabulary, so an explicit unit word is still required:
  // "1000 Islands Vodka" keeps its name, "1250 cs Martini Bianco" does not.
  // Guarded on a non-empty remainder so a line that is ONLY a quantity is left
  // alone rather than reduced to nothing.
  const lead = head.match(QTY);
  if (lead && head.slice(lead[0].length).trim()) {
    qty.unshift(lead[0].trim());
    head = head.slice(lead[0].length).trim();
  }

  return { name: head, qty: qty.join(' ') };
}

function stripPrices(line) {
  return line.replace(new RegExp(PRICE_RE.source, 'gi'), ' ')
    .replace(/\s*[-–—@|]+\s*$/, '')
    .replace(/^\s*[-–—@|]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One synthetic row in the shape 03 expects.
 *
 * `tail` is what follows the price on the same line — on list-mode messages
 * that is where the incoterm, warehouse and lead time live, pipe-separated.
 * `scope` is the text searched for everything else: the line in list mode, the
 * whole message in single-offer mode.
 */
function buildRow(productName, priceToken, tail, scope) {
  const row = [];
  const split = splitQuantity(stripPrices(productName) || productName);
  row[COL.productName] = split.name;
  row[COL.buyPrice] = priceToken;

  const terms = readTerms(`${tail} ${scope}`);
  row[COL.bondStatus] = terms.bondStatus || wide.defaults.bondStatus || '';
  row[COL.incoterm] = terms.incoterm || wide.defaults.incoterm || '';
  row[COL.warehouse] = terms.warehouse || wide.defaults.warehouse || '';
  row[COL.leadTime] = terms.leadTime || wide.defaults.leadTime || '';
  row[COL.moq] = terms.moq || wide.defaults.moq || '';

  const attrs = readAttributes(`${split.qty} ${scope}`);
  row[COL.stockCases] = attrs.stockCases ?? '';
  row[COL.casesPerPallet] = attrs.casesPerPallet ?? '';
  row[COL.pcsCase] = attrs.pcsCase ?? '';
  row[COL.bbd] = attrs.bbd || '';
  row[COL.eanUnit] = attrs.eanUnit || '';
  row[COL.packFormat] = '';   // 03 derives the pack from the product name

  return row;
}

/** Terms stated anywhere in the message, plus anything worth telling a human. */
function messageTerms(scope) {
  const t = readTerms(scope);
  const notes = [];

  // "EXW Germany or Poland" — the supplier has not committed to one, so neither
  // do we. Recorded rather than resolved: shipping from the wrong country is
  // not a rounding error.
  if (/\b(?:exw|ex\s*works?|fca|fob|dap|ddp|cfr|cif)\b[^.\n]{0,30}\bor\b/i.test(scope)) {
    notes.push('Two possible locations are stated — set the warehouse by hand');
    delete t.warehouse;
  }

  return { defaults: t, notes };
}

function readTerms(scope) {
  const out = {};
  const s = String(scope);
  const flat = s.replace(/\s+/g, ' ');

  const inco = flat.match(/\b(ex[\s-]?works?|exw|fca|fob|cfr|cnf|cif|dap|ddp)\b/i);
  if (inco) {
    const raw = inco[1].toLowerCase().replace(/[\s-]/g, '');
    if (/^ex(works?)?$/.test(raw)) out.incoterm = 'EXW';
    else if (raw === 'cnf') out.incoterm = 'CFR';   // CNF is the older spelling
    else out.incoterm = inco[1].toUpperCase();
  }

  for (const [alias, full] of Object.entries(WAREHOUSE_ALIAS)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(flat)) { out.warehouse = full; break; }
  }
  if (!out.warehouse) {
    for (const w of WAREHOUSES) {
      if (new RegExp(`\\b${escapeRe(w)}\\b`, 'i').test(flat)) { out.warehouse = w; break; }
    }
  }

  // "Ex Loen" is ex-works written in trade shorthand, and it appears as often
  // as "DAP Loen" in the same message. Matched only when a known warehouse
  // follows, so the word "ex" in ordinary prose cannot become an incoterm.
  if (!out.incoterm && out.warehouse
      && new RegExp(`\\bex\\s+(?:${escapeRe(out.warehouse)}|${Object.keys(WAREHOUSE_ALIAS).join('|')})\\b`, 'i').test(flat)) {
    out.incoterm = 'EXW';
  }

  if (/\bT1\b/.test(flat)) out.bondStatus = 'T1';
  else if (/\bT2\b/i.test(flat)) out.bondStatus = 'T2';
  else if (/\bduty[\s-]?paid\b/i.test(flat)) out.bondStatus = 'Duty Paid';
  else if (/\b(?:under\s+)?bonded?\b/i.test(flat)) out.bondStatus = 'Bonded';

  // Matched per line and clipped at the next keyword. A flattened search runs
  // straight past the end of the value — one message reads "2-3 weeks lead
  // time." directly above "20 % deposit and 80% balance payment".
  const STOP = /\b(?:moq|lead\s*time|price|prices|terms|warehouse|incoterm|delivery|payment|deposit|balance|available)\b/i;
  for (const line of s.split(/\n|\|/).map((l) => l.trim()).filter(Boolean)) {
    if (!out.leadTime) {
      const lead = line.match(/lead[\s-]?time\s*[:\-]?\s*(?:approx(?:imately)?\.?\s*)?(.+)$/i)
                || line.match(/^(\d+\s*(?:-|–|to)?\s*\d*\s*(?:days?|weeks?|months?))\b/i)
                || line.match(/^(.{0,20}?\b\d+\s*(?:-|–|to)\s*\d+\s*(?:days?|weeks?|months?))\s*lead\s*time/i);
      if (lead) out.leadTime = clip(lead[1], STOP);
    }
    if (!out.moq) {
      const moq = line.match(/\bmoq\b\s*[:\-]?\s*(.+)$/i)
               || line.match(/\bminimum(?:\s+order)?\s*[:\-]?\s*(\d[^.]{0,30})$/i);
      if (moq) out.moq = clip(moq[1], STOP);
    }
  }

  return out;
}

/** Numeric attributes stated in their own words rather than in a column. */
function readAttributes(scope) {
  const s = String(scope).replace(/\s+/g, ' ');
  const out = { stockCases: null, casesPerPallet: null, pcsCase: null, bbd: '', eanUnit: '' };

  let m = s.match(/(\d[\d,. ]*)\s*(?:cases?|cs|ctns?|cartons?)\s*(?:per|\/|a)\s*pallet/i);
  if (m) out.casesPerPallet = toInt(m[1]);

  // Stock, but only when the supplier states it in CASES. A bottle count needs
  // the pack size to convert and would otherwise be written into a field
  // labelled "cases", reading as six to twelve times the stock that exists.
  m = s.match(/(\d[\d,. ]*)\s*(?:cases?|cs|ctns?|cartons?)\b(?!\s*(?:per|\/|a)\s*pallet)/i);
  if (m) out.stockCases = toInt(m[1]);

  m = s.match(/(\d+)\s*(?:units?|pcs|pieces?|btls?|bottles?|cans?)\s*(?:per|\/|in a)\s*(?:case|ctn|carton|box)/i);
  if (m) out.pcsCase = toInt(m[1]);
  else {
    m = s.match(/\bpacking\s*(?:of\s*)?(\d+)\s*(?:pcs|pieces?|units?)/i);
    if (m) out.pcsCase = toInt(m[1]);
  }

  // A best-before RANGE ("BBD: 05/2027 - 04/2028") is left blank on purpose:
  // the field holds one date, and taking either end misstates the stock.
  m = s.match(/\bbbd\b\s*[:\-]?\s*([0-9]{1,4}[.\/-][0-9]{1,4}(?:[.\/-][0-9]{2,4})?)(\s*(?:-|–|to)\s*[0-9])?/i);
  if (m && !m[2]) out.bbd = m[1];

  m = s.match(/\bean\b\s*[:\-]?\s*(\d{8}|\d{12,14})\b/i);
  if (m) out.eanUnit = m[1];

  return out;
}

/** Attributes for single-offer mode, keyed to match COL so they can be merged. */
function messageAttributes(scope) {
  const a = readAttributes(scope);
  return {
    stockCases: a.stockCases ?? '',
    casesPerPallet: a.casesPerPallet ?? '',
    pcsCase: a.pcsCase ?? '',
    bbd: a.bbd,
    eanUnit: a.eanUnit,
  };
}

function toInt(raw) {
  const n = Number(String(raw).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clip(value, stop) {
  let v = String(value).split(/[.|]/)[0].trim();
  const m = v.match(stop);
  if (m && m.index > 0) v = v.slice(0, m.index).trim();
  return v.replace(/[,;\/\s]+$/, '').slice(0, 60);
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
