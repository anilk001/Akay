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

// Phase 3 of the Airtable migration. OFFERS_SOURCE=postgres makes getOffers()
// read the akay.offers replica instead of Airtable. Unset (or anything else)
// keeps the Airtable path, so this ships inert and the rollback is one env var.
// DATABASE_URL must be a READ-ONLY role: readonly_site, never n8n_app.
const OFFERS_SOURCE = (process.env.OFFERS_SOURCE || 'airtable').toLowerCase();
const PG_URL = process.env.DATABASE_URL || '';
// Optional PEM for providers that use their own CA (Supabase does). Supplying
// it keeps verification ON; the alternative people reach for - disabling
// rejectUnauthorized - is what the 2026-09-23 review flagged as a leak vector.
const PG_CA = process.env.DATABASE_CA_CERT || '';

// Public-safe fields only. Anything not listed here is never pulled.
// Exported ONLY so tests/offers-pg-allowlist.test.js can assert that the
// Airtable and Postgres allowlists describe the same catalogue. Nothing at
// runtime should import this - use FIELDS.
export const FIELDS_FOR_TEST = [];

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
// Widened 2026-09-23 for the Postgres source. The Airtable half of the guard
// was closed by construction - an unlisted field is never requested, and the
// name space is the curated Airtable schema. A replica's column names are not
// curated, so the pattern has to anticipate the shapes a buy price or a
// customer identifier could plausibly arrive under: purchase_price,
// landed_price, remarks, raw_message, email, phone, payment_terms, created_by.
export const FORBIDDEN_PATTERN = /supplier|buy|cost|markup|margin|trader|vendor|contact|internal|source|bundle|target|excluded|trust|\bnotes?\b|comparable|feedback|broadcast|purchase|landed|comment|remark|message|whatsapp|\bwa\b|email|phone|payment.?terms|created.?by/i;
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
  FIELDS_FOR_TEST.push(f);
}
for (const f of STATS_FIELDS) {
  if (isForbiddenField(f)) throw new Error(`[airtable] STATS_FIELDS contains a non-public field: "${f}"`);
}

// ---------------------------------------------------------------------------
// Postgres source (Phase 3 of the Airtable migration).
//
// akay.offers is a replica of the Airtable Offers table, synced hourly. This
// path reads it INSTEAD of Airtable when OFFERS_SOURCE=postgres - through
// akay.offers_public (migration 008), which is the only object the site's role
// can see. Everything
// downstream is untouched: the query aliases every column back to its exact
// Airtable field name, so normalize() and deriveExtras() cannot tell the
// difference, and the snapshot shape does not change.
//
// THE SAFETY PROBLEM THIS SOLVES, stated plainly. Today the guard is that a
// field never REQUESTED from Airtable cannot leak. akay.offers holds more than
// that fetch ever pulled - buy_price, margin_pct, supplier_name, supplier_email,
// supplier_payment_terms, trader_comment, notes. A `select *` here would put
// buy prices and supplier identity straight into the snapshot, and the snapshot
// is committed to a PUBLIC repo.
//
// So PG_FIELDS below is the same kind of allowlist as FIELDS, built from the
// same names, and checked by the same isForbiddenField() at module load. A
// column that is not in this list is never selected.
export const PG_FIELDS = [
  ['Public Product Description', 'o.public_product_description', 'text'],
  ['Variant',                    'o.variant',                    'text'],
  ['Brand',                      'o.brand',                      'text'],
  ['Category',                   'o.category',                   'text'],
  ['Public Spec',                'o.public_spec',                'text'],
  ['Price Display',              'o.price_display',              'text'],
  ['Currency',                   'o.currency',                   'text'],
  ['Price Type',                 'o.price_type',                 'text'],
  ['Price Per Unit & Case',      'o.price_per_unit_and_case',    'text'],
  ['PCS/Case',                   'o.pcs_case',                   'num'],
  ['Volume ML',                  'o.volume_ml',                  'num'],
  ['Unit Type',                  'o.unit_type',                  'text'],
  ['Stock Display',              'o.stock_display',              'text'],
  ['Stock Cases',                'o.stock_cases',                'num'],
  ['Public Terms',               'o.public_terms',               'text'],
  ['Warehouse',                  'o.warehouse',                  'text'],
  ['Incoterm',                   'o.incoterm',                   'text'],
  ['Bond/Customs Status',        'o.bond_customs_status',        'text'],
  ['Origin Country',             'o.origin_country',             'text'],
  // The only one that comes from the view rather than the table: it reads
  // dublin_today(), so it cannot be a generated column.
  ['Public Listing',             'c.public_listing',             'text'],
  ['Featured',                   'o.featured',                   'bool'],
  ['EAN Unit',                   'o.ean_unit',                   'text'],
  ['EAN Case',                   'o.ean_case',                   'text'],
  ['MOQ',                        'o.moq',                        'text'],
  ['Lead Time',                  'o.lead_time',                  'text'],
  ['BBD',                        'o.bbd',                        'date'],
  ['Public Note',                'o.public_note',                'text'],
  ['Offer Date',                 'o.offer_date',                 'date'],
  ['Auto Expiry Date',           'o.auto_expiry_date',           'date'],
  ['MOQ Type',                   'o.moq_type',                   'text'],
  ['MOQ Qty',                    'o.moq_qty',                    'num'],
  ['MOQ Currency',               'o.moq_currency',               'text'],
  ['MOQ Source',                 'o.moq_source',                 'text'],
  ['Mixed Load Allowed',         'o.mixed_load_allowed',         'bool'],
  ['Lead Time Days',             'o.lead_time_days',             'num'],
];

