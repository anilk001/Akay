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
const FIELDS = [
  'Public Product Description', 'Brand', 'Category', 'Public Spec',
  'Price Display', 'Currency', 'Price Per Unit & Case',
  'Stock Display', 'Stock Cases', 'Public Terms',
  'Bond/Customs Status', 'Origin Country', 'Public Listing',
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

function isTestRow(name = '') {
  return /^testbrand|^testproduct/i.test(name.trim());
}

function normalize(fields) {
  const { currency, amount } = parseAmount(fields['Price Display'], fields['Currency']);
  return {
    name: fields['Public Product Description'] || '',
    brand: fields['Brand'] || '',
    category: fields['Category'] || 'Other',
    spec: fields['Public Spec'] || '',
    currency,
    amount,
    priceDetail: fields['Price Per Unit & Case'] || fields['Price Display'] || '',
    stock: stockCode(fields['Stock Display']),
    qty: typeof fields['Stock Cases'] === 'number' ? fields['Stock Cases'] : null,
    terms: fields['Public Terms'] || '',
    tier: fields['Bond/Customs Status'] || '',
    origin: fields['Origin Country'] || '',
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
      const o = normalize(rec.fields);
      if (o.name && !isTestRow(o.name)) out.push(o);
    }
    offset = data.offset;
  } while (offset);
  return out;
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
  return { offers: snapshot.offers, source: 'snapshot' };
}

// Featured offers — a second, isolated query over the SAME connection.
// Server-side filter: Featured checked AND publicly listed AND send-eligible.
// Reads only the public-safe display fields (same FIELDS list). Any failure
// (missing token, missing "Featured" field, network) returns [] so the main
// catalogue is never affected and the section simply hides when empty.
export async function getFeaturedOffers() {
  if (!TOKEN) return [];
  try {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`);
    url.searchParams.set('filterByFormula', "AND({Featured}=1,{Public Listing}='Yes',{Send Eligible}='Yes')");
    url.searchParams.set('pageSize', '50');
    FIELDS.forEach((f) => url.searchParams.append('fields[]', f));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${(await res.text()).slice(0, 100)}`);
    const data = await res.json();
    const out = data.records.map((r) => normalize(r.fields)).filter((o) => o.name && !isTestRow(o.name));
    console.log(`[airtable] fetched ${out.length} featured offers`);
    return out;
  } catch (err) {
    console.warn(`[airtable] featured fetch skipped (${err.message.slice(0, 100)})`);
    return [];
  }
}
