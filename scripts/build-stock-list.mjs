#!/usr/bin/env node
//
// §4 — bakes the downloadable stock list into dist/ at build time.
//
// Big buyers want a file. They price internally in a spreadsheet, circulate it
// to their own commercial team, and compare it against two other suppliers
// before they reply. Sending them to a web page to copy 2,888 rows by hand is
// the reason they close the tab. The site's "no login, no PDF" positioning
// stays intact — this is an XLSX behind a form, not a gated portal.
//
// Generated at build time, not on request: the site is static and stays static.
// One sheet per category, and the columns come from the allow-list in
// src/lib/stock-list.mjs — an offer field added later cannot leak into the
// export unless someone puts it on that list on purpose.

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';
import { getCatalogue } from '../src/lib/catalogue.mjs';
import { STOCK_LIST_PATH, STOCK_LIST_COLUMNS } from '../src/lib/stock-list.mjs';

const DIST = new URL('../dist/', import.meta.url).pathname;
const out = join(DIST, STOCK_LIST_PATH.replace(/^\//, ''));

const STOCK_LABEL = { in: 'In stock', warn: 'Limited', enq: 'Enquire' };

// Excel sheet names cannot exceed 31 characters or contain : \ / ? * [ ]
function sheetName(category) {
  return String(category).replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Other';
}

function cellValue(offer, key) {
  if (key === 'stockLabel') return STOCK_LABEL[offer.stock] || 'Enquire';
  if (key === 'pageUrl') return `https://offers.akay.ie/offers/${offer.slug}/`;
  const v = offer[key];
  if (v === null || v === undefined || v === '') return '';
  return v;
}

const { offers, categories, generatedAt, stats } = await getCatalogue();

const wb = new ExcelJS.Workbook();
wb.creator = 'Akay Irl Ltd';
wb.created = generatedAt;

// A cover sheet, because a bare grid of 2,888 rows arriving by download with no
// context is the kind of file that gets forwarded without the caveats.
const cover = wb.addWorksheet('About this list');
cover.columns = [{ width: 26 }, { width: 88 }];
const coverRows = [
  ['Akay Irl Ltd — trade stock list', ''],
  ['', ''],
  ['Prices updated', generatedAt.toISOString().slice(0, 10)],
  ['Live lines', stats.offers],
  ['Brands', stats.brands],
  ['Categories', stats.categories],
  ['Currencies', stats.currencies.join(', ')],
  ['', ''],
  ['Basis', 'Prices are quoted per the basis shown in the "Price basis" column — per case on most lines, per bottle or per unit on some. Read the basis before comparing two lines.'],
  // Anil's call (2026-08-28): publish real quantities rather than availability
  // labels alone. About a quarter of lines carry one. The column is kept
  // strictly numeric so it sorts and filters — which is the main reason a buyer
  // wants the file at all — so a blank has to be explained rather than filled
  // with text. "Availability" carries the label for every line either way.
  ['Stock quantities', 'The "Cases available" column shows the actual case count where the warehouse has confirmed one. A BLANK MEANS NOT STATED, NOT ZERO — read the "Availability" column, which is populated on every line. Quantities move during the day; they are confirmed on the quotation.'],
  ['Validity', 'Indicative and subject to availability at the time of order. Firm prices are confirmed on a written quotation.'],
  ['Customs status', 'T1, T2, bonded and duty-paid are explained at https://offers.akay.ie/customs-glossary/'],
  ['Terms and documents', 'https://offers.akay.ie/trade-terms/'],
  ['Trade sales only', 'We do not supply private individuals.'],
  ['Contact', 'offers@akay.ie · WhatsApp 00353 87 238 2368'],
];
coverRows.forEach((r) => cover.addRow(r));
cover.getRow(1).font = { bold: true, size: 14 };
cover.getColumn(1).font = { bold: true };
cover.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
// Re-apply after the column-wide font, so the title keeps its size.
cover.getRow(1).font = { bold: true, size: 14 };

for (const category of categories) {
  const ws = wb.addWorksheet(sheetName(category.name));
  ws.columns = STOCK_LIST_COLUMNS.map(([header, key, width]) => ({ header, key, width }));

  for (const offer of category.offers) {
    const row = {};
    for (const [, key] of STOCK_LIST_COLUMNS) row[key] = cellValue(offer, key);
    ws.addRow(row);
  }

  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDE4' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: STOCK_LIST_COLUMNS.length } };
  ws.getColumn('amount').numFmt = '#,##0.00';
  ws.getColumn('qty').numFmt = '#,##0';
}

// Last line of defence, mirroring scripts/assert-public-safe.mjs: the workbook
// is a binary zip, so the dist/ text scan cannot see inside it. Verify the
// header row of every sheet against the allow-list before writing.
const allowed = new Set(STOCK_LIST_COLUMNS.map(([header]) => header));
for (const ws of wb.worksheets) {
  if (ws.name === 'About this list') continue;
  const headers = ws.getRow(1).values.slice(1).map((v) => String(v));
  const stray = headers.filter((h) => !allowed.has(h));
  if (stray.length) {
    console.error(`[stock-list] BLOCKED — sheet "${ws.name}" carries non-allow-listed columns: ${stray.join(', ')}`);
    process.exit(1);
  }
}

mkdirSync(dirname(out), { recursive: true });
await wb.xlsx.writeFile(out);
console.log(
  `[stock-list] wrote ${STOCK_LIST_PATH} — ${offers.length} lines across ` +
  `${categories.length} sheets, ${STOCK_LIST_COLUMNS.length} public-safe columns`
);
