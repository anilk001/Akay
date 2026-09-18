// Airtable data layer for the AKAY offers catalogue.
//
// getOffers() runs at BUILD time only. It fetches the public catalogue live from
// Airtable using a read-only token, and maps ONLY public-safe fields into the
// shape the page renders. Supplier identity, buy prices, margins and internal
// notes are never requested, so they can never leak to the browser.
//
// If no token is present, or the network is unavailable (e.g. a restricted CI
// sandbox), it falls back to the committed snapshot so the build still succeeds.

import snapshot from './offers-snapshot.json' with { type: 'json' };
import { parseVolumeMl } from '../lib/normalise.mjs';
import { tradeTermsView } from '../lib/trade-terms.mjs';

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.Airtable_Pat || '';
const BASE = process.env.AIRTABLE_BASE_ID || 'appaDSdZkAE9PGkjT';
const TABLE = process.env.AIRTABLE_OFFERS_TABLE || 'Offers';
// "Site Stats": a key/value table of headline figures computed elsewhere (an
// n8n workflow writes them daily) and only READ here. Addressed by table id so
// a rename in Airtable cannot silently point the build at nothing.
const STATS_TABLE = process.env.AIRTABLE_STATS_TABLE || 'tblC0Bnld4aZTv7dd';

// Public-safe fields only. Anything not listed here is never pulled.
const FIELDS = [
  'Public Product Description', 'Variant', 'Brand', 'Category', 'Public Spec',
  'Price Display', 'Currency', 'Price Type', 'Price Per Unit & Case', 'PCS/Case',
  'Volume ML', 'Unit Type',
  'Stock Display', 'Stock Cases', 'Public Terms', 'Warehouse', 'Incoterm',
  'Bond/Customs Status', 'Origin Country', 'Public Listing', 'Featured',
  // Barcodes. Public by definition — they are printed on the product — and
  // they are how a buyer's uploaded list is matched when it identifies goods
  // by barcode rather than by name (the Trade Desk reads /search-index.json).
  'EAN Unit', 'EAN Case',
  'MOQ', 'Lead Time', 'BBD', 'Public Note', 'Offer Date', 'Auto Expiry Date',
  // Structured trade terms, parsed at ingestion by the n8n normaliser. The two
  // free-text columns above stay in the list as the fallback for rows the
  // parser has not reached yet.
  'MOQ Type', 'MOQ Qty', 'MOQ Currency', 'MOQ Source', 'Mixed Load Allowed',
  'Lead Time Days',
];

// Site Stats columns the build may read. The rest of that table — the numeric
// total, the plain-English coverage note, line counts, rate date — is internal
// and listed in FORBIDDEN_FIELDS below, so it is never requested and the
// post-build checker fails if it ever turns up in dist/.
const STATS_FIELDS = ['Stat Key', 'Display Value', 'Publish'];

// Fields that must never be requested, whatever the allowlist above says.
// Exact names from the Offers table plus patterns that catch any future field
// carrying supplier identity, cost, margin or internal commentary. Checked at
// module load so a bad edit to FIELDS fails the build instead of shipping.
export const FORBIDDEN_FIELDS = [
  'Offer Name', 'Notes', 'Trader Comment', 'Delivery Info Source', 'Delivery Notes',
  'Supplier', 'Supplier Name', 'Supplier Email', 'Supplier Country', 'Supplier Trust Level',
  'Supplier Payment Terms', 'Buy Price', 'Margin %', 'Source Sheet', 'Source Message ID',
  'Bundle ID', 'Bundle Title', 'Target Countries', 'Excluded Countries', 'Target Capsule Tags',
  'Target Region', 'Trust Level', 'Best Comparable Price', 'Price Delta %', 'Price Level',
  'Client Feedback', 'WA Broadcast Log', 'WA Target Segments',
  // Site Stats table — everything but the display string is internal.
  'Numeric Value', 'Detail', 'Lines Counted', 'Lines Skipped No Qty', 'Rate Date', 'Updated At',
];
export const FORBIDDEN_PATTERN = /supplier|buy|cost|markup|margin|trader|vendor|contact|internal|source|bundle|target|excluded|trust|\bnotes?\b|comparable|feedback|broadcast/i;
// Public-by-design names the pattern would otherwise trip on: the Airtable
// field "Public Note" and the `note` key it becomes in the search index, plus
// "MOQ Source" — which records which tier of the cascade supplied a minimum
// (Supplier Stated / Parsed From Text / Supplier Default / Category Rule), not
// who the supplier is. It is read at BUILD time only, to decide whether the
// page may state a minimum or must hedge it; `moqSource` is deliberately kept
// out of PUBLIC_KEYS so it never reaches the browser.
const PATTERN_EXCEPTIONS = new Set(['Public Note', 'note', 'MOQ Source']);

