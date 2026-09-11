// Tiny client-side search engine for the offers catalogue.
//
// Why not Pagefind or Fuse.js: Pagefind has no typo tolerance and no numeric
// facets; Fuse's single-pattern fuzzy scoring cannot express "every word of the
// query must match somewhere on the offer, with brand and name weighted above
// spec". The catalogue is ~6,000 rows, so an inverted index with per-token
// exact / prefix / fuzzy matching runs in a few milliseconds and needs no
// dependency. It is shared by the tests (Node) and the browser (bundled by
// Astro from src/pages/search.astro).

import { tokens } from './normalise.mjs';

const W_STRONG = 2;   // brand, product name, variant
const W_WEAK = 1;     // spec, category, unit type, bond, warehouse, note
const S_EXACT = 1.0;
const S_PREFIX = 0.6;
const S_FUZZY = 0.45;

/**
 * Build an index over `docs`. `fields(doc)` returns { strong, weak } strings.
 */
export function buildIndex(docs, fields) {
  const postings = new Map();       // token -> Map(docIdx -> weight)
  const docTokens = new Array(docs.length);
  docs.forEach((doc, i) => {
    const f = fields(doc);
    const seen = new Map();
    for (const t of tokens(f.strong || '')) seen.set(t, W_STRONG);
    for (const t of tokens(f.weak || '')) if (!seen.has(t)) seen.set(t, W_WEAK);
    docTokens[i] = seen;
    for (const [t, w] of seen) {
      let m = postings.get(t);
      if (!m) { m = new Map(); postings.set(t, m); }
      m.set(i, w);
    }
  });
  const vocab = Array.from(postings.keys());
  return { docs, postings, vocab, docTokens, fields };
}

// Levenshtein distance with an early exit once `max` is exceeded.
export function editDistance(a, b, max) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

function fuzzyBudget(tok) {
  if (!/^[a-z]+$/.test(tok)) return 0;      // never fuzz numbers or sizes: 440ml must not match 330ml
  if (tok.length >= 8) return 2;
  if (tok.length >= 4) return 1;
  return 0;
}

// For one query token, collect docIdx -> best score across exact, prefix and fuzzy matches.
function matchToken(index, qt, cache) {
  if (cache.has(qt)) return cache.get(qt);
  const scores = new Map();
  const add = (postingMap, base) => {
    for (const [idx, w] of postingMap) {
      const s = base * w;
      if (s > (scores.get(idx) || 0)) scores.set(idx, s);
    }
  };
  const exact = index.postings.get(qt);
  if (exact) add(exact, S_EXACT);

  const budget = fuzzyBudget(qt);
  const doPrefix = qt.length >= 2;
  if (doPrefix || budget) {
    for (const v of index.vocab) {
      if (v === qt) continue;
      if (doPrefix && v.length > qt.length && v.startsWith(qt)) {
        add(index.postings.get(v), S_PREFIX);
        continue;
      }
      if (budget && /^[a-z]+$/.test(v) && editDistance(qt, v, budget) <= budget) {
        add(index.postings.get(v), S_FUZZY);
      }
    }
  }
  cache.set(qt, scores);
  return scores;
}

/**
 * Search. Returns null when the query has no usable tokens (caller shows
 * everything), otherwise an array of { idx, score, matched, of } sorted by
 * relevance. Every query token must match; if nothing satisfies that and the
 * query has 2+ tokens, rows matching all but one token are returned instead
 * so a stray word never produces an empty screen.
 */
export function search(index, query, cache = new Map()) {
  const qts = Array.from(new Set(tokens(query)));
  if (!qts.length) return null;
  const perToken = qts.map((qt) => matchToken(index, qt, cache));

  const agg = new Map(); // idx -> { score, matched }
  perToken.forEach((scores) => {
    for (const [idx, s] of scores) {
      const a = agg.get(idx);
      if (a) { a.score += s; a.matched += 1; } else agg.set(idx, { score: s, matched: 1 });
    }
  });

  let need = qts.length;
  let rows = [];
  for (const [idx, a] of agg) if (a.matched >= need) rows.push({ idx, score: a.score, matched: a.matched, of: qts.length });
  if (!rows.length && qts.length >= 2) {
    need = qts.length - 1;
    for (const [idx, a] of agg) if (a.matched >= need) rows.push({ idx, score: a.score, matched: a.matched, of: qts.length });
  }
  rows.sort((a, b) => (b.matched - a.matched) || (b.score - a.score) || (a.idx - b.idx));
  return rows;
}
