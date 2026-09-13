/**
 * n8n Code node — "Trade Terms Normaliser — Akay"
 * Workflow: Trade Terms Normaliser — Akay (sub-workflow)
 * Mode: Run Once for All Items
 *
 * Called by all four ingestion pipelines (Excel, Email, PDF, WhatsApp) via
 * Execute Sub-workflow, immediately after "Apply Default Margin".
 *
 * WHY A SUB-WORKFLOW AND NOT A CODE NODE IN EACH PIPELINE.
 * This parser gets extended every time a supplier words something a new way.
 * Four copies means four edits and three of them get forgotten — the existing
 * four-way copy of the "no EAN stated" logic already shows that drift. One
 * sub-workflow means one edit.
 *
 * WHAT IT DOES, in the order the brief sets out:
 *
 *   1. EXTRACT — pull MOQ, lead time and mixed-load out of wherever they
 *      arrived: their own column, the product name, the notes, or the list
 *      header / email body / PDF top block.
 *   2. RESOLVE — apply the cascade: line -> list header -> supplier default
 *      -> category rule -> unknown.
 *   3. LABEL — record in `MOQ Source` where the value came from, so the site
 *      can word it honestly instead of choosing between over-claiming and
 *      saying nothing.
 *
 * Step 3 is the one that is easy to skip and expensive to retrofit. Without it
 * nothing downstream can tell "this supplier stated 50 cases" from "we assumed
 * a pallet because that is what they usually do".
 *
 * THE FOUR RULES THAT KEEP IT HONEST.
 *   - Never guess. Text that does not match a known pattern sets nothing and is
 *     written to the parse report instead. A wrong MOQ on a public page costs
 *     more than a missing one; the site already renders "MOQ on request".
 *   - Never let a default overwrite a stated value. A supplier default is only
 *     consulted when the line said nothing, and `MOQ Source` says so when it is.
 *   - Never block ingestion on a parse failure. A line whose MOQ cannot be read
 *     is still a valid offer, so every line is parsed inside a try/catch and a
 *     throw emits the line untouched with a note. Lines going missing is the
 *     worse failure — the silent-loss guard exists because of it.
 *   - Never write a blank over an existing value. `fields` is built with only
 *     the keys actually resolved.
 *
 * INPUT (one item per line, `json`):
 *   rawName          product name / description as it arrived
 *   rawMoq           any MOQ column or cell            (may be absent)
 *   rawLeadTime      any lead-time column or cell      (may be absent)
 *   rawNotes         notes / remarks / conditions      (may be absent)
 *   headerText       list header, email body, PDF top block — order-level terms
 *                    usually live here rather than on the line
 *   supplierDefaults { 'Default MOQ Qty', 'Default MOQ Unit',
 *                      'Default Lead Time Days' } from the supplier record
 *                    already fetched by "Apply Default Margin"
 *   category         resolved category, for the category-rule tier
 *   dryRun           optional per-item override of DEFAULT_DRY_RUN
 *   ...anything else is passed through untouched
 *
 * OUTPUT (one item per input item, order preserved):
 *   ...passthrough of every input key
 *   productName      the cleaned public description
 *   rawProductName   the original string, so nothing is lost
 *   tradeTerms       the resolved values in plain camelCase
 *   fields           Airtable field names -> values, ONLY the ones resolved.
 *                    Empty when dryRun is on, so nothing is written.
 *   fieldsPreview    what `fields` would have been, always populated
 *   parse            { status, notes[], unrecognised[] } — feeds the weekly
 *                    exception digest
 */

// ── Configuration ───────────────────────────────────────────────────────────

// Rollout step 2: wire into ONE pipeline with this on, ingest a real list and
// compare the parsed output against the source file by hand before it writes.
const DEFAULT_DRY_RUN = false;

// Rollout step 4 adds `Parse Notes` and `Parse Status` to the Offers table.
// Set false while wiring a pipeline before those two columns exist — an
// Airtable node handed an unknown field name errors the whole batch.
const PARSE_FIELDS_LIVE = true;

// The category-rule tier of the cascade. Shipped EMPTY on purpose.
//
// A category rule publishes an MOQ that no supplier ever stated, on every line
// in that category, for as long as nobody notices. That is the exact shape of
// "never guess", so entries belong here only once Anil or Annika has signed one
// off against real supplier behaviour. The tier itself is wired and tested, so
// adding one is a single line:
//
//   'Spirits': { moqType: 'Cases', moqQty: 50, leadTimeDays: 14 },
//
// Any of moqType / moqQty / moqCurrency / leadTimeDays may be given; whatever
// is present is applied only when the line, the header and the supplier record
// were all silent, and is labelled `MOQ Source` = "Category Rule".
const CATEGORY_RULES = {};

