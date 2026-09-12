// Text normaliser shared by the build-time search index and the browser.
//
// The same function runs over every offer's text and over the buyer's query, so
// however someone types a size or a pack, both sides end up with identical
// tokens:
//
//   "Guinness Draught 24 x 440ml"  ->  guinness draught 24x 440ml
//   "guiness 44cl"                 ->  guiness 440ml          (fuzzy fixes the typo)
//   "6x4x44cl"                     ->  6x 4x 440ml
//   "Jameson 0.7"                  ->  jameson 700ml
//   "whisky" / "whiskey"           ->  whiskey
//   "draft" / "draught"            ->  draught
//
// Plain ES module with no dependencies so `node tests/normalise.test.js` can
// exercise it without a bundler.

const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(millilit(?:re|er)s?|centilit(?:re|er)s?|lit(?:re|er)s?|ltrs?|ml|cl|l|kilograms?|kgs?|grams?|gr|g|oz)\b/gi;

// Whole-token rewrites applied after tokenising.
const SYNONYMS = {
  draft: 'draught', drafts: 'draught', draughts: 'draught',
  whisky: 'whiskey', whiskies: 'whiskey', whiskeys: 'whiskey',
  liter: 'litre', liters: 'litre',
  btl: 'bottle', btls: 'bottle', bottles: 'bottle', bt: 'bottle',
  cans: 'can', tin: 'can', tins: 'can',
  pcs: 'piece', pc: 'piece', pieces: 'piece',
  ctn: 'carton', ctns: 'carton', cartons: 'carton',
  cs: 'case', cases: 'case',
  gbx: 'giftbox', gb: 'giftbox', giftbox: 'giftbox', 'gift': 'gift',
  pk: 'pack', pks: 'pack', packs: 'pack',
  ltr: 'litre',
};

// Words that carry no meaning for matching.
const STOP = new Set(['x', 'the', 'and', 'of', 'with', 'in', 'a', 'an', 'alc', 'abv', 'vol', 'per', 'for']);

function toMl(n, unit) {
  const v = parseFloat(String(n).replace(',', '.'));
  const u = unit.toLowerCase();
  let ml;
  if (u === 'ml' || u.startsWith('millilit')) ml = v;
  else if (u === 'cl' || u.startsWith('centilit')) ml = v * 10;
  else if (u === 'l' || u.startsWith('lit') || u.startsWith('ltr')) ml = v * 1000;
  else return null;
  return Math.round(ml);
}

function toG(n, unit) {
  const v = parseFloat(String(n).replace(',', '.'));
  const u = unit.toLowerCase();
  if (u === 'g' || u === 'gr' || u.startsWith('gram')) return Math.round(v);
  if (u.startsWith('kg') || u.startsWith('kilogram')) return Math.round(v * 1000);
  if (u === 'oz') return Math.round(v * 28.35);
  return null;
}

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Very light stemming: plural "s" only, never touching short words or words
// ending in a double s (guinness), us, is, or a digit/unit.
function stem(tok) {
  if (tok.length < 5 || !/^[a-z]+$/.test(tok)) return tok;
  if (/(ss|us|is|ys)$/.test(tok)) return tok;
  if (tok.endsWith('ies')) return tok.slice(0, -3) + 'y';
  if (tok.endsWith('s')) return tok.slice(0, -1);
  return tok;
}

/** Canonical size label for a volume in ml: 440 -> "440ml", 1000 -> "1L", 1500 -> "1.5L". */
export function volumeLabel(ml) {
  if (!Number.isFinite(ml) || ml <= 0) return '';
  if (ml >= 1000 && ml % 100 === 0) return `${+(ml / 1000).toFixed(2)}L`;
  return `${Math.round(ml)}ml`;
}

/** Parse the first volume in a free-text spec: "6 x 70cl x 40% alc" -> 700. */
export function parseVolumeMl(text = '') {
  const s = String(text);
  const re = new RegExp(UNIT_RE.source, 'gi');
  let m;
  while ((m = re.exec(s))) {
    const ml = toMl(m[1], m[2]);
    if (ml) return ml;
  }
  return null;
}

/** Normalise a string into an array of canonical tokens. */
export function tokens(input = '') {
  let s = stripAccents(String(input).toLowerCase());
  s = s.replace(/[’'`]/g, '');           // l'oreal -> loreal, daniel's -> daniels
  s = s.replace(/×/g, 'x');
  s = s.replace(/(\d),(\d{3})\b/g, '$1$2'); // 1,000 -> 1000

  // Explicit units -> canonical ml / g tokens.
  s = s.replace(UNIT_RE, (all, n, unit) => {
    const ml = toMl(n, unit);
    if (ml !== null) return ` ${ml}ml `;
    const g = toG(n, unit);
    if (g !== null) return ` ${g}g `;
    return all;
  });

  // Percentages: "40 %" / "40% alc" -> "40%".
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, ' $1% ');

  // Pack multipliers: "24 x 440ml" -> "24x 440ml"; "24x440" -> "24x 440ml";
  // "6x0.7" -> "6x 700ml". A bare number after "x" is read as ml when it looks
  // like one (>= 100) and as litres when it is a small decimal.
  s = s.replace(/(\d+)\s*x\s*(?=\d)/g, '$1x ');
  s = s.replace(/(\d+x)\s+(\d+(?:\.\d+)?)(?![\d.]*\s*(?:ml|g|%|x))\b/g, (all, pack, n) => {
    const v = parseFloat(n);
    if (n.includes('.') && v < 10) return `${pack} ${Math.round(v * 1000)}ml`;
    if (!n.includes('.') && v >= 100) return `${pack} ${v}ml`;
    return all;
  });

  // A stand-alone small decimal is a litre size in the trade ("0.7" = 70cl).
  s = s.replace(/(^|[^\d.])(\d\.\d{1,2})(?![\d.]*\s*(?:ml|g|%|x))\b/g, (all, pre, n) => {
    const v = parseFloat(n);
    return v < 10 ? `${pre}${Math.round(v * 1000)}ml` : all;
  });

  const out = [];
  for (const raw of s.match(/[a-z0-9%]+/g) || []) {
    let t = raw;
    if (STOP.has(t)) continue;
    t = SYNONYMS[t] || t;
    t = stem(t);
    if (STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** Normalised text (tokens joined by a single space). */
export function normalise(input = '') {
  return tokens(input).join(' ');
}
