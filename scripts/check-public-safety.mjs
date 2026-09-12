#!/usr/bin/env node
// Post-build assertion: nothing private may exist in dist/.
//
// Runs as part of `npm run build` (and in CI). Fails the build if:
//   1. dist/search-index.json carries any key outside the public allowlist, or
//      any key/value that looks like a forbidden Airtable field;
//   2. any generated HTML/JS/JSON/TXT/XML contains a forbidden field name,
//      an Airtable token, or the token environment variable name.
//
// Field names are matched case-sensitively as they are spelled in Airtable so
// ordinary prose ("1,000+ suppliers", "we never publish supplier names") is
// not a false positive, while a leaked column header is.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { FORBIDDEN_FIELDS, isForbiddenField } from '../src/data/airtable.mjs';
import { generateSlug } from '../src/lib/slug.mjs';
import { PUBLIC_KEYS as PUBLIC_KEYS_LIST } from '../src/lib/search-index-keys.mjs';

const DIST = join(process.cwd(), 'dist');
const PUBLIC_KEYS = new Set(PUBLIC_KEYS_LIST);

// Exact Airtable column names that must never appear in output.
// Multi-word column names only: a bare "Supplier" or "Notes" is ordinary prose on
// the About page; "Supplier Name" or "Buy Price" is a leaked column header.
const FORBIDDEN_STRINGS = FORBIDDEN_FIELDS.filter((f) => f.includes(' '));
const FORBIDDEN_REGEX = [
  /\bpat[A-Za-z0-9]{14}\.[a-f0-9]{64}\b/,   // Airtable personal access token
  /AIRTABLE_TOKEN/,
  /Airtable_Pat/,
  /Authorization:\s*Bearer/i,
];
const SCAN_EXT = new Set(['.html', '.js', '.mjs', '.json', '.txt', '.xml']);

const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SCAN_EXT.has(extname(name))) out.push(p);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error('[public-safety] dist/ not found — run `astro build` first.');
  process.exit(1);
}

// 1. The search index.
const indexPath = join(DIST, 'search-index.json');
if (!existsSync(indexPath)) {
  problems.push('dist/search-index.json is missing');
} else {
  const data = JSON.parse(readFileSync(indexPath, 'utf8'));
  if (!Array.isArray(data.offers)) problems.push('search-index.json: offers is not an array');
  const badKeys = new Set();
  for (const row of data.offers || []) {
    for (const k of Object.keys(row)) {
      if (!PUBLIC_KEYS.has(k) || isForbiddenField(k)) badKeys.add(k);
    }
  }
  for (const k of badKeys) problems.push(`search-index.json: non-public key "${k}"`);
  // 1b. Link integrity: every row must resolve to a built offer page using the
  // same slug rule the browser applies (explicit slug, else generateSlug).
  let missing = 0;
  for (const row of data.offers || []) {
    const slug = row.slug || generateSlug(String(row.name || ''), String(row.spec || ''));
    if (!existsSync(join(DIST, 'offers', slug, 'index.html'))) {
      missing += 1;
      if (missing <= 5) problems.push(`search-index.json: no page for slug "${slug}" (${row.id})`);
    }
  }
  if (missing > 5) problems.push(`search-index.json: ${missing} rows point at missing offer pages`);
  const bytes = statSync(indexPath).size;
  console.log(`[public-safety] search-index.json: ${data.offers?.length ?? 0} offers, ${(bytes / 1024).toFixed(0)} KB, keys OK`);
}

// 2. Every generated text file.
const files = walk(DIST);
let scanned = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  scanned += 1;
  for (const s of FORBIDDEN_STRINGS) {
    if (text.includes(s)) problems.push(`${file.replace(DIST, 'dist')}: contains forbidden field name "${s}"`);
  }
  for (const re of FORBIDDEN_REGEX) {
    if (re.test(text)) problems.push(`${file.replace(DIST, 'dist')}: matches ${re}`);
  }
}
console.log(`[public-safety] scanned ${scanned} files`);

if (problems.length) {
  console.error('\n[public-safety] FAILED — private data would reach the browser:');
  for (const p of problems.slice(0, 50)) console.error('  - ' + p);
  if (problems.length > 50) console.error(`  … and ${problems.length - 50} more`);
  process.exit(1);
}
console.log('[public-safety] OK — no forbidden fields or secrets in dist/');
