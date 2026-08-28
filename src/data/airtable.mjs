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

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.Airtable_Pat || '';
const BASE = process.env.AIRTABLE_BASE_ID || 'appaDSdZkAE9PGkjT';
const TABLE = process.env.AIRTABLE_OFFERS_TABLE || 'Offers';

// Public-safe fields only. Anything not listed here is never pulled.
//
// Every entry is on the brief's §0 safe list. Buy Price, Margin %, Notes,
// Trader Comment, Delivery Info Source and every Supplier lookup are absent by
// construction: Airtable returns only the fields asked for, so the private
// columns never enter the process, let alone the build output.
const FIELDS = [
  'Public Product Description', 'Variant', 'Brand', 'Category', 'Public Spec',
  'Price Display', 'Currency', 'Price Per Unit & Case', 'PCS/Case',
  'Stock Display', 'Stock Cases', 'Public Terms', 'Public Note',
  'Bond/Customs Status', 'Origin Country', 'Public Listing', 'Featured',
  // §5 logistics. Near-empty today (CBM and HS Code sit at 0%), so the UI
  // renders each row only when populated and collapses when none are — the
  // section ships dark and lights up per-offer as the backfill lands.
  'MOQ', 'Lead Time', 'Cases per Pallet', 'Pieces per Pallet',
  'Full Truckload Qty', 'Weight KG', 'CBM', 'HS Code', 'BBD',
  'EAN Unit', 'EAN Case', 'Incoterm', 'Warehouse',
];

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
    priceBasis: headline ? (headline.basis || '') : '',
    stock: stockCode(fields['Stock Display']),
    // Cases are whole units — a fractional count means units were entered as cases.
    qty: typeof rawQty === 'number' ? Math.round(rawQty) : null,
    terms: fields['Public Terms'] || '',
    tier: fields['Bond/Customs Status'] || '',
    origin: fields['Origin Country'] || '',
    featured: fields['Featured'] === true,
    publicNote: fields['Public Note'] || '',
    incoterm: fields['Incoterm'] || '',
    warehouse: fields['Warehouse'] || '',
    // §5 logistics. Left as '' rather than null when absent so the snapshot
    // round-trips to identical JSON and the refresh job's change detection
    // does not see churn on offers that gained nothing.
    moq: fields['MOQ'] || '',
    leadTime: fields['Lead Time'] || '',
    casesPerPallet: fields['Cases per Pallet'] ?? '',
    piecesPerPallet: fields['Pieces per Pallet'] ?? '',
    fullTruckload: fields['Full Truckload Qty'] ?? '',
    weightKg: fields['Weight KG'] ?? '',
    cbm: fields['CBM'] ?? '',
    hsCode: fields['HS Code'] || '',
    bbd: fields['BBD'] || '',
    eanUnit: fields['EAN Unit'] || '',
    eanCase: fields['EAN Case'] || '',
  };
}

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

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const rec of data.records) {
      const o = normalize(rec.fields, rec.id);
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
  return {
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
    qty: typeof o.qty === 'number' ? Math.round(o.qty) : o.qty,
  };
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