// ── Vocabulary ──────────────────────────────────────────────────────────────
// All declared before the loop that uses them: `const` does not hoist, and a
// helper-block constant referenced from a loop above it throws at runtime.

const MOQ_TYPES = ['Order Value', 'Cases', 'Cartons', 'Bottles', 'Pieces', 'Pallets',
                   'Container', 'Full Truckload', 'No Minimum', 'Applies — Unspecified'];

const MOQ_SOURCES = ['Supplier Stated', 'Parsed From Text', 'Supplier Default', 'Category Rule'];

const CURRENCY = {
  '€': 'EUR', '£': 'GBP', '$': 'USD',
  eur: 'EUR', euro: 'EUR', euros: 'EUR',
  usd: 'USD', dollar: 'USD', dollars: 'USD',
  gbp: 'GBP', pound: 'GBP', pounds: 'GBP', sterling: 'GBP',
  aed: 'AED', sgd: 'SGD', chf: 'CHF', pln: 'PLN', czk: 'CZK',
  ron: 'RON', dkk: 'DKK', sek: 'SEK', nok: 'NOK',
};

const CUR_SYM = '€|£|\\$';
const CUR_WORD = 'eur|euros?|usd|dollars?|gbp|pounds?|sterling|aed|sgd|chf|pln|czk|ron|dkk|sek|nok';

// An amount as suppliers write it: 35,000 · 35.000 · 1,250.50 · 35k.
const AMT = '\\d[\\d.,]*(?:\\s*[km]\\b)?';

// Count units, longest form first so "cases" is not eaten by "cs".
const UNIT_WORD = 'cases?|cartons?|ctns?|boxes|box|bottles?|btls?|pieces?|pcs?|pallets?|plts?|pals?|units?|each|ea|cs';

// Which MOQ Type each unit word resolves to.
const UNIT_TYPE = [
  ['Cases',   /^(?:cases?|cs)$/i],
  ['Cartons', /^(?:cartons?|ctns?|boxe?s?)$/i],
  ['Bottles', /^(?:bottles?|btls?)$/i],
  ['Pieces',  /^(?:pieces?|pcs?|units?|ea|each)$/i],
  ['Pallets', /^(?:pallets?|plts?|pals?)$/i],
];

// What makes a fragment an MOQ statement at all. Everything outside a dedicated
// MOQ column has to clear this first, or every price on the line would be read
// as an order minimum.
//
// Bare "min" is only accepted when something MOQ-shaped follows it, because
// "15 min" is a duration and "min. 40% vol" is a spirit strength.
const MIN_KEYWORD = new RegExp(
  '\\b(?:' +
    'moq|m\\.o\\.q\\.?' +
    '|minimum(?:\\s+(?:order|purchase|shipment|invoice))?(?:\\s+(?:quantity|qty|value|amount))?' +
    '|order\\s+minimum|minimum\\s+mixed\\s+order' +
    `|min(?=\\s*[:=.\\-]?\\s*(?:order|qty|quantity|value|amount|mixed|purchase|\\d|${CUR_SYM}|(?:${CUR_WORD})\\b))` +
  ')\\b', 'i');

const NO_MINIMUM = /\b(?:no\s*(?:minimum(?:\s+order)?(?:\s+(?:quantity|qty))?|min|moq)\b|(?:moq|minimum(?:\s+order)?)\s*[:\-=]?\s*(?:none|nil|n\/?a|no|0)\b|any\s+quantity|no\s+order\s+minimum)/i;

// "MOQ applies", "subject to MOQ" — a minimum exists, the size is not stated.
const MOQ_UNSPECIFIED = /\b(?:moq|minimum(?:\s+order)?)\s*(?:applies|apply|applicable)\b|\bsubject\s+to\s+(?:a\s+)?(?:moq|minimum)\b|\b(?:moq|minimum)\s*[:\-=]?\s*yes\b/i;

const CONTAINER_RE = new RegExp(`(?:(\\d+)\\s*(?:x|×)?\\s*)?\\b(?:fcl|(?:20|40)\\s*(?:ft|feet|['’])\\s*(?:hc|hq)?|containers?|cntrs?)\\b`, 'i');
const FTL_RE = /(?:(\d+)\s*(?:x|×)?\s*)?\b(?:ftl|full\s*truck\s*loads?|truck\s*loads?|full\s*loads?)\b/i;
const PALLET_ONLY_RE = /\b(?:full\s+pallets?|pallet\s+(?:quantities|quantity|multiples|loads?))\b/i;

