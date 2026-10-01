// node tests/brand-ean.test.js
//
// Brand-spelling merge (src/lib/brand.mjs) and barcode lookup (src/lib/ean.mjs).
// Every case runs over rows written inline below, never the live snapshot, so
// a catalogue refresh cannot turn this red (see the snapshot-safe-tests skill).
import assert from 'node:assert/strict';
import { brandSpellings, withCanonicalBrands, brandCount, cleanBrand } from '../src/lib/brand.mjs';
import { cleanProductName, splitVariants } from '../src/data/airtable.mjs';
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

// ---- brand count + bogus brands --------------------------------------------
t('brandCount ignores empty and whitespace-only brands', () => {
  const rows = [{ brand: 'Jameson' }, { brand: '' }, { brand: '   ' }, { brand: null }, {}, { brand: 'Absolut' }];
  assert.equal(brandCount(rows), 2);
});

t('brandCount counts case variants once and trims', () => {
  assert.equal(brandCount([{ brand: 'Nivea' }, { brand: 'NIVEA ' }, { brand: 'Dove' }]), 2);
  assert.equal(brandCount([]), 0);
  assert.equal(brandCount(undefined), 0);
});

t('a spelled-out number is not a brand; digits and real names are', () => {
  assert.equal(cleanBrand('two'), '');
  assert.equal(cleanBrand(' Three '), '');
  assert.equal(cleanBrand('1664'), '1664');
  assert.equal(cleanBrand('Two Fingers'), 'Two Fingers');
  assert.equal(cleanBrand(' Jameson '), 'Jameson');
  assert.equal(brandCount([{ brand: 'two' }, { brand: 'Jameson' }]), 1);
});

// ---- product-name clean-up (src/data/airtable.mjs) --------------------------
t('a trailing "Price:" or ":" label is removed from the name', () => {
  assert.equal(cleanProductName('Ballantines 1l x 6, RF, T2, coded 2380 crt Price:'), 'Ballantines 1l x 6, RF, T2, coded 2380 crt');
  assert.equal(cleanProductName('Jameson Original (12 × 35 CL):'), 'Jameson Original (12 × 35 CL)');
  assert.equal(cleanProductName('JW Red 1l x 12, t2, RF coded, 1364cs full load, Price:'), 'JW Red 1l x 12, t2, RF coded, 1364cs full load');
});

t('names without a trailing label are left alone', () => {
  assert.equal(cleanProductName('Best Price Cola 330ml'), 'Best Price Cola 330ml');
  assert.equal(cleanProductName('Stock Clearance: Haribo 160g'), 'Stock Clearance: Haribo 160g');
  assert.deepEqual(splitVariants('Nivea Roll On 50ml — Bright & Dry, Silk Touch, Pearl:'),
    { name: 'Nivea Roll On 50ml', variants: 'Bright & Dry, Silk Touch, Pearl' });
  assert.deepEqual(splitVariants('Absolut (24 × 20 CL):', 'Original'), { name: 'Absolut (24 × 20 CL)', variants: 'Original' });
});

console.log(`brand-ean: ${n} passed`);