export function isForbiddenField(name) {
  if (FORBIDDEN_FIELDS.includes(name)) return true;
  if (PATTERN_EXCEPTIONS.has(name)) return false;
  return FORBIDDEN_PATTERN.test(name);
}

for (const f of FIELDS) {
  if (isForbiddenField(f)) throw new Error(`[airtable] FIELDS contains a non-public field: "${f}"`);
}
for (const f of STATS_FIELDS) {
  if (isForbiddenField(f)) throw new Error(`[airtable] STATS_FIELDS contains a non-public field: "${f}"`);
}

const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP', 'DPU', 'CPT', 'CIP', 'FAS'];

// Keyword fallback for Unit Type when the Airtable field is blank. Only fires on
// an unambiguous word in the spec or name; otherwise leaves the facet empty.
function inferUnitType(text = '') {
  const s = ` ${String(text).toLowerCase()} `;
  if (/\b(cans?|tins?)\b/.test(s)) return 'Can';
  if (/\b(btls?|bottles?|pet|nrb)\b/.test(s)) return 'Bottle';
  if (/\b(jars?)\b/.test(s)) return 'Jar';
  if (/\b(sachets?)\b/.test(s)) return 'Sachet';
  if (/\b(tubes?)\b/.test(s)) return 'Tube';
  return '';
}

// "EXW Loendersloot" -> { incoterm: 'EXW', warehouse: 'Loendersloot' }
function splitTerms(terms = '') {
  const t = String(terms).trim();
  const m = t.match(/^([A-Z]{3})\b\s*(.*)$/);
  if (m && INCOTERMS.includes(m[1])) return { incoterm: m[1], warehouse: m[2].trim() };
  return { incoterm: '', warehouse: t };
}

// Fill the search facets from whatever is available. Airtable values win;
// blanks are derived from the public spec / terms so a row with an empty
// "Volume ML" still lands in the right size chip instead of vanishing.
function deriveExtras(o) {
  const volumeMl = Number.isFinite(o.volumeMl) && o.volumeMl > 0 ? Math.round(o.volumeMl)
    : parseVolumeMl(o.spec) || parseVolumeMl(o.name) || null;
  const pack = Number.isFinite(o.pack) && o.pack > 0 ? o.pack : packSize(o.priceDetail, o.spec);
  const unitType = o.unitType || inferUnitType(`${o.spec} ${o.name}`);
  const split = splitTerms(o.terms);
  return {
    ...o,
    volumeMl,
    pack,
    unitType,
    incoterm: o.incoterm || split.incoterm,
    warehouse: o.warehouse || split.warehouse,
    // Worded once here so the offer page, the cards and the search index all
    // say the same thing, and a supplier default never reads as a commitment.
    ...tradeTermsView(o),
  };
}

function stockCode(label = '') {
  const s = String(label).toLowerCase();
  if (s.includes('in stock')) return 'in';
  if (s.includes('limited')) return 'warn';
  return 'enq';
}

function parseAmount(priceDisplay = '', currencyField = '') {
  // "EUR 10.05" -> { currency:"EUR", amount:10.05 }
  const m = String(priceDisplay).match(/([A-Z]{3})?\s*([\d.,]+)/);
  const amount = m ? parseFloat(m[2].replace(/,/g, '')) : null;
  const currency = currencyField || (m && m[1]) || '';
  return { currency, amount };
}