const MONEY_RE = new RegExp(
  `(?:(${CUR_SYM}|\\b(?:${CUR_WORD})\\b)\\s*(${AMT})|(${AMT})\\s*(${CUR_SYM}|\\b(?:${CUR_WORD})\\b))`, 'gi');

const COUNT_RE = new RegExp(
  `(${AMT})\\s*(?:-|–|—|to|~)?\\s*(${AMT})?\\s*(?:full\\s+|complete\\s+)?(${UNIT_WORD})\\b`, 'gi');

// "Mixed" is a selling point, so it is worth the field. Ticked only on an
// explicit statement either way; silence leaves the checkbox alone.
const MIXED_YES = /\b(?:mixed(?:\s+(?:pallets?|loads?|containers?|orders?|lots?))?|can\s+be\s+mixed|mix(?:ing)?\s+(?:allowed|possible|permitted|ok|available)|flexible\s+variants?|partial\s+(?:quantities|quantity|qty|pallets?)\s+(?:permitted|allowed|possible|ok)|assorted|multi[\s-]?brand)\b/i;
const MIXED_NO = /\b(?:no\s+mix(?:ing|ed)?\w*|not\s+mixed|cannot\s+be\s+mixed|can'?t\s+be\s+mixed|unmixed\s+only|full\s+pallets?\s+only|single\s+(?:sku|variant|brand)\s+only)\b/i;

// Ex-stock is a real value, not a blank.
const EX_STOCK = /\b(?:ex[\s-]?stock|in\s+stock|on\s+(?:the\s+)?floor|immediate(?:ly)?|prompt|readily\s+available|available\s+(?:now|immediately)|ready\s+(?:now|to\s+ship|to\s+load|for\s+(?:collection|loading|pickup))|stock\s+available|direct(?:ly)?\s+available)\b/i;
const NOT_IN_STOCK = /\b(?:not?\s+(?:in\s+)?stock|out\s+of\s+stock|no\s+stock)\b/i;

const LEAD_KEYWORD = /\b(?:lead\s*-?\s*time|leadtime|delivery\s*(?:lead\s*time|time|term|in|within)?|dispatch(?:ed)?|shipping\s*time|ship(?:ped|ment)?\s*(?:in|within)|ready\s+in|available\s+in|collection|loading\s*time|eta|production\s*time|availability)\b/i;

const DUR_UNIT = '(?:working\\s*days?|business\\s*days?|work\\s*days?|working\\s*weeks?|days?|weeks?|wks?|months?|mths?|mos?|hours?|hrs?|h)';
const DUR_RE = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:-|–|—|to|~|\\+)?\\s*(\\d+(?:[.,]\\d+)?)?\\s*${DUR_UNIT}\\b`, 'gi');
const DUR_UNIT_RE = new RegExp(DUR_UNIT, 'i');
const SAME_DAY = /\b(?:same[\s-]day)\b/i;
const NEXT_DAY = /\b(?:next[\s-]day|overnight)\b/i;

// ── Entry point ─────────────────────────────────────────────────────────────

// The header is parsed ONCE per distinct list and reused for every line from
// it: order-level terms usually sit in the header, and re-running the parser
// per line on the same block is the same answer computed 2,000 times.
const headerCache = new Map();

const out = [];
for (const item of $input.all()) {
  const line = (item && item.json) || {};
  try {
    out.push({ json: normaliseLine(line) });
  } catch (err) {
    // Never block ingestion on a parse failure.
    out.push({ json: failOpen(line, err) });
  }
}
return out;

// ── Per-line resolution ─────────────────────────────────────────────────────

function normaliseLine(line) {
  const rawName = str(line.rawName);
  const rawMoq = str(line.rawMoq);
  const rawLeadTime = str(line.rawLeadTime);
  const rawNotes = str(line.rawNotes);
  const headerText = str(line.headerText);
  const category = str(line.category);
  const defaults = readSupplierDefaults(line.supplierDefaults);
  const dryRun = line.dryRun === undefined ? DEFAULT_DRY_RUN : Boolean(line.dryRun);

  const notes = [];
  const unrecognised = [];
  const header = parseHeader(headerText);

  // Spans of rawName consumed by an operational fact, so they can be stripped
  // from the public description afterwards.
  const nameSpans = [];

  // ── MOQ cascade: line -> header -> supplier default -> category rule ──
  let moq = null;
  let moqSource = '';

  if (rawMoq) {
    // Its own column. The supplier put it there deliberately, so even though we
    // still have to parse the cell, the value is stated rather than inferred.
    const hit = readMoq(rawMoq, false);
    if (hit) { moq = hit; moqSource = 'Supplier Stated'; }
    else unrecognised.push(trim60(rawMoq));
  }
  if (!moq) {
    for (const [field, text] of [['rawName', rawName], ['rawNotes', rawNotes]]) {
      if (!text) continue;
      const hit = readMoq(text, true);
      if (hit) {
        moq = hit; moqSource = 'Parsed From Text';
        if (field === 'rawName' && hit.span) nameSpans.push(hit.span);
        break;
      }
      if (MIN_KEYWORD.test(text)) unrecognised.push(keywordWindow(text, MIN_KEYWORD));
    }
  }
  if (!moq && header.moq) {
    // Stated once for the whole list. Still text we parsed, so still labelled
    // "Parsed From Text" — the four source values are the ones live in the base.
    moq = header.moq; moqSource = 'Parsed From Text';
    notes.push('MOQ taken from the list header');
  }
  if (!moq && defaults.moqType) {
    moq = { type: defaults.moqType, qty: defaults.moqQty, currency: '' };
    moqSource = 'Supplier Default';
  }
  if (!moq) {
    const rule = CATEGORY_RULES[category];
    if (rule && rule.moqType) {
      moq = { type: rule.moqType, qty: rule.moqQty ?? null, currency: rule.moqCurrency || '' };
      moqSource = 'Category Rule';
    }
  }

  // ── Lead time cascade, same order ──
  let leadTimeDays = null;
  let leadTimeSource = '';

  if (rawLeadTime) {
    const hit = readLeadTime(rawLeadTime, false);
    if (hit) { leadTimeDays = hit.days; leadTimeSource = 'Supplier Stated'; }
    else unrecognised.push(trim60(rawLeadTime));
  }
  if (leadTimeDays === null) {
    for (const [field, text] of [['rawName', rawName], ['rawNotes', rawNotes]]) {
      if (!text) continue;
      const hit = readLeadTime(text, true);
      if (hit) {
        leadTimeDays = hit.days; leadTimeSource = 'Parsed From Text';
        if (field === 'rawName' && hit.span) nameSpans.push(hit.span);
        break;
      }
      if (LEAD_KEYWORD.test(text)) unrecognised.push(keywordWindow(text, LEAD_KEYWORD));
    }
  }
  if (leadTimeDays === null && header.leadTimeDays !== null) {
    leadTimeDays = header.leadTimeDays; leadTimeSource = 'Parsed From Text';
    notes.push('Lead time taken from the list header');
  }
  if (leadTimeDays === null && defaults.leadTimeDays !== null) {
    leadTimeDays = defaults.leadTimeDays; leadTimeSource = 'Supplier Default';
  }
  if (leadTimeDays === null) {
    const rule = CATEGORY_RULES[category];
    if (rule && rule.leadTimeDays !== undefined && rule.leadTimeDays !== null) {
      leadTimeDays = rule.leadTimeDays; leadTimeSource = 'Category Rule';
    }
  }

  // ── Mixed load: stated on the line, else stated for the list ──
  let mixed = readMixed(`${rawName}\n${rawNotes}\n${rawMoq}`);
  if (mixed === null) mixed = header.mixed;

  // ── A stated quantity with no unit borrows the supplier's default unit ──
  if (moq && moq.type === 'Applies — Unspecified' && moq.bareQty && defaults.moqType) {
    moq = { type: defaults.moqType, qty: moq.bareQty, currency: '' };
    notes.push(`Quantity ${moq.qty} was stated without a unit; the supplier's default unit (${defaults.moqType}) was used`);
  } else if (moq && moq.bareQty && !defaults.moqType) {
    notes.push(`"${moq.bareQty}" was stated as a minimum with no unit — MOQ Qty left blank rather than guessed`);
    unrecognised.push(trim60(moq.raw || String(moq.bareQty)));
  }

  if (moq && moq.note) notes.push(moq.note);

  // `MOQ Currency` is only meaningful on an order value.
  if (moq && moq.type !== 'Order Value') moq.currency = '';

  // ── Clean the product name ──
  const productName = stripSpans(rawName, nameSpans) || rawName;
  if (nameSpans.length && productName !== rawName) {
    notes.push('Operational terms were moved out of the product name');
  }

  const terms = {
    moqType: moq ? moq.type : '',
    moqQty: moq && moq.qty !== undefined && moq.qty !== null ? moq.qty : null,
    moqCurrency: moq ? (moq.currency || '') : '',
    moqSource: moq ? moqSource : '',
    mixedLoadAllowed: mixed,
    leadTimeDays,
    leadTimeSource,
  };

  const parse = report(terms, notes, unrecognised);
  const fields = buildFields(terms, parse);

  return {
    ...line,
    productName,
    rawProductName: rawName,
    tradeTerms: terms,
    fields: dryRun ? {} : fields,
    fieldsPreview: fields,
    parse,
    dryRun,
  };
}

