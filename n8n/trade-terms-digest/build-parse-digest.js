/**
 * n8n Code node — "Build Parse Digest"
 * Workflow: Trade Terms Exception Digest — Akay (weekly, Monday 07:00)
 * Mode: Run Once for All Items
 *
 * WHY THIS NODE EXISTS AT ALL.
 * Parsing at ingestion stops the problem growing. It does not stop new wording
 * appearing. What prevents the next backfill is noticing new wording the week
 * it starts: a pattern seen 40 times in one week is a five-minute edit to the
 * normaliser, the same pattern found after 18 months is a day of dry runs
 * against live data.
 *
 * INPUT: Offers rows created in the last 7 days, straight from the Airtable
 * node — either `{ fields: {...} }` or already flattened. Fields read:
 *
 *   Parse Status      Clean / Partial / Unrecognised
 *   Parse Notes       what the normaliser could not resolve on that line
 *   MOQ Type          used for the MOQ coverage figure
 *   Lead Time Days    used for the lead-time coverage figure
 *   Supplier Name     to name whose format changed
 *
 * OUTPUT: one item — subject, text and html for the email to Anil and Annika,
 * plus `stats` so the numbers can be asserted in a test or charted later.
 *
 * Supplier names appear in this digest because it is an internal email. They
 * must never travel any further: the site's FIELDS allowlist exists precisely
 * to keep supplier identity out of anything public.
 */

// A supplier over this share of Unrecognised lines has usually changed format.
const SUPPLIER_ALERT_SHARE = 0.5;

// Below this many lines a supplier's percentage is noise, not a signal.
const SUPPLIER_MIN_LINES = 3;

// Longest list worth reading over coffee. The rest are counted, not listed.
const MAX_STRINGS = 25;

const rows = $input.all().map((i) => flatten((i && i.json) || {}));

const stats = {
  lines: rows.length,
  clean: 0,
  partial: 0,
  unrecognised: 0,
  moqResolved: 0,
  leadTimeResolved: 0,
  moqCoverage: 0,
  leadTimeCoverage: 0,
};

// string -> { count, suppliers:Set }
const strings = new Map();
// supplier -> { lines, unrecognised }
const suppliers = new Map();

for (const row of rows) {
  const status = str(row['Parse Status']);
  if (status === 'Clean') stats.clean++;
  else if (status === 'Partial') stats.partial++;
  else if (status === 'Unrecognised') stats.unrecognised++;

  if (str(row['MOQ Type'])) stats.moqResolved++;
  if (row['Lead Time Days'] !== undefined && row['Lead Time Days'] !== null && row['Lead Time Days'] !== '') {
    stats.leadTimeResolved++;
  }

  const supplier = str(row['Supplier Name']) || str(row.Supplier) || '(unknown supplier)';
  const s = suppliers.get(supplier) || { lines: 0, unrecognised: 0 };
  s.lines++;
  if (status === 'Unrecognised') s.unrecognised++;
  suppliers.set(supplier, s);

  for (const phrase of unparsedPhrases(row['Parse Notes'])) {
    const key = phrase.toLowerCase();
    const entry = strings.get(key) || { phrase, count: 0, suppliers: new Set() };
    entry.count++;
    entry.suppliers.add(supplier);
    strings.set(key, entry);
  }
}

stats.moqCoverage = pct(stats.moqResolved, stats.lines);
stats.leadTimeCoverage = pct(stats.leadTimeResolved, stats.lines);

// Distinct unrecognised strings, commonest first — the edit list, in priority order.
const unrecognised = [...strings.values()]
  .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase))
  .map((e) => ({ phrase: e.phrase, count: e.count, suppliers: [...e.suppliers].sort() }));

// Suppliers whose format has probably changed.
const drifting = [...suppliers.entries()]
  .map(([name, s]) => ({ name, lines: s.lines, unrecognised: s.unrecognised, share: s.lines ? s.unrecognised / s.lines : 0 }))
  .filter((s) => s.lines >= SUPPLIER_MIN_LINES && s.share > SUPPLIER_ALERT_SHARE)
  .sort((a, b) => b.share - a.share || b.lines - a.lines);

return [{ json: {
  subject: `Akay trade-terms parsing — ${stats.lines} new lines, MOQ ${stats.moqCoverage}%, lead time ${stats.leadTimeCoverage}%`,
  stats,
  unrecognised,
  drifting,
  text: renderText(stats, unrecognised, drifting),
  html: renderHtml(stats, unrecognised, drifting),
} }];

