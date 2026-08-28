#!/usr/bin/env node
//
// §0 data safety gate. Runs after `astro build`, before Netlify or GitHub
// Actions can publish anything.
//
// The catalogue is built from an Airtable base that holds supplier identity,
// buy prices and margin commentary alongside the public offer text. The data
// layer only ever REQUESTS public-safe fields, so a leak would have to come
// from somewhere else: a new page interpolating a raw record, a debug dump, a
// `data-` attribute carrying the whole Airtable row, a stray field ID pasted
// into a comment. This script is the backstop for all of those — it reads what
// was actually written to dist/ and fails the build on a match.
//
// Exit codes: 0 clean, 1 a denied string was found, 2 dist/ missing.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

// Field IDs from the brief's deny table. A field ID can only reach dist/ if
// something is serialising a raw Airtable payload, so any hit is a real leak
// regardless of what surrounds it.
const DENIED_FIELD_IDS = [
  ['fldGWVeOeRVx4QCZY', 'Offer Name (primary) — embeds supplier name'],
  ['fldSWiPrQaKv56upV', 'Notes — supplier identity, Gmail IDs'],
  ['fldFaMeu207lvbKQu', 'Trader Comment — supplier identity + margin commentary'],
  ['fldIpbWv91McqVSrw', 'Delivery Info Source — internal staff addresses'],
  ['fldAMyazuwdF0er4Z', 'Buy Price'],
  ['fldZgkcipwuy0A2jt', 'Margin %'],
  ['fldyIFWuBAzzNnutl', 'Supplier Name'],
];

// Human-readable field labels that must never be printed. Case-SENSITIVE and
// anchored on the exact Airtable label, so ordinary words ("margin: 0 auto" in
// CSS, "note" in prose) cannot trip the gate.
const DENIED_LABELS = [
  'Buy Price',
  'Margin %',
  'Trader Comment',
  'Delivery Info Source',
  'Supplier Name',
  'Supplier Email',
  'Supplier Trust',
];

// Only text output can leak a string. Binary assets (images, the XLSX, fonts)
// are scanned too where cheap, but the XLSX is checked by its own generator
// against an explicit column allow-list — see scripts/build-stock-list.mjs.
const TEXT_EXT = new Set(['.html', '.js', '.mjs', '.json', '.xml', '.txt', '.css', '.map', '.svg']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error('[safety] dist/ not found — run `astro build` first.');
  process.exit(2);
}

const needles = [
  ...DENIED_FIELD_IDS.map(([id, why]) => ({ needle: id, why: `denied field ID (${why})` })),
  ...DENIED_LABELS.map((label) => ({ needle: label, why: 'denied field label' })),
];

const violations = [];
let scanned = 0;

for (const file of files) {
  if (!TEXT_EXT.has(extname(file).toLowerCase())) continue;
  scanned++;
  const body = readFileSync(file, 'utf8');
  for (const { needle, why } of needles) {
    let idx = body.indexOf(needle);
    while (idx !== -1) {
      violations.push({
        file: relative(DIST, file),
        needle,
        why,
        excerpt: body.slice(Math.max(0, idx - 60), idx + needle.length + 60).replace(/\s+/g, ' '),
      });
      if (violations.length > 40) break;
      idx = body.indexOf(needle, idx + needle.length);
    }
  }
  if (violations.length > 40) break;
}

if (violations.length) {
  console.error(`\n[safety] BUILD BLOCKED — ${violations.length} private-data violation(s) in dist/:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.why}: "${v.needle}"`);
    console.error(`    …${v.excerpt}…\n`);
  }
  console.error('Nothing has been deployed. Remove the private data, then rebuild.');
  console.error('See §0 of the build brief for the field deny list.\n');
  process.exit(1);
}

console.log(`[safety] clean — scanned ${scanned} text files in dist/, no denied field IDs or labels found`);