/** A line that threw is still a valid offer. Emit it, flagged, never dropped. */
function failOpen(line, err) {
  const message = (err && err.message) || String(err);
  return {
    ...line,
    productName: str(line.rawName),
    rawProductName: str(line.rawName),
    tradeTerms: { moqType: '', moqQty: null, moqCurrency: '', moqSource: '',
                  mixedLoadAllowed: null, leadTimeDays: null, leadTimeSource: '' },
    fields: PARSE_FIELDS_LIVE
      ? { 'Parse Status': 'Unrecognised', 'Parse Notes': `Parser error: ${message}` }
      : {},
    fieldsPreview: { 'Parse Status': 'Unrecognised', 'Parse Notes': `Parser error: ${message}` },
    parse: { status: 'Unrecognised', notes: [`Parser error: ${message}`], unrecognised: [] },
    dryRun: line.dryRun === undefined ? DEFAULT_DRY_RUN : Boolean(line.dryRun),
  };
}

// ── The parse report ────────────────────────────────────────────────────────

/**
 * Clean / Partial / Unrecognised.
 *
 * This is what makes the next backfill unnecessary: a new wording shows up in
 * the weekly digest the week it starts, as a five-minute parser edit, instead
 * of two years later as a day of dry runs against live data.
 */
function report(terms, notes, unrecognised) {
  const leftovers = unrecognised.filter(Boolean);
  const resolved = (terms.moqType ? 1 : 0) + (terms.leadTimeDays !== null ? 1 : 0);
  let status;
  if (resolved === 0) status = 'Unrecognised';
  else if (resolved === 2 && leftovers.length === 0) status = 'Clean';
  else status = 'Partial';
  return { status, notes: notes.filter(Boolean), unrecognised: leftovers };
}

