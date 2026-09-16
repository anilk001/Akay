/**
 * Tests for the "Extract Body Blocks" and "Flatten Block" Code nodes of
 * Email Body Offer Ingestion — Akay.
 *
 * The node sources are LOADED AND EXECUTED, not re-typed here — same approach
 * as the trade-terms and instant-quote tests, so a rule changed in the node is
 * a rule the tests see. An n8n Code node is a function body, so each is
 * wrapped in `new Function` and handed a fake `$input`.
 *
 * The case that drove these: Epic (EUROPEIA PORTUGUESE INTER COMMERCIO) sends
 * its ExW New Corp price list through Brevo, which puts every offer line in
 * its OWN one-row <table>. Read table by table each line is a single row, gets
 * dropped by the `>= 2` bar, and the 13-line list arrived as 3 offers — on
 * 2026-09-09 and again, identically, on 2026-09-16. Nothing failed; the offers
 * simply were not there. What is worth asserting is exactly that: the shapes
 * that go missing without a word.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'email-offer-ingestion');
const extractFn = new Function('$input', readFileSync(join(DIR, 'extract-body-blocks.js'), 'utf8'));
const flattenFn = new Function('$input', readFileSync(join(DIR, 'flatten-block.js'), 'utf8'));

let n = 0;
const eq = (a, b, m) => { n++; assert.deepEqual(a, b, m); };
const ok = (v, m) => { n++; assert.ok(v, m); };

const extract = (json, binary = {}) => extractFn({ item: { json, binary } }).json;
const flatten = (json) => flattenFn({ item: { json } }).json;

// ── fixture helpers ─────────────────────────────────────────────────────────
const td = (cells) => cells.map((c) => `<td>${c}</td>`).join('');
/** One offer line the way a Brevo content block ships it: its own <table>. */
const stackedTable = (cells) => `<table><tbody><tr>${td(cells)}</tr></tbody></table>`;
const multiTable = (rows) =>
  `<table><tbody>${rows.map((r) => `<tr>${td(r)}</tr>`).join('')}</tbody></table>`;

const line = (cases, name, code, pack, size, abv, price, per) =>
  [`${cases} cases`, name, code, String(pack), size, abv, 'GBX', `USD ${price} per bottle`, `USD ${per} per case`];

// The real 2026-09-16 Epic list, in the markup shape it actually arrived in:
// a one-cell layout wrapper, two stacked single-row tables, one table that
// happens to hold three lines plus spacer rows, then eight more stacked ones.
const EPIC_LINES = [
  line(128, 'CHIVAS ROYAL SALUTE 21YRS', 'REF', 6, '70 CL', '40%', '66.50', '399.00'),
  line(216, 'CHIVAS ROYAL SALUTE 21YRS', 'REF', 6, '1 L', '40%', '99.83', '599.00'),
  line(119, 'CHIVAS REGAL ULTRA 25YRS', 'REF', 3, '70 CL', '40%', '149.66', '449.00'),
  line(150, 'HIGHLAND PARK 10 YRS VIKING SCARS', 'REF', 6, '75 CL', '43%', '18.16', '109.00'),
  line(150, 'HIGHLAND PARK 12 YRS VIKING HONOUR', 'REF', 6, '70 CL', '40%', '21.50', '129.00'),
  line(109, 'BALVENIE 12 YRS DOUBLE WOOD', 'REF', 6, '70 CL', '40%', '33.16', '199.00'),
  line(90, 'BALVENIE 14 YRS CARIBBEAN CASK', 'REF', 6, '70 CL', '43%', '49.83', '299.00'),
  line(20, 'CHIVAS ROYAL SALUTE DESTINY 38YRS', 'REF', 3, '50 CL', '40%', '499.66', '1,499.00'),
  line(900, 'GRANTS TRIPLEWOOD', 'NRF', 12, '70 CL', '40%', '4.16', '50.00'),
  line(100, 'GLENLIVET DISTILLER RESERVE', 'REF', 12, '1 L', '40%', '22.41', '269.00'),
  line(220, 'GLENLIVET FRENCH OAK 15YRS', 'REF', 6, '70 CL', '40%', '31.50', '189.00'),
  line(50, 'GLENLIVET 21YRS WOOD BOX', 'REF', 3, '70 CL', '43%', '133.00', '399.00'),
  line(300, 'GLENLIVET 25YRS', 'REF', 3, '70 CL', '43%', '216.33', '649.00'),
];

const EPIC_HTML = [
  '<table><tbody><tr><td>Dear Buyers, we are pleased to offer the below prices.</td></tr></tbody></table>',
  stackedTable(EPIC_LINES[0]),
  stackedTable(EPIC_LINES[1]),
  // The one table that carried three lines, with the empty spacer rows that
  // made it look like a five-row grid.
  `<table><tbody><tr><td></td></tr><tr>${td(EPIC_LINES[2])}</tr><tr>${td(EPIC_LINES[3])}</tr><tr>${td(EPIC_LINES[4])}</tr><tr><td></td></tr></tbody></table>`,
  ...EPIC_LINES.slice(5).map(stackedTable),
].join('\n<p>&nbsp;</p>\n');

// ── the Epic case ───────────────────────────────────────────────────────────
const epic = extract({ html: EPIC_HTML, from: 'Sandro <sandro@9665675.brevosend.com>', subject: 'ExW New Corp Offers' });

eq(epic.blocksFound, 1, 'the split list is rejoined into one block, not eleven');
eq(epic.blocks[0].type, 'table', 'and it is a table block');
eq(epic.blocks[0].rows.length, 13, 'all 13 offer lines survive (was 3)');

