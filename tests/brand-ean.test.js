// node tests/brand-ean.test.js
//
// Brand-spelling merge (src/lib/brand.mjs) and barcode lookup (src/lib/ean.mjs).
// Every case runs over rows written inline below, never the live snapshot, so
// a catalogue refresh cannot turn this red (see the snapshot-safe-tests skill).
import assert from 'node:assert/strict';
import { brandSpellings, withCanonicalBrands } from '../src/lib/brand.mjs';
import { eanKey, eanQuery, matchesEan } from '../src/lib/ean.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; };

// ---- brand merge -----------------------------------------------------------
t('case variants merge onto the most common spelling', () => {
  const rows = [{ brand: 'NIVEA' }, { brand: 'NIVEA' }, { brand: 'Nivea' }];
  assert.deepEqual(withCanonicalBrands(rows).map((o) => o.brand), ['NIVEA', 'NIVEA', 'NIVEA']);
});

t('on a tie, mixed case beats all caps', () => {
  const rows = [{ brand: 'DOVE' }, { brand: 'Dove' }];
  assert.equal(brandSpellings(rows).get('dove'), 'Dove');
});

t('the result does not depend on row order', () => {
  const a = [{ brand: 'Lu' }, { brand: 'LU' }];
  assert.equal(brandSpellings(a).get('lu'), brandSpellings([...a].reverse()).get('lu'));
});

t('only case is folded — different names stay different', () => {
  const rows = [{ brand: 'Procter & Gamble' }, { brand: 'P&G' }];
  assert.deepEqual(withCanonicalBrands(rows).map((o) => o.brand), ['Procter & Gamble', 'P&G']);
});

t('spelling is chosen across several lists (live + delisted)', () => {
  const live = [{ brand: 'Kinder' }];
  const gone = [{ brand: 'KINDER' }, { brand: 'KINDER' }];
  const canon = brandSpellings(live, gone);
  assert.equal(withCanonicalBrands(live, canon)[0].brand, 'KINDER');
});

t('rows without a brand pass through untouched', () => {
  const rows = [{ brand: '' }, { name: 'x' }];
  assert.deepEqual(withCanonicalBrands(rows), rows);
});

t('unchanged rows are not copied', () => {
  const row = { brand: 'Guinness' };
  assert.equal(withCanonicalBrands([row])[0], row);
});

// ---- barcode lookup ----------------------------------------------------------
t('a query of barcodes is a barcode query', () => {
  assert.deepEqual([...eanQuery('5010327253749')], ['5010327253749']);
  assert.deepEqual([...eanQuery('5010327253749, 85925052\n8445291515239')].sort(),
    ['5010327253749', '8445291515239', '85925052'].sort());
});

t('anything with words in it is a text query', () => {
  assert.equal(eanQuery('jameson 70cl'), null);
  assert.equal(eanQuery('5010327253749 jameson'), null);
  assert.equal(eanQuery('70'), null);      // a size, not a barcode
  assert.equal(eanQuery(''), null);
});

t('leading zeros do not stop a UPC matching its EAN-13 form', () => {
  assert.equal(eanKey('0012345678905'), eanKey('12345678905'));
});

t('matches on the unit or the case barcode, exactly', () => {
  const o = { ean: '5010327253749', eanCase: '15010327253746' };
  assert.equal(matchesEan(o, eanQuery('5010327253749')), true);
  assert.equal(matchesEan(o, eanQuery('15010327253746')), true);
  assert.equal(matchesEan(o, eanQuery('5010327253748')), false); // one digit off is another product
  assert.equal(matchesEan({ ean: '', eanCase: '' }, eanQuery('5010327253749')), false);
});

console.log(`brand-ean: ${n} passed`);