function buildFields(terms, parse) {
  const f = {};
  if (terms.moqType) f['MOQ Type'] = terms.moqType;
  if (terms.moqQty !== null) f['MOQ Qty'] = terms.moqQty;
  if (terms.moqCurrency) f['MOQ Currency'] = terms.moqCurrency;
  if (terms.moqSource) f['MOQ Source'] = terms.moqSource;
  if (terms.mixedLoadAllowed !== null) f['Mixed Load Allowed'] = terms.mixedLoadAllowed;
  if (terms.leadTimeDays !== null) f['Lead Time Days'] = terms.leadTimeDays;
  if (PARSE_FIELDS_LIVE) {
    f['Parse Status'] = parse.status;
    const text = [...parse.notes, ...parse.unrecognised.map((u) => `Unparsed: ${u}`)].join(' · ');
    if (text) f['Parse Notes'] = text.slice(0, 500);
  }
  return f;
}

// ── The header, parsed once per list ────────────────────────────────────────

function parseHeader(headerText) {
  if (!headerText) return { moq: null, leadTimeDays: null, mixed: null };
  if (headerCache.has(headerText)) return headerCache.get(headerText);
  const moq = readMoq(headerText, true);
  const lead = readLeadTime(headerText, true);
  const parsed = {
    moq,
    leadTimeDays: lead ? lead.days : null,
    mixed: readMixed(headerText),
  };
  headerCache.set(headerText, parsed);
  return parsed;
}

// ── MOQ ─────────────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {boolean} requireKeyword  true for free text, where an MOQ statement
 *   has to announce itself; false for a dedicated MOQ cell, which is one by
 *   definition.
 * @returns {null|{type, qty, currency, span, note, bareQty, raw}}
 */
