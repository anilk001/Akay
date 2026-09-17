/**
 * Tests for the PDF/Image ingestion "Select PDF/Image Attachments" Code node.
 *
 * Loads and executes the node source rather than re-typing it, so the test and
 * the text pasted into n8n cannot drift (same harness as the trade-terms
 * tests). An n8n Code node is a function body, hence new Function('$input', src).
 *
 * The case that matters here is the 2026-09-17 RRP regression: the body text
 * carrying the real trade price never reached the Claude vision nodes, so two
 * Mainline Marketing offers were priced off the RRP printed in a product photo.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'pdf-image-offer-ingestion', 'select-pdf-image-attachments.js'),
  'utf8',
);

const AKAY_SIG = `[image: AKAY] <https://offers.akay.ie>
Anil Khetan
Managing Director · Akay Ireland Ltd
*mobile / whatsapp:* +353 87 238 2368
*email:* ak@akay.ie
36 Gleann an Óir, Shannon, Co. Clare, V14 V006, Ireland
Akay Ireland Ltd, registered in Ireland. This email and any files
transmitted with it are confidential and intended solely for the use of the
individual or entity to whom they are addressed. Prices and availability
quoted are subject to prior sale and written confirmation.`;

// Verbatim from gmail message 1a0ae7eaeb0c87a8 (rob.rutter@mainlinemarketing.co.uk).
const LOREAL_BODY = `L'Oreal Bright Reveal Niacinamide Dark Spot Serum 30ml

RRP £31.99 each

EAN - 3600524119898

Take ALL DEAL @ £5.00 each

= 421x6 (2625 pieces)

= £12,630.00

[LOreal Paris Bright Reveal Dark Spot Niacinamide Serum 30ml | eBay UK]`;

function run(items) {
  const fn = new Function('$input', 'console', SRC);
  return fn({ all: () => items }, { log() {} });
}

/** A binary big enough to clear MIN_IMAGE_BYTES and the inline-name bound. */
function photo(fileName) {
  return { fileName, mimeType: 'image/png', bytes: 600 * 1024, data: 'filesystem-v2' };
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok  ' + name);
}

console.log('select-pdf-image-attachments');

check('body text travels with the attachment', () => {
  const out = run([
    {
      json: { id: 'm1', threadId: 't1', subject: 'L\'Oreal serum', from: 'rob.rutter@mainlinemarketing.co.uk', text: LOREAL_BODY },
      binary: { att: photo('serum-offer.png') },
    },
  ]);
  assert.strictEqual(out.length, 1, 'one attachment kept');
  assert.ok(out[0].json.bodyText, 'bodyText is populated');
});

check('the deal price survives into bodyText', () => {
  const out = run([
    {
      json: { id: 'm1', subject: 's', from: 'rob.rutter@mainlinemarketing.co.uk', text: LOREAL_BODY },
      binary: { att: photo('serum-offer.png') },
    },
  ]);
  const body = out[0].json.bodyText;
  assert.ok(body.includes('Take ALL DEAL @ £5.00 each'), 'trade price present');
  assert.ok(body.includes('RRP £31.99 each'), 'RRP kept too — the prompt decides, not this node');
  assert.ok(body.includes('3600524119898'), 'EAN present');
  assert.ok(body.includes('421x6'), 'quantities present');
});

check('our own signature and legal footer are stripped', () => {
  const out = run([
    {
      json: { id: 'm1', subject: 's', from: 'x@y.com', text: AKAY_SIG + '\n\n' + LOREAL_BODY },
      binary: { att: photo('offer.png') },
    },
  ]);
  const body = out[0].json.bodyText;
  assert.ok(!body.includes('Managing Director'), 'signature gone');
  assert.ok(!/subject to prior sale/i.test(body), 'legal footer gone — it mentions prices');
  assert.ok(body.includes('Take ALL DEAL @ £5.00 each'), 'offer content untouched');
});

check("Anil's instruction above a forward is preserved", () => {
  const text = 'Put 10% mark up on this\n\n' + AKAY_SIG + `

---------- Forwarded message ---------
From: YAEL DAHAN <dahanjoelle@hotmail.fr>
Subject: LIPTON offers

Offer price: €0.658 / unit`;
  const out = run([
    { json: { id: 'm1', subject: 's', from: 'ak@akay.ie', text }, binary: { att: photo('lipton.png') } },
  ]);
  const body = out[0].json.bodyText;
  assert.ok(body.startsWith('Put 10% mark up on this'), 'the instruction is the first thing the model reads');
  assert.ok(body.includes('€0.658'), 'forwarded offer content still present');
});

check('forwarded sender still resolves to the real supplier', () => {
  const text = AKAY_SIG + `

---------- Forwarded message ---------
From: Rob Rutter <rob.rutter@mainlinemarketing.co.uk>
Subject: offer

` + LOREAL_BODY;
  const out = run([
    { json: { id: 'm1', subject: 's', from: 'ak@akay.ie', text }, binary: { att: photo('offer.png') } },
  ]);
  assert.strictEqual(out[0].json.fromAddress, 'rob.rutter@mainlinemarketing.co.uk');
  assert.strictEqual(out[0].json.externalSender, true);
});

check('oversized bodies are capped, not dropped', () => {
  const filler = 'x'.repeat(20000);
  const out = run([
    { json: { id: 'm1', subject: 's', from: 'x@y.com', text: LOREAL_BODY + '\n' + filler }, binary: { att: photo('o.png') } },
  ]);
  const body = out[0].json.bodyText;
  assert.ok(body.length < 6200, 'capped near BODY_MAX_CHARS, got ' + body.length);
  assert.ok(body.endsWith('[...body truncated]'), 'truncation is marked');
  assert.ok(body.includes('Take ALL DEAL @ £5.00 each'), 'the offer sits at the top and survives the cap');
});

check('empty body yields empty string, never undefined', () => {
  const out = run([{ json: { id: 'm1', subject: 's', from: 'x@y.com' }, binary: { att: photo('o.png') } }]);
  assert.strictEqual(out[0].json.bodyText, '');
});

// --- regressions on behaviour that predates this change -------------------

check('inline signature logos are still skipped', () => {
  const out = run([
    {
      json: { id: 'm1', subject: 's', from: 'x@y.com', text: 'hi' },
      binary: { logo: { fileName: 'image001.png', mimeType: 'image/png', bytes: 6573, data: 'filesystem-v2' } },
    },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].json.kind, 'none', 'no-op sentinel, not a Claude call');
  assert.strictEqual(out[0].json.noParse, true);
});

check('spreadsheets are still left to the Excel workflow', () => {
  const out = run([
    {
      json: { id: 'm1', subject: 's', from: 'x@y.com', text: 'hi' },
      binary: { sheet: { fileName: 'OFFRE_LIPTON.xlsx', mimeType: 'application/vnd.ms-excel', bytes: 900 * 1024 } },
    },
  ]);
  assert.strictEqual(out[0].json.kind, 'none');
  assert.ok(/spreadsheet/i.test(out[0].json.skippedNames));
});

check('the sentinel still carries bodyText for the thread', () => {
  const out = run([
    {
      json: { id: 'm1', subject: 's', from: 'x@y.com', text: LOREAL_BODY },
      binary: { logo: { fileName: 'image001.png', mimeType: 'image/png', bytes: 6573 } },
    },
  ]);
  assert.ok(out[0].json.bodyText.includes('Take ALL DEAL'), 'sentinel keeps the same meta as a kept attachment');
});

console.log('\n' + passed + ' passed');
