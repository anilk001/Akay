// node tests/normalise.test.js
import assert from 'node:assert/strict';
import { normalise, parseVolumeMl, volumeLabel } from '../src/lib/normalise.mjs';

const cases = [
  ['Guinness Draught 24 x 440ml', 'guinness draught 24x 440ml'],
  ['guiness 44cl', 'guiness 440ml'],             // typo survives (fuzzy handles it), size canonical
  ['24x440', '24x 440ml'],
  ['24 x 440ml', '24x 440ml'],
  ['6x4x44cl', '6x 4x 440ml'],
  ['70cl', '700ml'],
  ['1L', '1000ml'],
  ['1 litre', '1000ml'],
  ['1 liter', '1000ml'],
  ['0.7', '700ml'],
  ['Jameson 0.7', 'jameson 700ml'],
  ['6 x 70cl x 40% alc', '6x 700ml 40%'],
  ['Guinness Draft', 'guinness draught'],
  ['Jameson Irish Whisky', 'jameson irish whiskey'],
  ['Jameson Irish Whiskey', 'jameson irish whiskey'],
  ["L'Oréal Paris", 'loreal paris'],
  ['Heineken 330ml btl', 'heineken 330ml bottle'],
  ['Red Bull 250ml cans', 'red bull 250ml can'],
  ['Kinder Bueno 43g', 'kinder bueno 43g'],
  ['Nutella 1kg', 'nutella 1000g'],
  ['120 x 5cl x 40% alc', '120x 50ml 40%'],
  ['Kilkenny 500ml', 'kilkenny 500ml'],
];

for (const [input, expected] of cases) {
  assert.equal(normalise(input), expected, `normalise(${JSON.stringify(input)})`);
}

assert.equal(parseVolumeMl('6 x 70cl x 40% alc'), 700);
assert.equal(parseVolumeMl('24 x 440ml'), 440);
assert.equal(parseVolumeMl('6 x 1000ml'), 1000);
assert.equal(parseVolumeMl('Batiste Dry Shampoo 200ml Blush'), 200);
assert.equal(parseVolumeMl('120'), null);
assert.equal(parseVolumeMl('Kinder Bueno 43g'), null);

assert.equal(volumeLabel(440), '440ml');
assert.equal(volumeLabel(700), '700ml');
assert.equal(volumeLabel(1000), '1L');
assert.equal(volumeLabel(1500), '1.5L');
assert.equal(volumeLabel(1750), '1750ml');
assert.equal(volumeLabel(null), '');

console.log(`normalise: ${cases.length + 12} assertions passed`);