function readMoq(text, requireKeyword) {
  const s = spacedThousands(String(text));
  if (!requireKeyword) {
    // A cell that names itself ("MOQ: 50") is read twice: once whole, so
    // "MOQ: n/a" still resolves to No Minimum, then with the label stripped,
    // so the bare number behind it is reachable.
    const hit = readMoqValue(s) || readMoqValue(stripLeadingKeyword(s));
    if (hit) { hit.span = [0, s.length]; hit.raw = s; return hit; }
    // A cell holding only "MOQ applies" style prose still states that one exists.
    if (MOQ_UNSPECIFIED.test(s)) return { type: 'Applies — Unspecified', qty: null, currency: '', span: [0, s.length], raw: s };
    return null;
  }

  for (const { seg, offset } of segments(s)) {
    const kw = MIN_KEYWORD.exec(seg);
    if (!kw) continue;
    const after = seg.slice(kw.index + kw[0].length);
    const before = seg.slice(0, kw.index);

    // "MOQ 50 cases" and "150 cases min" are both common, so both sides of the
    // keyword are read — the value first, because that is the usual order.
    let hit = readMoqValue(after);
    let span;
    if (hit) {
      span = [offset + kw.index, offset + kw.index + kw[0].length + hit.end];
    } else {
      hit = readMoqValue(before, true);
      if (hit) span = [offset + hit.start, offset + kw.index + kw[0].length];
    }
    if (hit) { hit.span = span; hit.raw = seg.trim(); return hit; }

    if (MOQ_UNSPECIFIED.test(seg)) {
      return { type: 'Applies — Unspecified', qty: null, currency: '',
               span: [offset + kw.index, offset + kw.index + kw[0].length], raw: seg.trim() };
    }
  }
  return null;
}

/**
 * Read an MOQ value out of a window of text.
 *
 * Order is deliberate. Money minimums dominate: three quarters of stated MOQs
 * are whole-offer values ("Minimum mixed order USD 35,000"), not per-line
 * counts, and a count pattern would otherwise claim the digits first.
 */
function readMoqValue(window, fromEnd) {
  const w = String(window);
  if (!w.trim()) return null;

  if (NO_MINIMUM.test(w)) {
    const m = NO_MINIMUM.exec(w);
    return { type: 'No Minimum', qty: null, currency: '', start: m.index, end: m.index + m[0].length };
  }

  // 1. Money — matched currency-first and amount-first, lowest bound taken.
  const money = allMoney(w);
  if (money.length) {
    const best = money.reduce((a, b) => (b.amount < a.amount ? b : a));
    const note = allCounts(w).length
      ? 'Both an order value and a unit count were stated as the minimum; the order value was taken'
      : '';
    return { type: 'Order Value', qty: best.amount, currency: best.currency,
             start: best.start, end: best.end, note };
  }

  // 2. Counts — a range resolves to its LOWER bound, in the buyer's favour.
  const counts = allCounts(w);
  if (counts.length) {
    const type = counts[0].type;
    const same = counts.filter((c) => c.type === type);
    const best = same.reduce((a, b) => (b.qty < a.qty ? b : a));
    const note = counts.length > same.length
      ? 'More than one minimum unit was stated; the first one was taken'
      : '';
    return { type, qty: best.qty, currency: '', start: best.start, end: best.end, note };
  }

  // 3. Whole-load minimums.
  const ftl = FTL_RE.exec(w);
  if (ftl) return { type: 'Full Truckload', qty: ftl[1] ? Number(ftl[1]) : null, currency: '',
                    start: ftl.index, end: ftl.index + ftl[0].length };
  const cont = CONTAINER_RE.exec(w);
  if (cont) return { type: 'Container', qty: cont[1] ? Number(cont[1]) : null, currency: '',
                     start: cont.index, end: cont.index + cont[0].length };
  const pal = PALLET_ONLY_RE.exec(w);
  if (pal) return { type: 'Pallets', qty: /full\s+pallets?/i.test(pal[0]) ? 1 : null, currency: '',
                    start: pal.index, end: pal.index + pal[0].length };

  // 4. A bare number. "MOQ: 50" — fifty of what? Carried up as `bareQty` so the
  //    caller can borrow the supplier's default unit; never guessed here.
  const bare = fromEnd ? lastMatch(/(\d[\d.,]*)\s*$/g, w) : /^\s*[:\-=]?\s*(\d[\d.,]*)\b/.exec(w);
  if (bare) {
    const n = parseAmount(bare[1]);
    if (n !== null && n > 0) {
      return { type: 'Applies — Unspecified', qty: null, currency: '', bareQty: Math.round(n),
               start: bare.index, end: bare.index + bare[0].length };
    }
  }
  return null;
}

function allMoney(w) {
  const found = [];
  const re = new RegExp(MONEY_RE.source, 'gi');
  let m;
  while ((m = re.exec(w)) !== null) {
    const sym = m[1] || m[4];
    const raw = m[2] || m[3];
    const amount = parseAmount(raw);
    if (amount === null || !(amount > 0)) continue;
    const iso = CURRENCY[String(sym).toLowerCase()] || '';
    if (!iso) continue;
    found.push({ amount, currency: iso, start: m.index, end: m.index + m[0].length });
  }
  return found;
}

