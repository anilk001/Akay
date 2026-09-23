// node tests/offers-pg-allowlist.test.js
//
// The Postgres source reads akay.offers, which holds MORE than the Airtable
// fetch ever pulled: buy_price, margin_pct, supplier_name, supplier_email,
// supplier_payment_terms, trader_comment, notes. The snapshot it bakes is
// committed to a PUBLIC repo, so the column allowlist is the guard and this
// test is what stops it rotting.
//
// The dangerous mistake is not a bad field NAME - the existing guard catches
// those. It is an allowed name pointed at the wrong COLUMN, e.g.
// ['Price Display', 'o.buy_price'], which a name-only check waves through.
//
// Nothing here reads the catalogue, so a refresh can never break it.
import assert from 'node:assert/strict';
import { PG_FIELDS, FIELDS_FOR_TEST, isForbiddenField, isForbiddenColumn } from '../src/data/airtable.mjs';

// 1. Every mapped field name is public.
for (const [name] of PG_FIELDS) {
  assert.equal(isForbiddenField(name), false, `PG_FIELDS contains a non-public field: "${name}"`);
}

// 2. Every mapped column is public.
for (const [name, column] of PG_FIELDS) {
  assert.equal(isForbiddenColumn(column, name), false, `PG_FIELDS maps to a non-public column: "${column}"`);
}

// 3. The column guard actually bites. Each of these is an ALLOWED field name
//    pointed at a forbidden column - the exact shape of the mistake.
for (const col of [
  'o.buy_price', 'o.margin_pct', 'o.supplier_name', 'o.supplier_email',
  'o.supplier_payment_terms', 'o.trader_comment', 'o.notes', 'o.source_sheet',
  'o.best_comparable_price', 'o.price_delta_pct', 'o.trust_level',
  'o.target_countries', 'o.excluded_countries', 'o.bundle_id',
]) {
  assert.equal(
    isForbiddenColumn(col, 'Price Display'), true,
    `column guard misses "${col}" - a public field name could be pointed at it`,
  );
}

// 4. MOQ Source is the one deliberate exception: it records which tier of the
//    cascade supplied a minimum (Supplier Stated / Parsed From Text / ...),
//    not who the supplier is. It must stay allowed under its own name and
//    forbidden under any other.
assert.equal(isForbiddenColumn('o.moq_source', 'MOQ Source'), false, 'MOQ Source must stay allowed');
assert.equal(isForbiddenColumn('o.moq_source', 'Price Display'), true, 'moq_source must be forbidden for any other field');

// 5. No duplicates, and no column selected twice under two names.
const names = PG_FIELDS.map(([n]) => n);
const cols = PG_FIELDS.map(([, c]) => c);
assert.equal(new Set(names).size, names.length, 'PG_FIELDS has a duplicate field name');
assert.equal(new Set(cols).size, cols.length, 'PG_FIELDS selects the same column twice');

// 6. Only the three types the row mapper knows how to coerce. pg returns
//    numeric as a string and date as a Date; an unhandled type would ship a
//    different snapshot from the Airtable path on identical data.
for (const [name, , type] of PG_FIELDS) {
  assert.ok(['text', 'num', 'date', 'bool'].includes(type), `PG_FIELDS has an unknown type "${type}" for "${name}"`);
}

// 7. The two allowlists must describe the same catalogue. If they drift, the
//    snapshot depends on which source ran - and both builds go green.
assert.deepEqual(
  [...FIELDS_FOR_TEST].sort(), [...names].sort(),
  'FIELDS and PG_FIELDS disagree: the two sources would bake different snapshots',
);

console.log(`offers-pg-allowlist: ${PG_FIELDS.length} columns allowed, 14 forbidden columns rejected, FIELDS in sync`);