// "EUR 9.24/case (12pk) · EUR 0.77/unit" -> [{currency,amount,basis}, ...]
// The headline figure must come from the SAME string that supplies the basis,
// otherwise a per-unit number ends up printed under a "/ case" label.
function parsePriceParts(detail = '') {
  return String(detail)
    .split('·')
    .map((part) => {
      const m = part.match(/([A-Z]{3})?\s*([\d.,]+)\s*\/\s*(case|unit|btl|bottle|pack|can|jar|piece)?/i);
      if (!m) return null;
      return {
        currency: m[1] || '',
        amount: parseFloat(m[2].replace(/,/g, '')),
        basis: (m[3] || '').toLowerCase(),
      };
    })
    .filter((p) => p && Number.isFinite(p.amount));
}

// "EUR 112.44/case (6pk)" -> 6, or "6 x 70cl" -> 6. Used to derive a per-unit
// figure for offers that only publish a case price, so price sorting compares
// every offer in the same unit.
function packSize(detail = '', spec = '') {
  const pk = String(detail).match(/\((\d+)\s*pk\)/i);
  if (pk) return parseInt(pk[1], 10);
  const sp = String(spec).match(/^\s*(\d+)\s*[x×]/i);
  if (sp) return parseInt(sp[1], 10);
  return null;
}

// Splits a trailing variant list out of the product name:
// "Nivea Roll On 50ml — Bright & Dry, Silk Touch, Pearl" -> name + variants.
// Only splits when the tail really is a list (two or more commas), so real
// product names with a single dash stay intact.
function splitVariants(rawName = '', variantField = '') {
  const name = String(rawName).trim();
  if (variantField) return { name, variants: String(variantField).trim() };
  const idx = name.search(/\s+[—–-]\s+/);
  if (idx > 0) {
    const head = name.slice(0, idx).trim();
    const tail = name.slice(idx).replace(/^\s+[—–-]\s+/, '').trim();
    if ((tail.match(/,/g) || []).length >= 2 && head.length >= 8) return { name: head, variants: tail };
  }
  return { name, variants: '' };
}

function isTestRow(name = '') {
  return /^testbrand|^testproduct/i.test(name.trim());
}

function normalize(fields, recordId = null) {
  const detail = fields['Price Per Unit & Case'] || fields['Price Display'] || '';
  const parts = parsePriceParts(detail);
  const fallback = parseAmount(fields['Price Display'], fields['Currency']);
  const headline = parts[0] || null;
  const perUnit = parts.find((p) => /unit|btl|bottle|can|piece|jar/.test(p.basis));
  // Headline amount and its basis now always come from the same string.
  const amount = headline ? headline.amount : fallback.amount;
  const currency = fields['Currency'] || (headline && headline.currency) || fallback.currency || '';
  // Sorting compares like with like: a per-unit figure for every offer.
  // Case-only prices are divided by the pack size; if the pack is unknown the
  // case figure stays (imperfect, but never worse than the pre-fix behaviour).
  const spec = fields['Public Spec'] || '';
  const pack = packSize(detail, spec) || (typeof fields['PCS/Case'] === 'number' && fields['PCS/Case'] > 1 ? fields['PCS/Case'] : null);
  const unitAmount = perUnit ? perUnit.amount
    : headline && /case|pack/.test(headline.basis)
      ? (pack ? +(headline.amount / pack).toFixed(4) : headline.amount)
      : headline ? headline.amount
      : fallback.amount;
  const { name, variants } = splitVariants(fields['Public Product Description'], fields['Variant']);
  const rawQty = fields['Stock Cases'];
  return {
    id: recordId,
    name,
    variants,
    brand: fields['Brand'] || '',
    category: fields['Category'] || 'Other',
    spec: fields['Public Spec'] || '',
    currency,
    amount,
    unitAmount,
    priceDetail: detail,
    // Basis of `amount` (case/pack/unit/bottle/…), taken from the SAME price
    // part that supplied `amount`, so structured data can label the quantity
    // correctly. Empty when the price string carried no basis (a bare Price
    // Display fallback) — in which case consumers must not assert a basis.
    priceBasis: headline ? (headline.basis || '') : String(fields['Price Type'] || '').replace(/^per\s+/i, '').toLowerCase(),
    stock: stockCode(fields['Stock Display']),
    // Cases are whole units — a fractional count means units were entered as cases.
    qty: typeof rawQty === 'number' ? Math.round(rawQty) : null,
    terms: fields['Public Terms'] || '',
    tier: fields['Bond/Customs Status'] || '',
    origin: fields['Origin Country'] || '',
    featured: fields['Featured'] === true,
    volumeMl: typeof fields['Volume ML'] === 'number' ? fields['Volume ML'] : null,
    pack: typeof fields['PCS/Case'] === 'number' ? fields['PCS/Case'] : null,
    unitType: fields['Unit Type'] || '',
    // Unit and case barcodes, for matching an uploaded buying list.
    ean: fields['EAN Unit'] || '',
    eanCase: fields['EAN Case'] || '',
    warehouse: fields['Warehouse'] && fields['Warehouse'] !== 'Other' ? fields['Warehouse'] : '',
    incoterm: fields['Incoterm'] && fields['Incoterm'] !== 'Other' ? fields['Incoterm'] : '',
    moq: fields['MOQ'] || '',
    leadTime: fields['Lead Time'] || '',
    moqType: fields['MOQ Type'] || '',
    moqQty: typeof fields['MOQ Qty'] === 'number' ? fields['MOQ Qty'] : null,
    moqCurrency: fields['MOQ Currency'] || '',
    // Build-time only — see PATTERN_EXCEPTIONS above.
    moqSource: fields['MOQ Source'] || '',
    mixedLoad: fields['Mixed Load Allowed'] === true,
    // 0 is ex-stock, which is a real answer; only a missing field is null.
    leadTimeDays: typeof fields['Lead Time Days'] === 'number' ? fields['Lead Time Days'] : null,
    bbd: fields['BBD'] || '',
    note: fields['Public Note'] || '',
    offerDate: fields['Offer Date'] || '',
    expiryDate: fields['Auto Expiry Date'] || '',
  };
}