function allCounts(w) {
  const found = [];
  const re = new RegExp(COUNT_RE.source, 'gi');
  let m;
  while ((m = re.exec(w)) !== null) {
    const type = unitType(m[3]);
    if (!type) continue;
    // A range takes the lower bound; m[1] is already the lower one.
    const qty = parseAmount(m[1]);
    if (qty === null || !(qty > 0)) continue;
    found.push({ type, qty: Math.round(qty), start: m.index, end: m.index + m[0].length });
  }
  return found;
}

function unitType(word) {
  for (const [type, re] of UNIT_TYPE) if (re.test(String(word))) return type;
  return '';
}

// ── Lead time ───────────────────────────────────────────────────────────────

/** @returns {null|{days, span}} — 0 is a real answer (ex-stock), not a blank. */
function readLeadTime(text, requireKeyword) {
  const s = String(text);

  if (!requireKeyword) {
    const hit = readLeadValue(s);
    return hit ? { days: hit.days, span: [0, s.length] } : null;
  }

  for (const { seg, offset } of segments(s)) {
    const kw = LEAD_KEYWORD.exec(seg);
    const stock = EX_STOCK.exec(seg);
    if (!kw && !stock) continue;
    const hit = readLeadValue(seg);
    if (!hit) continue;
    const start = Math.min(kw ? kw.index : Infinity, hit.start);
    const end = Math.max(kw ? kw.index + kw[0].length : 0, hit.end);
    return { days: hit.days, span: [offset + start, offset + end] };
  }
  return null;
}

function readLeadValue(window) {
  const w = String(window);

  // A stated duration beats a stated availability: "in stock, delivery 3 days"
  // means three days, not zero. Ranges resolve to the UPPER bound — deliberately
  // the opposite of MOQ, deliberately consistent: both land in the buyer's favour.
  const durations = allDurations(w);
  if (durations.length) {
    const best = durations.reduce((a, b) => (b.days > a.days ? b : a));
    return { days: best.days, start: best.start, end: best.end };
  }

  const sameDay = SAME_DAY.exec(w);
  if (sameDay) return { days: 0, start: sameDay.index, end: sameDay.index + sameDay[0].length };
  const nextDay = NEXT_DAY.exec(w);
  if (nextDay) return { days: 1, start: nextDay.index, end: nextDay.index + nextDay[0].length };

  if (NOT_IN_STOCK.test(w)) return null;
  const stock = EX_STOCK.exec(w);
  if (stock) return { days: 0, start: stock.index, end: stock.index + stock[0].length };

  return null;
}

function allDurations(w) {
  const found = [];
  const re = new RegExp(DUR_RE.source, 'gi');
  let m;
  while ((m = re.exec(w)) !== null) {
    const unit = DUR_UNIT_RE.exec(m[0].slice(String(m[1]).length));
    if (!unit) continue;
    const upper = m[2] !== undefined ? parseAmount(m[2]) : parseAmount(m[1]);
    if (upper === null || upper < 0) continue;
    const days = toDays(upper, unit[0]);
    if (days === null) continue;
    found.push({ days, start: m.index, end: m.index + m[0].length });
  }
  return found;
}

/**
 * Working days are converted at five to the week, so "10 working days" is two
 * calendar weeks rather than ten. A buyer asks when goods arrive, not how many
 * shifts the warehouse works, and rounding up keeps it in the buyer's favour.
 */
function toDays(n, unitRaw) {
  const u = String(unitRaw).toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:working|business|work) days?$/.test(u)) return Math.ceil((n * 7) / 5);
  if (/^working weeks?$/.test(u)) return Math.ceil(n * 7);
  if (/^days?$/.test(u)) return Math.ceil(n);
  if (/^(?:weeks?|wks?)$/.test(u)) return Math.ceil(n * 7);
  if (/^(?:months?|mths?|mos?)$/.test(u)) return Math.ceil(n * 30);
  if (/^(?:hours?|hrs?|h)$/.test(u)) return Math.ceil(n / 24);
  return null;
}

// ── Mixed load ──────────────────────────────────────────────────────────────

/** @returns {null|boolean} — null means nobody said, which is not the same as no. */
function readMixed(text) {
  const s = String(text);
  if (!s.trim()) return null;
  if (MIXED_NO.test(s)) return false;
  if (MIXED_YES.test(s)) return true;
  return null;
}

// ── Supplier record defaults ────────────────────────────────────────────────

/**
 * Accepts the Airtable field names straight off the supplier record, or the
 * camelCase shape a caller may already have mapped them into.
 */
