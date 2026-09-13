// node tests/public-keys.test.js
// The search-index allowlist must be accepted by the forbidden-field guard
// regardless of which keys the current data happens to populate. A blank
// snapshot once hid that `note` tripped the /\bnotes?\b/ pattern, so the
// build only failed on Netlify where live rows carry a Public Note.
import assert from 'node:assert/strict';
import { PUBLIC_KEYS } from '../src/lib/search-index-keys.mjs';
import { isForbiddenField, FORBIDDEN_FIELDS, publicNote } from '../src/data/airtable.mjs';

for (const k of PUBLIC_KEYS) {
  assert.equal(isForbiddenField(k), false, `PUBLIC_KEYS contains a key the guard rejects: "${k}"`);
}
for (const f of FORBIDDEN_FIELDS) {
  assert.equal(isForbiddenField(f), true, `guard misses forbidden field "${f}"`);
}
for (const f of ['buyPrice', 'Cost', 'Supplier Name', 'Delivery Notes', 'Notes', 'Contact Email', 'Internal Ref']) {
  assert.equal(isForbiddenField(f), true, `guard misses "${f}"`);
}
for (const f of ['Public Note', 'Public Spec', 'Warehouse', 'Volume ML', 'Price Type', 'Featured']) {
  assert.equal(isForbiddenField(f), false, `guard wrongly rejects public field "${f}"`);
}
// One name on the site: notes must never advertise the pre-migration host.
assert.equal(
  publicNote('Browse more offers at offers.akay.ie, updated daily.'),
  'Browse more offers at akay.ie, updated daily.',
);
assert.equal(publicNote('See https://offers.akay.ie/category/beer/'), 'See https://akay.ie/category/beer/');
assert.equal(publicNote('See http://www.offers.akay.ie'), 'See http://akay.ie');
assert.equal(publicNote('See OFFERS.AKAY.IE today'), 'See akay.ie today');
// Untouched: the current host, other text, and empty notes.
assert.equal(publicNote('Full range at akay.ie'), 'Full range at akay.ie');
assert.equal(publicNote('Email offers@akay.ie'), 'Email offers@akay.ie');
assert.equal(publicNote('Host myoffers.akay.ie stays'), 'Host myoffers.akay.ie stays');
assert.equal(publicNote(''), '');
assert.equal(publicNote(undefined), '');

console.log(`public-keys: ${PUBLIC_KEYS.length} keys accepted, ${FORBIDDEN_FIELDS.length} forbidden fields rejected, note host rewritten`);