/**
 * Airtable allows 5 requests/second per base and answers 429 above that. The
 * catalogue build shares that budget with the every-5-minutes refresh Action
 * and with n8n's ingestion runs, so a burst is not hypothetical.
 *
 * Retries only what is worth retrying: 429 and 5xx, plus network errors. A 401,
 * 403 or 422 is a configuration fault and repeating it just delays the report.
 * Honours Retry-After when Airtable sends one, otherwise backs off
 * exponentially from 500ms with jitter, so parallel builds do not resynchronise
 * onto the same retry instant.
 */
async function fetchWithRetry(url, init, tries = 4) {
  let wait = 500;
  for (let attempt = 1; ; attempt += 1) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt >= tries) throw err;
      await sleep(wait + Math.random() * 250);
      wait *= 2;
      continue;
    }

    if (res.status !== 429 && res.status < 500) return res;
    if (attempt >= tries) return res;   // caller turns it into a thrown error

    const retryAfter = Number(res.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : wait + Math.random() * 250;
    console.warn(`[airtable] ${res.status} on attempt ${attempt}/${tries} — retrying in ${Math.round(delay)}ms`);
    await sleep(delay);
    wait *= 2;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRows({ filterByFormula, sort = null, maxRecords = null }) {
  const base = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`;
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const out = [];
  let offset;
  do {
    const url = new URL(base);
    url.searchParams.set('filterByFormula', filterByFormula);
    url.searchParams.set('pageSize', '100');
    if (maxRecords) url.searchParams.set('maxRecords', String(maxRecords));
    // Sort/filter fields don't have to be in fields[] — Airtable applies them
    // server-side and still returns only the requested fields.
    if (sort) sort.forEach((s, i) => {
      url.searchParams.set(`sort[${i}][field]`, s.field);
      url.searchParams.set(`sort[${i}][direction]`, s.direction);
    });
    FIELDS.forEach((f) => url.searchParams.append('fields[]', f));
    if (offset) url.searchParams.set('offset', offset);

    const res = await fetchWithRetry(url, { headers });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const rec of data.records) {
      const o = deriveExtras(normalize(rec.fields, rec.id));
      if (o.name && !isTestRow(o.name)) out.push(o);
    }
    offset = data.offset;
  } while (offset && (!maxRecords || out.length < maxRecords));
  return maxRecords ? out.slice(0, maxRecords) : out;
}

function fetchLive() {
  return fetchRows({ filterByFormula: "{Public Listing}='Yes'" });
}

// Sold-out offers keep their URLs alive with an "out of stock — request quote"
// page instead of a 404, so indexed pages and inbound links survive stock
// turnover. These rows passed the same approval gates as live ones — only
// their Status flipped to Sold/Expired — and the fetch requests the identical
// public-safe FIELDS, so nothing non-public can leak. Newest first, capped so
// the archive can't grow without bound as offers churn.
const DELISTED_CAP = 800;
async function fetchDelisted() {
  const rows = await fetchRows({
    filterByFormula: "AND(OR({Status}='Sold',{Status}='Expired'),{Offer Approval Status}='Approved',{Listing Approved})",
    sort: [{ field: 'Offer Date', direction: 'desc' }],
    maxRecords: DELISTED_CAP,
  });
  return rows.map((o) => ({ ...o, delisted: true }));
}

// The committed snapshot was baked by an earlier version of normalize(), and a
// fresh deploy serves it until the next refresh runs. Applying the same
// corrections on read keeps both paths — live and snapshot — showing identical
// figures, so a fallback build can never resurrect the old per-unit/per-case mix-up.
function renormalizeSnapshotOffer(o, index, idPrefix = 'snapshot') {
  const parts = parsePriceParts(o.priceDetail || '');
  const headline = parts[0] || null;
  const perUnit = parts.find((p) => /unit|btl|bottle|can|piece|jar/.test(p.basis));
  const pack = packSize(o.priceDetail, o.spec);
  const { name, variants } = splitVariants(o.name, o.variants);
  return deriveExtras({
    moq: '', leadTime: '', bbd: '', note: '', offerDate: '', expiryDate: '',
    volumeMl: null, pack: null, unitType: '', warehouse: '', incoterm: '',
    moqType: '', moqQty: null, moqCurrency: '', moqSource: '', mixedLoad: false,
    leadTimeDays: null,
    ...o,
    id: o.id || `${idPrefix}-${index}`,
    name,
    variants,
    amount: headline ? headline.amount : o.amount,
    unitAmount: perUnit ? perUnit.amount
      : headline && /case|pack/.test(headline.basis)
        ? (pack ? +(headline.amount / pack).toFixed(4) : headline.amount)
        : headline ? headline.amount
        : o.amount,
    priceBasis: headline ? (headline.basis || '') : (o.priceBasis || ''),
    qty: typeof o.qty === 'number' ? Math.round(o.qty) : o.qty,
  });
}

// Older snapshots predate the delisted archive — `|| []` keeps them building.
function snapshotDelisted() {
  return (snapshot.delisted || []).map((o, i) => ({
    ...renormalizeSnapshotOffer(o, i, 'snapshot-delisted'),
    delisted: true,
  }));
}

export async function getOffers() {
  if (TOKEN) {
    try {
      const offers = await fetchLive();
      if (offers.length) {
        console.log(`[airtable] fetched ${offers.length} live public offers`);
        // Sold-out pages are an SEO nicety — if only this fetch fails, fall
        // back to the snapshot's archive rather than failing a live build.
        let delisted;
        try {
          delisted = await fetchDelisted();
          console.log(`[airtable] fetched ${delisted.length} delisted (sold-out) offers`);
        } catch (err) {
          console.warn(`[airtable] delisted fetch failed (${err.message.slice(0, 120)}) — using snapshot archive`);
          delisted = snapshotDelisted();
        }
        return { offers, delisted, source: 'live' };
      }
      console.warn('[airtable] live fetch returned 0 rows — using snapshot');
    } catch (err) {
      console.warn(`[airtable] live fetch failed (${err.message.slice(0, 120)}) — using snapshot`);
    }
  } else {
    console.warn('[airtable] no AIRTABLE_TOKEN set — using snapshot');
  }
  return {
    offers: snapshot.offers.map((o, i) => renormalizeSnapshotOffer(o, i)),
    delisted: snapshotDelisted(),
    source: 'snapshot',
  };
}

// Featured offers are flagged per-record by the `Featured` field and rendered
// from the main catalogue query (see index.astro). A separate Airtable query
// for them existed here and was never imported — removed to keep one source
// of truth for what the page shows.

// ---------------------------------------------------------------------------
// Site stats
//
// Headline figures the homepage ticker shows next to the offer count — today
// just `stock_value_eur`, the EUR value of listed stock. The number is computed
// and banded upstream (n8n → Airtable "Site Stats"); the site's only job is to
// read one string per key and print it verbatim.
//
// Rules, from the brief that introduced it:
//   - Render `Display Value` exactly as stored. "Over €60 million" is a floor
//     (roughly half the public lines carry no quantity), so the wording is
//     doing real work and must never be reformatted into a precise figure.
//   - Honour `Publish`. Unticked in Airtable → the key is simply absent.
//   - Fail to nothing, never to a number. Unreachable table, missing row or
//     empty value → absent, and the build still succeeds. No fallback figure.
//   - Only STATS_FIELDS are requested; the internal columns never reach here.
// ---------------------------------------------------------------------------

// Maps Site Stats rows to { statKey: displayString }. Only published rows with
// a non-empty Display Value make it in. First row wins on a duplicate key.
export function statsFromRecords(records = []) {
  const out = {};
  for (const rec of Array.isArray(records) ? records : []) {
    const f = (rec && rec.fields) || {};
    const key = String(f['Stat Key'] ?? '').trim();
    const value = String(f['Display Value'] ?? '').trim();
    if (!key || !value || f['Publish'] !== true) continue;
    if (key in out) {
      console.warn(`[airtable] duplicate site stat "${key}" — keeping the first row`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

async function fetchStatsLive() {
  const base = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(STATS_TABLE)}`;
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const records = [];
  let offset;
  do {
    const url = new URL(base);
    // Server-side gate on the checkbox; statsFromRecords() re-checks it so a
    // formula typo can never publish an unticked row.
    url.searchParams.set('filterByFormula', '{Publish}=TRUE()');
    url.searchParams.set('pageSize', '100');
    STATS_FIELDS.forEach((f) => url.searchParams.append('fields[]', f));
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetchWithRetry(url, { headers });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return statsFromRecords(records);
}

// The snapshot is baked by `npm run sync-offers`; older snapshots have no
// `stats` key at all. Only string values pass, whatever the file says.
export function snapshotStats() {
  const s = snapshot.stats;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
  return Object.fromEntries(
    Object.entries(s).filter(([k, v]) => k && typeof v === 'string' && v.trim()),
  );
}

/**
 * What `npm run sync-offers` should bake into the snapshot.
 *
 * A SUCCESSFUL read always wins, including an empty one — that is how the
 * Publish checkbox works as a kill switch: untick it, the next refresh bakes a
 * map without the key, and the figure leaves the site.
 *
 * A FAILED read (source 'none') keeps whatever the snapshot already carried.
 * Airtable answers 429 often enough that a five-minute refresh will eventually
 * hit one, and blanking a published figure because of a transient error would
 * drop it off the homepage for a cycle. This is the same instinct as the guard
 * in fetch-offers.mjs, which refuses to overwrite the catalogue when the live
 * offers fetch fails. It is a bake-time rule only: the RENDER path
 * (getSiteStats above, called during an Astro build) still fails to nothing.
 */
export function statsForSnapshot({ stats, source } = {}, previous = snapshotStats()) {
  if (source === 'none') {
    const kept = Object.keys(previous || {}).length;
    console.warn(`[airtable] site stats unavailable — keeping the ${kept} stat(s) already in the snapshot`);
    return previous || {};
  }
  return stats || {};
}

export async function getSiteStats() {
  if (!TOKEN) {
    console.warn('[airtable] no AIRTABLE_TOKEN set — site stats from snapshot');
    return { stats: snapshotStats(), source: 'snapshot' };
  }
  try {
    const stats = await fetchStatsLive();
    console.log(`[airtable] fetched ${Object.keys(stats).length} published site stat(s)`);
    return { stats, source: 'live' };
  } catch (err) {
    // A missing stat is invisible; a wrong one is a commercial problem. So no
    // stale figure, no placeholder, and no failed build.
    console.warn(`[airtable] site stats fetch failed (${err.message.slice(0, 120)}) — publishing none`);
    return { stats: {}, source: 'none' };
  }
}