function readSupplierDefaults(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const qty = firstDefined(d['Default MOQ Qty'], d.defaultMoqQty, d.moqQty);
  const unit = firstDefined(d['Default MOQ Unit'], d.defaultMoqUnit, d.moqUnit);
  const lead = firstDefined(d['Default Lead Time Days'], d.defaultLeadTimeDays, d.leadTimeDays);

  const unitStr = str(unit);
  let moqType = '';
  if (unitStr) moqType = MOQ_TYPES.find((t) => t.toLowerCase() === unitStr.toLowerCase()) || unitType(unitStr);

  const qtyNum = toNumber(qty);
  const leadNum = toNumber(lead);
  return {
    moqType,
    moqQty: qtyNum !== null && qtyNum > 0 ? Math.round(qtyNum) : null,
    leadTimeDays: leadNum !== null && leadNum >= 0 ? Math.round(leadNum) : null,
  };
}

// ── Name cleaning ───────────────────────────────────────────────────────────

/**
 * Once a fact has its own field it should not also sit in the public
 * description: "Jim Beam Apple 12x70cl MOQ 50 cases" lists as "Jim Beam Apple
 * 12x70cl". The original is kept in `rawProductName`, so nothing is lost.
 *
 * If stripping would leave nothing usable the original is returned instead —
 * a blank product name is a worse outcome than a slightly noisy one.
 */
function stripSpans(name, spans) {
  if (!name || !spans.length) return name;
  const ordered = spans
    .filter((s) => Array.isArray(s) && s[1] > s[0])
    .sort((a, b) => b[0] - a[0]);
  let s = String(name);
  for (const [start, end] of ordered) {
    if (start < 0 || end > s.length) continue;
    s = `${s.slice(0, start)} ${s.slice(end)}`;
  }
  const cleaned = s
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s*[,;|]\s*$/g, '')
    .replace(/\s*[-–—,;|]\s*$/, '')
    .replace(/^\s*[-–—,;|]\s*/, '')
    .replace(/\s+([,;)])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.length >= 3 ? cleaned : String(name).trim();
}

// ── Small helpers ───────────────────────────────────────────────────────────

function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return undefined;
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseAmount(String(v).replace(/[^\d.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * "35,000" · "35.000" · "1,250.50" · "35k" — suppliers use every convention,
 * and 35.000 is thirty-five thousand far more often than it is thirty-five.
 * The rule: three digits after the final separator is a thousands group.
 */
function parseAmount(raw) {
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  const km = /^([\d.,]+)([km])$/.exec(s);
  if (km) {
    const base = parseAmount(km[1]);
    return base === null ? null : base * (km[2] === 'k' ? 1e3 : 1e6);
  }
  if (!/^\d[\d.,]*$/.test(s)) return null;
  s = s.replace(/[.,]+$/, '');
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep === -1) return Number(s);
  const head = s.slice(0, lastSep).replace(/[.,]/g, '');
  const tail = s.slice(lastSep + 1);
  if (!/^\d+$/.test(head) || !/^\d+$/.test(tail)) return null;
  if (tail.length === 3) return Number(head + tail);
  return Number(`${head}.${tail}`);
}

/** "35 000" is a thousands group written with a space. */
function spacedThousands(s) {
  return String(s).replace(/(\d)\s(\d{3})\b/g, '$1,$2');
}

/**
 * Terms are read per segment and never across one. A flattened search runs
 * straight past the end of a value — the same reason `readTerms` in
 * extract-wa-offers.js splits before matching.
 */
function segments(text) {
  const out = [];
  const s = String(text);
  const re = /[^\n|;•]+/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0].trim()) out.push({ seg: m[0], offset: m.index });
  }
  return out.length ? out : [{ seg: s, offset: 0 }];
}

function lastMatch(re, s) {
  let m, last = null;
  const r = new RegExp(re.source, 'g');
  while ((m = r.exec(s)) !== null) { last = m; if (m.index === r.lastIndex) r.lastIndex++; }
  return last;
}

/** The text around an unmatched keyword — this is what the weekly digest groups on. */
function keywordWindow(text, re) {
  const s = spacedThousands(String(text));
  for (const { seg } of segments(s)) {
    if (re.test(seg)) return trim60(seg.trim());
  }
  return trim60(s);
}

function trim60(s) { return String(s).replace(/\s+/g, ' ').trim().slice(0, 120); }

/** Drop a leading "MOQ:" / "Minimum order -" label from a dedicated cell. */
function stripLeadingKeyword(s) {
  const kw = MIN_KEYWORD.exec(s);
  if (!kw || kw.index > 2) return s;
  return s.slice(kw.index + kw[0].length).replace(/^\s*[:\-=]\s*/, '');
}