// Same guard as FIELDS, and one more: the two lists must agree. If someone adds
// a field to FIELDS and forgets the Postgres column, the two sources would bake
// different snapshots depending on which one ran - the worst kind of drift,
// because both builds go green.
// The column is checked as well as the field name, because the dangerous
// mistake here is not a bad field name - it is an allowed field name pointed at
// the wrong column, e.g. ['Price Display', 'o.buy_price']. That would pass a
// name-only check and put cost into a public snapshot.
//
// FORBIDDEN_PATTERN is written for Airtable field names, so the column is
// turned back into that shape first ('o.moq_source' -> 'moq source'). The same
// PATTERN_EXCEPTIONS apply, keyed on the field name: "MOQ Source" records which
// tier of the cascade supplied a minimum, not who the supplier is.
// FORBIDDEN_FIELDS as column names, so the list half of the guard works on
// snake_case too. This is not redundant with the pattern: "Price Delta %" ->
// price_delta_pct contains none of the pattern's words, so the pattern alone
// waves it through. The test caught exactly that.
const FORBIDDEN_COLUMNS = new Set(FORBIDDEN_FIELDS.map((f) => f
  .replace(/&/g, 'and').replace(/%/g, 'pct').replace(/\//g, '_')
  .replace(/[^0-9A-Za-z]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_')
  .toLowerCase()));

// Airtable field name -> the snake_case column it is allowed to map to.
const snakeColumn = (f) => f
  .replace(/&/g, 'and').replace(/%/g, 'pct').replace(/\//g, '_')
  .replace(/[^0-9A-Za-z]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_')
  .toLowerCase();

export function isForbiddenColumn(column, fieldName) {
  const bare = column.replace(/^[a-z]+\./, '');
  // The exact-list check runs FIRST and is never skipped. An earlier version
  // returned false for a PATTERN_EXCEPTIONS field before checking anything,
  // which meant ['Public Note', 'o.buy_price'] passed every guard and would
  // have published buy prices into the search index and the public snapshot.
  // isForbiddenField has always had this ordering right; the column version
  // inverted it.
  if (FORBIDDEN_COLUMNS.has(bare)) return true;
  // An exception excuses a field from the PATTERN only, and only for its own
  // column. "MOQ Source" may map to moq_source and to nothing else.
  if (PATTERN_EXCEPTIONS.has(fieldName)) return bare !== snakeColumn(fieldName);
  return FORBIDDEN_PATTERN.test(bare.replace(/_/g, ' '));
}

for (const [name, column] of PG_FIELDS) {
  // Only the two aliases in the FROM clause. isForbiddenColumn strips the
  // alias before testing, so a column from some future joined table - say
  // ['Brand', 's.name'] off a suppliers join - would reduce to "name" and
  // sail through. The guard is only ever as strong as a fixed FROM clause.
  if (!/^[oc]\.[a-z_]+$/.test(column)) throw new Error(`[pg] PG_FIELDS column must be o.<col> or c.<col>: "${column}"`);
  if (isForbiddenField(name)) throw new Error(`[pg] PG_FIELDS contains a non-public field: "${name}"`);
  if (isForbiddenColumn(column, name)) throw new Error(`[pg] PG_FIELDS maps to a non-public column: "${column}" (for "${name}")`);
}
{
  const a = new Set(FIELDS);
  const b = new Set(PG_FIELDS.map(([n]) => n));
  const missing = [...a].filter((n) => !b.has(n));
  const extra = [...b].filter((n) => !a.has(n));
  if (missing.length) throw new Error(`[pg] PG_FIELDS is missing: ${missing.join(', ')}`);
  if (extra.length) throw new Error(`[pg] PG_FIELDS has fields FIELDS does not: ${extra.join(', ')}`);
}

// PG_FIELDS records where each value really LIVES (o.* on the table, c.* in
// the computed view) because that is what generates migration 008. The query
// reads the view, where every column is already flattened to its bare name, so
// the alias is stripped here. One list, two consumers, no hand-maintained copy.
const bareColumn = (col) => col.replace(/^[a-z]+\./, '');
const PG_SELECT = PG_FIELDS.map(([name, col]) => `${bareColumn(col)} as ${JSON.stringify(name)}`).join(',\n       ');

// pg returns numeric as a STRING and date as a JS Date; Airtable returns a
// number and a 'YYYY-MM-DD' string. Coerce, or the two sources bake different
// snapshots from identical data. Airtable also OMITS an empty field and an
// unticked checkbox rather than sending null/false, so this drops them too -
// normalize() is written against that shape.
function pgFields(row) {
  const out = {};
  for (const [name, , type] of PG_FIELDS) {
    const v = row[name];
    if (v === null || v === undefined || v === '') continue;
    if (type === 'num') {
      const n = Number(v);
      if (Number.isFinite(n)) out[name] = n;
    } else if (type === 'date') {
      out[name] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    } else if (type === 'bool') {
      if (v === true) out[name] = true;          // Airtable omits an unticked box
    } else {
      out[name] = String(v);
    }
  }
  return out;
}

// The two WHERE clauses, frozen at module scope. pgQuery takes a KEY, not a
// string, so no caller can ever thread a filter into the SQL: client.query()
// without a values array issues a simple query, which permits multiple
// statements separated by ';'. There is no injection surface today and this
// keeps it that way by construction rather than by convention.
const PG_WHERE = {
  live: { where: `public_listing = 'Yes'` },
  delisted: {
    where: `status in ('Sold', 'Expired') and offer_approval_status = 'Approved' and listing_approved`,
    order: 'offer_date desc nulls last, airtable_id collate "C"',
  },
};

async function pgQuery(key, { limit = null } = {}) {
  const spec = PG_WHERE[key];
  if (!spec) throw new Error(`[pg] unknown query "${key}"`);
  const { where, order = '' } = spec;
  const { default: pg } = await import('pg');
  // pg parses a DATE column into a JS Date at LOCAL midnight, so in Dublin
  // (UTC+1 in summer) 2026-09-23 becomes 2026-09-22T23:00:00Z and
  // toISOString().slice(0,10) yields the day BEFORE. Every BBD, Offer Date and
  // Auto Expiry Date would shift back one day - invisible on a UTC GitHub
  // runner, wrong on a laptop. Keep the wire format, which is already exactly
  // Airtable's 'YYYY-MM-DD'.
  pg.types.setTypeParser(1082, (v) => v);
  const client = new pg.Client({
    connectionString: PG_URL,
    // pg defaults BOTH of these to 0, meaning "wait forever". A pooler that
    // accepts the TCP connection and then stalls - a wrong SSL mode, a
    // tenant-qualified username the pooler will not route, a paused project -
    // leaves connect() hanging with no error until the CI job's own timeout
    // kills it 20 minutes later, and the log says nothing about why. Fail fast
    // and say so instead.
    connectionTimeoutMillis: 15000,
    query_timeout: 120000,
    // Verify the server. With this off, anyone on the runner->DB path can both
    // harvest the role credentials from the startup packet and serve arbitrary
    // rows, which this code bakes straight into a public snapshot.
    //
    // DATABASE_CA_CERT is optional and exists because Supabase serves its
    // database endpoints from its OWN certificate authority, which is not in
    // Node's built-in CA list. Without the CA, verification fails outright
    // (SELF_SIGNED_CERT_IN_CHAIN / UNABLE_TO_VERIFY_LEAF_SIGNATURE). The fix
    // is to supply the CA, never to turn verification off - Supabase publishes
    // it as "Download certificate" on the Database Settings page.
    ssl: PG_CA
      ? { rejectUnauthorized: true, ca: PG_CA }
      : { rejectUnauthorized: true },
    statement_timeout: 60000,
  });
  try {
    await client.connect();
  } catch (err) {
    // Name the likely cause rather than surfacing a bare ETIMEDOUT. These are
    // the three that actually happen with Supabase's shared pooler.
    const hint = /timeout/i.test(err.message)
      ? ' — connect timed out. Check the host is the SESSION pooler (port 5432, not 6543) and the username is role.projectref, not just the role.'
      : /self.signed|unable to verify|certificate/i.test(err.message)
        ? ' — certificate could not be verified. Supply the provider CA as DATABASE_CA_CERT; do NOT disable verification.'
        : /password|authentication|role .* does not exist/i.test(err.message)
          ? ' — the pooler rejected the credentials. On Supabase the username must be role.projectref.'
          : '';
    throw new Error(`[pg] connect failed: ${err.message}${hint}`);
  }
  try {
    // akay.offers_public, NEVER akay.offers. Migration 008 revoked this role's
    // SELECT on the base table, so a `select *` here could not reach a buy
    // price even if the allowlist above were wrong - which, on 2026-09-23, it
    // twice was. The view is the guard; the allowlist is now the second layer.
    const sql = `select airtable_id as "__id",\n       ${PG_SELECT}\nfrom akay.offers_public\nwhere ${where}${order ? `\norder by ${order}` : ''}${limit ? `\nlimit ${Number(limit)}` : ''}`;
    const { rows } = await client.query(sql);
    const out = [];
    for (const r of rows) {
      const o = deriveExtras(normalize(pgFields(r), r.__id));
      if (o.name && !isTestRow(o.name)) out.push(o);
    }
    return out;
  } finally {
    await client.end();
  }
}

// The two fetches, mirroring fetchLive() and fetchDelisted() exactly.
// The join to akay.offers_computed also inherits its soft-delete filter
// (migration 005), so an offer deleted in Airtable drops off the site.
function fetchLivePg() {
  return pgQuery('live');
}

function fetchDelistedPg() {
  return pgQuery('delisted', { limit: DELISTED_CAP })
    .then((rows) => rows.map((o) => ({ ...o, delisted: true })));
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
  // Phase 3: read the Postgres replica instead of Airtable. Deliberately the
  // FIRST branch and deliberately not silent-on-failure in the same way the
  // Airtable path is: if the site is meant to be reading Postgres and cannot,
  // falling through to Airtable would hide the outage behind a working build.
  // It falls back to the SNAPSHOT, which is the same last-known-good the
  // Airtable path uses, and says so loudly.
  if (OFFERS_SOURCE === 'postgres') {
    if (!PG_URL) {
      console.warn('[pg] OFFERS_SOURCE=postgres but DATABASE_URL is not set — using snapshot');
    } else {
      try {
        const offers = await fetchLivePg();
        if (offers.length) {
          console.log(`[pg] fetched ${offers.length} live public offers from akay.offers`);
          let delisted;
          try {
            delisted = await fetchDelistedPg();
            console.log(`[pg] fetched ${delisted.length} delisted (sold-out) offers`);
          } catch (err) {
            console.warn(`[pg] delisted fetch failed (${err.message.slice(0, 120)}) — using snapshot archive`);
            delisted = snapshotDelisted();
          }
          return { offers, delisted, source: 'postgres' };
        }
        console.warn('[pg] live fetch returned 0 rows — using snapshot');
      } catch (err) {
        console.warn(`[pg] live fetch failed (${err.message.slice(0, 120)}) — using snapshot`);
      }
    }
    return {
      offers: snapshot.offers.map((o, i) => renormalizeSnapshotOffer(o, i)),
      delisted: snapshotDelisted(),
      source: 'snapshot',
    };
  }

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
