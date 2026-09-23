// node scripts/compare-offer-sources.mjs
//
// Runbook Phase 3, step 9: run BOTH sources and diff them, before switching
// akay.ie over. Read-only - it never writes the snapshot.
//
// Needs AIRTABLE_TOKEN and DATABASE_URL, and egress to both. That means a
// GitHub runner, not the agent sandbox (which can reach neither), so this is
// written to be run from Actions or a laptop.
//
// It compares the NORMALISED output, not raw rows, because that is what gets
// baked. Two sources agreeing on raw columns but disagreeing after normalize()
// would still ship two different sites.
import { fileURLToPath } from 'node:url';

const MOD = new URL('../src/data/airtable.mjs', import.meta.url).href;

async function load(source) {
  process.env.OFFERS_SOURCE = source;
  // Cache-bust so the module re-evaluates and re-reads OFFERS_SOURCE.
  const m = await import(`${MOD}?src=${source}`);
  return m.getOffers();
}

const a = await load('airtable');
const b = await load('postgres');

if (a.source !== 'live') {
  console.error(`Airtable side did not fetch live (got "${a.source}") — nothing to compare.`);
  process.exit(1);
}
if (b.source !== 'postgres') {
  console.error(`Postgres side did not fetch (got "${b.source}") — nothing to compare.`);
  process.exit(1);
}

function index(rows) {
  const m = new Map();
  for (const o of rows) m.set(o.id, o);
  return m;
}

function compare(label, listA, listB) {
  const A = index(listA);
  const B = index(listB);
  const onlyA = [...A.keys()].filter((k) => !B.has(k));
  const onlyB = [...B.keys()].filter((k) => !A.has(k));
  const both = [...A.keys()].filter((k) => B.has(k));

  const perField = new Map();
  const examples = new Map();
  for (const id of both) {
    const x = A.get(id);
    const y = B.get(id);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      const xv = JSON.stringify(x[k] ?? null);
      const yv = JSON.stringify(y[k] ?? null);
      if (xv !== yv) {
        perField.set(k, (perField.get(k) || 0) + 1);
        if (!examples.has(k)) examples.set(k, `${id}: airtable=${xv} postgres=${yv}`);
      }
    }
  }

  console.log(`\n=== ${label} ===`);
  console.log(`airtable: ${listA.length}   postgres: ${listB.length}   in both: ${both.length}`);
  if (onlyA.length) console.log(`  only in Airtable: ${onlyA.length} (${onlyA.slice(0, 5).join(', ')}${onlyA.length > 5 ? ' ...' : ''})`);
  if (onlyB.length) console.log(`  only in Postgres: ${onlyB.length} (${onlyB.slice(0, 5).join(', ')}${onlyB.length > 5 ? ' ...' : ''})`);
  if (!perField.size) {
    console.log('  field differences: NONE — the two sources normalise identically.');
  } else {
    console.log('  field differences:');
    for (const [k, n] of [...perField].sort((p, q) => q[1] - p[1])) {
      console.log(`    ${k.padEnd(22)} ${String(n).padStart(6)} row(s)   e.g. ${examples.get(k)}`);
    }
  }
  return onlyA.length + onlyB.length + perField.size;
}

// THE DELISTED CAP IS AN EXPECTED DIFFERENCE, NOT A FAULT.
// Both sources take the newest DELISTED_CAP=800 by Offer Date, but Airtable
// sorts by date alone and Postgres adds `airtable_id collate "C"` as a
// tiebreak. Wherever dates tie across the 800th row, the two pick a different
// subset of that day - forever. A gate that can never go green trains whoever
// runs it to ignore it, so the boundary day is separated out and reported,
// not counted as a fault.
function trimCapBoundary(listA, listB) {
  const oldest = (rows) => rows.reduce((m, o) => (o.offerDate && (!m || o.offerDate < m) ? o.offerDate : m), null);
  const cut = [oldest(listA), oldest(listB)].filter(Boolean).sort().pop() || null;
  if (!cut) return [listA, listB, 0, null];
  const keep = (rows) => rows.filter((o) => !o.offerDate || o.offerDate > cut);
  const dropped = (listA.length - keep(listA).length) + (listB.length - keep(listB).length);
  return [keep(listA), keep(listB), dropped, cut];
}

let problems = 0;
problems += compare('live offers', a.offers, b.offers);

const [dA, dB, dropped, cut] = trimCapBoundary(a.delisted, b.delisted);
if (dropped) {
  console.log(`\nnote: ${dropped} delisted row(s) on the cap-boundary date ${cut} are excluded from the`);
  console.log('      comparison. The two sources break Offer Date ties differently, so which rows land');
  console.log('      in the newest 800 differs on that day only. Expected, and not a reason to hold the switch.');
}
problems += compare('delisted archive (excluding the cap-boundary day)', dA, dB);

console.log(`\n${problems === 0 ? 'IDENTICAL — safe to switch.' : `${problems} difference class(es) — do NOT switch until each is explained.`}`);
process.exit(problems === 0 ? 0 : 2);