const names = epic.blocks[0].rows.map((r) => r[1]);
for (const expected of EPIC_LINES.map((l) => l[1])) {
  ok(names.includes(expected), `${expected} is in the block`);
}
eq(epic.blocks[0].rows[0], EPIC_LINES[0], 'the list keeps document order — the 128-case Royal Salute leads');
eq(epic.blocks[0].rows[12], EPIC_LINES[12], 'and Glenlivet 25YRS closes it');
eq(epic.exceptionReason, null, 'nothing is flagged as an exception');

// The one-cell wrapper is not a price list and must not join the run.
ok(!epic.blocks[0].rows.some((r) => r.length === 1), 'the layout wrapper is left out');

// ── regressions: the shapes that already worked ─────────────────────────────
const HEADER = ['Product', 'Pack', 'Size', 'Price'];
const plain = extract({
  html: multiTable([HEADER, ['Absolut Blue', '12', '70cl', 'EUR 8.50'], ['Jameson', '6', '70cl', 'EUR 14.00']]),
  from: 'sales@example.com',
});
eq(plain.blocksFound, 1, 'an ordinary single table is still one block');
eq(plain.blocks[0].rows.length, 3, 'with its header and both rows intact');

// Two real lists — a table per category — must NOT be fused, even though they
// share a column count. Fusing them would put one supplier's headings into the
// other's data.
const twoLists = extract({
  html: [
    multiTable([HEADER, ['Absolut Blue', '12', '70cl', 'EUR 8.50']]),
    multiTable([HEADER, ['Heineken', '24', '33cl', 'EUR 11.00']]),
  ].join('\n'),
  from: 'sales@example.com',
});
eq(twoLists.blocksFound, 2, 'two multi-row tables stay two blocks');

// A sender who repeats the headings above every stacked block.
const repeated = extract({
  html: [
    stackedTable(HEADER),
    stackedTable(['Absolut Blue', '12', '70cl', 'EUR 8.50']),
    stackedTable(HEADER),
    stackedTable(['Jameson', '6', '70cl', 'EUR 14.00']),
  ].join('\n'),
  from: 'sales@example.com',
});
eq(repeated.blocksFound, 1, 'repeated headings do not split the list');
eq(repeated.blocks[0].rows.length, 3, 'and the restated header row is dropped');
eq(repeated.blocks[0].rows[0], HEADER, 'the first header is kept as the header');

// Signature tables are still skipped, stacked or not.
const signed = extract({
  html: [
    stackedTable(EPIC_LINES[0]),
    stackedTable(EPIC_LINES[1]),
    '<table><tbody><tr><td><a href="mailto:sandro@example.com">mail</a></td><td>x</td><td>y</td></tr></tbody></table>',
  ].join('\n'),
  from: 'sales@example.com',
});
eq(signed.blocks[0].rows.length, 2, 'the signature block does not join the price list');

// Narrow stacked tables are layout, not data, and must not be glued together.
const narrow = extract({
  html: [stackedTable(['a', 'b']), stackedTable(['c', 'd']), stackedTable(['e', 'f'])].join('\n'),
  from: 'sales@example.com',
});
ok(narrow.blocksFound === 0 || narrow.blocks.every((b) => b.rows[0].length >= 3),
  'two-column layout strips are not promoted to a price list');

// An attached spreadsheet still wins over the body.
const withFile = extract({ html: EPIC_HTML, from: 'x@y.com' }, { data: { fileName: 'offers.xlsx' } });
eq(withFile.blocksFound, 0, 'a spreadsheet attachment still short-circuits the body');

// ── Flatten Block ───────────────────────────────────────────────────────────
const oneBlock = flatten({ subject: 'Offer', id: 'abc123', blocks: [{ type: 'table', rows: [HEADER, ['Absolut Blue', '12', '70cl', 'EUR 8.50']] }] });
eq(oneBlock.headerCells, HEADER, 'a single block still yields its header');
eq(oneBlock.dataRows.length, 1, 'and its data row');
eq(oneBlock.sourceMessageId, 'abc123', 'the source message id is stamped');

const manyBlocks = flatten({
  subject: 'Offer',
  blocks: [
    { type: 'table', rows: [HEADER, ['Absolut Blue', '12', '70cl', 'EUR 8.50']] },
    { type: 'table', rows: [['Jameson', '6', '70cl', 'EUR 14.00']] },
    { type: 'table', rows: [HEADER, ['Heineken', '24', '33cl', 'EUR 11.00']] },
  ],
});
eq(manyBlocks.dataRows.length, 3, 'every block contributes its rows (was: only the first block)');
eq(manyBlocks.blocksMerged, 3, 'and the count is recorded');
ok(!manyBlocks.dataRows.some((r) => r[0] === 'Product'), 'a repeated header row does not become data');

// A block the profile cannot read with the same column map is left out, and
// said so — silently dropping it is what caused this whole exercise.
const mismatched = flatten({
  subject: 'Offer',
  blocks: [
    { type: 'table', rows: [HEADER, ['Absolut Blue', '12', '70cl', 'EUR 8.50']] },
    { type: 'table', rows: [['Jameson', 'EUR 14.00']] },
  ],
});
eq(mismatched.dataRows.length, 1, 'a differently shaped block is not forced into the map');
ok(mismatched.blocksSkipped.includes('2 cols'), 'and the skip is named for whoever counts the lines');

const noBlocks = flatten({ subject: 'Offer', blocks: [] });
eq(noBlocks.headerCells, [], 'an empty body yields no header');
eq(noBlocks.blockType, null, 'and no block type');

console.log(`email-body-blocks: ${n} assertions passed`);