// ── Rendering ───────────────────────────────────────────────────────────────

function renderText(st, strs, drift) {
  const L = [];
  L.push(`TRADE TERMS PARSING — LAST 7 DAYS`);
  L.push('');
  L.push(`Lines ingested        ${st.lines}`);
  L.push(`  Clean               ${st.clean}`);
  L.push(`  Partial             ${st.partial}`);
  L.push(`  Unrecognised        ${st.unrecognised}`);
  L.push(`MOQ resolved          ${st.moqResolved} (${st.moqCoverage}%)`);
  L.push(`Lead time resolved    ${st.leadTimeResolved} (${st.leadTimeCoverage}%)`);
  L.push('');

  if (!strs.length) {
    L.push('No unrecognised wording this week.');
  } else {
    L.push(`UNRECOGNISED WORDING (${strs.length} distinct)`);
    L.push('Each line below is a candidate pattern for the normaliser.');
    L.push('');
    for (const s of strs.slice(0, MAX_STRINGS)) {
      L.push(`  ${String(s.count).padStart(4)}x  ${s.phrase}`);
      L.push(`        ${s.suppliers.join(', ')}`);
    }
    if (strs.length > MAX_STRINGS) L.push(`  ... and ${strs.length - MAX_STRINGS} more`);
  }
  L.push('');

  if (drift.length) {
    L.push('SUPPLIERS WHOSE FORMAT MAY HAVE CHANGED');
    L.push(`(more than ${Math.round(SUPPLIER_ALERT_SHARE * 100)}% of their lines unrecognised)`);
    L.push('');
    for (const s of drift) {
      L.push(`  ${s.name} — ${s.unrecognised}/${s.lines} lines (${pct(s.unrecognised, s.lines)}%)`);
    }
  }
  return L.join('\n');
}

function renderHtml(st, strs, drift) {
  const H = [];
  H.push('<h2>Trade terms parsing — last 7 days</h2>');
  H.push('<table cellpadding="4" style="border-collapse:collapse">');
  H.push(row('Lines ingested', st.lines));
  H.push(row('Clean', st.clean));
  H.push(row('Partial', st.partial));
  H.push(row('Unrecognised', st.unrecognised));
  H.push(row('MOQ resolved', `${st.moqResolved} (${st.moqCoverage}%)`));
  H.push(row('Lead time resolved', `${st.leadTimeResolved} (${st.leadTimeCoverage}%)`));
  H.push('</table>');

  if (!strs.length) {
    H.push('<p>No unrecognised wording this week.</p>');
  } else {
    H.push(`<h3>Unrecognised wording (${strs.length} distinct)</h3>`);
    H.push('<table cellpadding="4" style="border-collapse:collapse"><tr><th align="right">Seen</th><th align="left">Text</th><th align="left">Supplier</th></tr>');
    for (const s of strs.slice(0, MAX_STRINGS)) {
      H.push(`<tr><td align="right">${s.count}&times;</td><td>${esc(s.phrase)}</td><td>${esc(s.suppliers.join(', '))}</td></tr>`);
    }
    H.push('</table>');
    if (strs.length > MAX_STRINGS) H.push(`<p>… and ${strs.length - MAX_STRINGS} more.</p>`);
  }

  if (drift.length) {
    H.push('<h3>Suppliers whose format may have changed</h3><ul>');
    for (const s of drift) {
      H.push(`<li>${esc(s.name)} — ${s.unrecognised}/${s.lines} lines (${pct(s.unrecognised, s.lines)}%)</li>`);
    }
    H.push('</ul>');
  }
  return H.join('\n');
}

function row(label, value) {
  return `<tr><td>${esc(label)}</td><td align="right"><b>${esc(value)}</b></td></tr>`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * `Parse Notes` is written by the normaliser as note · note · "Unparsed: text".
 * Only the Unparsed segments are wording the parser did not understand; the
 * rest are explanations of decisions it made and would drown the list.
 */
function unparsedPhrases(notes) {
  return str(notes)
    .split('·')
    .map((p) => p.trim())
    .filter((p) => /^unparsed:/i.test(p))
    .map((p) => p.replace(/^unparsed:\s*/i, '').trim())
    .filter(Boolean);
}

/** Airtable hands back `{ fields: {...} }`; a Set node may already have flattened it. */
function flatten(json) {
  if (json && typeof json.fields === 'object' && json.fields !== null) return { ...json.fields };
  return json;
}

function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function esc(v) {
  return String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
