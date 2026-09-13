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

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.Airtable_Pat || '';
const BASE = process.env.AIRTABLE_BASE_ID || 'appaDSdZkAE9PGkjT';
const TABLE = process.env.AIRTABLE_OFFERS_TABLE || 'Offers';

// Public-safe fields only. Anything not listed here is never pulled.
const FIELDS = [
  'Public Product Description', 'Variant', 'Brand', 'Category', 'Public Spec',
  'Price Display', 'Currency', 'Price Type', 'Price Per Unit & Case', 'PCS/Case',
  'Volume ML', 'Unit Type',
  'Stock Display', 'Stock Cases', 'Public Terms', 'Warehouse', 'Incoterm',
  'Bond/Customs Status', 'Origin Country', 'Public Listing', 'Featured',
  'MOQ', 'Lead Time', 'BBD', 'Public Note', 'Offer Date', 'Auto Expiry Date',
];

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
];
export const FORBIDDEN_PATTERN = /supplier|buy|cost|markup|margin|trader|vendor|contact|internal|source|bundle|target|excluded|trust|\bnotes?\b|comparable|feedback|broadcast/i;
// Public-by-design names the pattern would otherwise trip on: the Airtable
// field "Public Note" and the `note` key it becomes in the search index.
const PATTERN_EXCEPTIONS = new Set(['Public Note', 'note']);

export function isForbiddenField(name) {
  if (FORBIDDEN_FIELDS.includes(name)) return true;
  if (PATTERN_EXCEPTIONS.has(name)) return false;
  return FORBIDDEN_PATTERN.test(name);
}

for (const f of FIELDS) {
  if (isForbiddenField(f)) throw new Error(`[airtable] FIELDS contains a non-public field: "${f}"`);
}

// The catalogue moved to the apex domain, but Public Notes written before the
// move still send buyers to offers.akay.ie. That host only 301s here, and in a
// note it reads as a separate site, so it is rewritten on read — live rows and
// the committed snapshot alike. akay.ie is the one name the site shows.
const LEGACY_HOST = /(https?:\/\/)?(?:www\.)?\boffers\.akay\.ie/gi;

export function publicNote(text = '') {
  return String(text).replace(LEGACY_HOST, (_m, scheme) => `${scheme || ''}akay.ie`);
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
    warehouse: fields['Warehouse'] && fields['Warehouse'] !== 'Other' ? fields['Warehouse'] : '',
    incoterm: fields['Incoterm'] && fields['Incoterm'] !== 'Other' ? fields['Incoterm'] : '',
    moq: fields['MOQ'] || '',
    leadTime: fields['Lead Time'] || '',
    bbd: fields['BBD'] || '',
    note: publicNote(fields['Public Note'] || ''),
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

async function fetchLive() {
  const base = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`;
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const out = [];
  let offset;
  do {
    const url = new URL(base);
    url.searchParams.set('filterByFormula', "{Public Listing}='Yes'");
    url.searchParams.set('pageSize', '100');
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
  } while (offset);
  return out;
}

// The committed snapshot was baked by an earlier version of normalize(), and a
// fresh deploy serves it until the next refresh runs. Applying the same
// corrections on read keeps both paths — live and snapshot — showing identical
// figures, so a fallback build can never resurrect the old per-unit/per-case mix-up.
function renormalizeSnapshotOffer(o, index) {
  const parts = parsePriceParts(o.priceDetail || '');
  const headline = parts[0] || null;
  const perUnit = parts.find((p) => /unit|btl|bottle|can|piece|jar/.test(p.basis));
  const pack = packSize(o.priceDetail, o.spec);
  const { name, variants } = splitVariants(o.name, o.variants);
  return deriveExtras({
    moq: '', leadTime: '', bbd: '', note: '', offerDate: '', expiryDate: '',
    volumeMl: null, pack: null, unitType: '', warehouse: '', incoterm: '',
    ...o,
    id: o.id || `snapshot-${index}`,
    name,
    variants,
    amount: headline ? headline.amount : o.amount,
    unitAmount: perUnit ? perUnit.amount
      : headline && /case|pack/.test(headline.basis)
        ? (pack ? +(headline.amount / pack).toFixed(4) : headline.amount)
        : headline ? headline.amount
        : o.amount,
    priceBasis: headline ? (headline.basis || '') : (o.priceBasis || ''),
    note: publicNote(o.note || ''),
    qty: typeof o.qty === 'number' ? Math.round(o.qty) : o.qty,
  });
}

export async function getOffers() {
  if (TOKEN) {
    try {
      const offers = await fetchLive();
      if (offers.length) {
        console.log(`[airtable] fetched ${offers.length} live public offers`);
        return { offers, source: 'live' };
      }
      console.warn('[airtable] live fetch returned 0 rows — using snapshot');
    } catch (err) {
      console.warn(`[airtable] live fetch failed (${err.message.slice(0, 120)}) — using snapshot`);
    }
  } else {
    console.warn('[airtable] no AIRTABLE_TOKEN set — using snapshot');
  }
  return { offers: snapshot.offers.map((o, i) => renormalizeSnapshotOffer(o, i)), source: 'snapshot' };
}

// Featured offers are flagged per-record by the `Featured` field and rendered
// from the main catalogue query (see index.astro). A separate Airtable query
// for them existed here and was never imported — removed to keep one source
// of truth for what the page shows.
