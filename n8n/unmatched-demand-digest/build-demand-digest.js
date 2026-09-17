/**
 * n8n Code node — "Build Demand Digest"
 * Workflow: Unmatched Demand Digest — Akay (weekly, Monday 07:30)
 * Mode: Run Once for All Items
 *
 * WHY THIS NODE EXISTS AT ALL.
 * Every line we cannot price is a customer telling us what to source, with a
 * name attached. That is the most valuable thing the Instant Quote tool
 * produces and the only one nobody was reading: the buyer downloaded a file
 * with gaps in it, and the gaps went nowhere. A brand asked for by four
 * different buyers in one week is a purchase order waiting to be written; the
 * same fact noticed a year later is a customer who stopped asking.
 *
 * INPUT: `Wanted` rows created in the last 28 days, straight from the Airtable
 * node — either `{ fields: {...} }` or already flattened. Fields read:
 *
 *   Brand, Product Name, Variant   what they asked for
 *   Volume ML, Category            how it groups
 *   Qty, Qty Unit                  how much
 *   Target Price, Currency         what they expect to pay
 *   Bond/Customs Status            T1 / T2 / Bonded — a different product
 *   Client, Client Name (Cache)    who is waiting  (INTERNAL ONLY, see below)
 *   Match Count, Status            whether the matcher ever found it
 *   Source, Created Date           where it came from, and when
 *
 * Twenty-eight days rather than seven, from one query: a brand asked for three
 * weeks running is a standing order being placed somewhere else, and that is
 * not visible in a seven-day window. The digest reports on the last 7 days and
 * uses the other 21 only to mark what is not new.
 *
 * OUTPUT: one item — subject, text and html for the email to Anil and Annika,
 * plus `stats` and the ranked `groups` so the numbers can be asserted in a
 * test or charted later.
 *
 * WHAT MAY LEAVE THIS EMAIL.
 * The Wanted table's own rule: "INTERNAL ONLY: never public, never
 * supplier-visible; supplier demand reports aggregate by Brand/Volume/Bond
 * only (no client names or target prices)." So this node renders two things:
 * the internal brief, which names clients and prints their targets, and a
 * `supplierSafe` block that is brand, size, bond and quantity and nothing
 * else. The second is the only part that may be forwarded to a supplier, and
 * it is built by dropping fields rather than by remembering not to paste them.
 */

// How far back the Airtable node is asked to look, and the reporting window
// inside it. Change the filter formula in the README if you change DAYS_BACK.
const DAYS_BACK = 28;
const REPORT_DAYS = 7;

// Longest list worth reading over coffee. The rest are counted, not listed.
const MAX_GROUPS = 20;
const MAX_CLIENTS = 15;

// A group asked for by this many distinct buyers is a sourcing decision
// rather than one buyer's shopping list.
const MULTI_BUYER = 2;

const rows = $input.all().map((i) => flatten((i && i.json) || {}));

// n8n hands us Luxon; one call is all we need, and a plain ISO string is far
// easier to fake in a test than a DateTime.
const today = typeof $now !== 'undefined' && $now && $now.toISODate ? $now.toISODate() : '';
const reportFrom = addDays(today, -REPORT_DAYS);
const windowFrom = addDays(today, -DAYS_BACK);

const stats = {
  rows: 0,              // Wanted rows created in the reporting window
  unmatched: 0,         // …that the matcher never found stock for
  matched: 0,
  coverage: 0,          // % of this week's demand we could match
  groups: 0,            // distinct products behind the unmatched rows
  clientsWaiting: 0,
  fromInstantQuote: 0,  // how much of it the quote tool produced
};

// key -> group
const groups = new Map();

for (const row of rows) {
  const created = isoDate(row['Created Date'] || row.Created || '');
  // A row with no usable date cannot be placed in either window. Counting it
  // as "this week" would inflate the headline every time Airtable returns
  // something odd, so it is skipped and the coverage figure stays honest.
  if (!created || created < windowFrom) continue;

  const thisWeek = created >= reportFrom;
  if (thisWeek) stats.rows++;

  if (!isUnmatched(row)) {
    if (thisWeek) stats.matched++;
    continue;
  }
  if (thisWeek) {
    stats.unmatched++;
    if (isInstantQuote(row)) stats.fromInstantQuote++;
  }

  const g = groupFor(row);
  if (thisWeek) {
    g.count++;
    g.qty += num(row.Qty);
    const unit = str(row['Qty Unit']);
    if (unit) g.units.add(unit);
    const client = clientName(row);
    if (client) g.clients.add(client);
    const target = num(row['Target Price']);
    if (target > 0) g.targets.push({ value: target, currency: str(row.Currency) || 'EUR' });
    // The buyer's own wording, but only when it says more than the label
    // already does — "as written: Hennessy VS" under "Hennessy VS" is noise.
    const asked = str(row['Product Name']) || str(row.Variant);
    if (asked && asked !== g.brand && g.examples.length < 3 && !g.examples.includes(asked)) {
      g.examples.push(asked);
    }
    if (!g.lastAsked || created > g.lastAsked) g.lastAsked = created;
  } else {
    // Only used to decide whether this week's ask is a repeat.
    g.priorCount++;
  }
  if (!g.firstAsked || created < g.firstAsked) g.firstAsked = created;
}

stats.coverage = pct(stats.matched, stats.rows);

// Groups with nothing in the reporting window exist only because they were
// asked for earlier; they are not this week's brief.
const ranked = [...groups.values()]
  .filter((g) => g.count > 0)
  .map((g) => ({
    label: g.label,
    brand: g.brand,
    size: g.size,
    bond: g.bond,
    category: g.category,
    count: g.count,
    buyers: g.clients.size,
    clients: [...g.clients].sort(),
    qty: Math.round(g.qty),
    units: [...g.units].sort().join(' / '),
    target: summariseTargets(g.targets),
    examples: g.examples,
    repeat: g.priorCount > 0,
    priorCount: g.priorCount,
    firstAsked: g.firstAsked,
    lastAsked: g.lastAsked,
  }))
  // Distinct buyers first: four buyers asking once each is a market, one buyer
  // asking four times is an account. Then volume, then how recently.
  .sort((a, b) =>
    b.buyers - a.buyers ||
    b.count - a.count ||
    b.qty - a.qty ||
    a.label.localeCompare(b.label));

stats.groups = ranked.length;

// Who is waiting on us, and for what. Internal only.
const waiting = new Map();
for (const g of ranked) {
  for (const c of g.clients) {
    const w = waiting.get(c) || { client: c, items: [] };
    if (w.items.length < 6) w.items.push(g.label);
    waiting.set(c, w);
  }
}
const clientsWaiting = [...waiting.values()].sort((a, b) => b.items.length - a.items.length || a.client.localeCompare(b.client));
stats.clientsWaiting = clientsWaiting.length;

// The only part of this email that may be forwarded to a supplier: brand,
// size, bond status and quantity. No client, no target price, no count of who
// asked — that last one tells a supplier how badly we need it.
const supplierSafe = ranked.slice(0, MAX_GROUPS).map((g) => ({
  brand: g.brand,
  size: g.size,
  bond: g.bond,
  qty: g.qty,
  units: g.units,
}));

return [{ json: {
  subject: `Akay buying brief — ${stats.unmatched} unsourced ask${stats.unmatched === 1 ? '' : 's'} from ${stats.clientsWaiting} buyer${stats.clientsWaiting === 1 ? '' : 's'}, match rate ${stats.coverage}%`,
  stats,
  groups: ranked,
  clientsWaiting,
  supplierSafe,
  text: renderText(stats, ranked, clientsWaiting, supplierSafe),
  html: renderHtml(stats, ranked, clientsWaiting, supplierSafe),
} }];

// ── Grouping ────────────────────────────────────────────────────────────────

/**
 * One product, however it was typed. Brand and volume come from the Wanted
 * row's own structured fields — the extractor normalised them once, at
 * capture, so this node never re-parses free text. Bond status is part of the
 * key on purpose: the same brand T1 and T2 are two different things to buy.
 */
function groupFor(row) {
  const brand = str(row.Brand);
  const ml = num(row['Volume ML']);
  const size = volumeLabel(ml);
  const bond = str(row['Bond/Customs Status']);
  const category = str(row.Category);
  // With no brand the product name is all we have; it is at least consistent
  // for a buyer who asks the same way twice.
  const base = brand || str(row['Product Name']) || '(unnamed)';
  const key = [base.toLowerCase(), ml || '', bond.toLowerCase()].join('|');

  let g = groups.get(key);
  if (!g) {
    g = {
      label: [base, size, bond && bond !== 'Either' ? bond : ''].filter(Boolean).join(' · '),
      brand: base, size, bond, category,
      count: 0, priorCount: 0, qty: 0,
      clients: new Set(), units: new Set(), targets: [], examples: [],
      firstAsked: '', lastAsked: '',
    };
    groups.set(key, g);
  }
  return g;
}

/**
 * `Wanted.Source` has no "Instant Quote" option today — its choices are
 * Enquiry, Digest Link, WhatsApp, Email and Manual — so the extractor stamps
 * the origin into `Trader Notes` instead of writing a value the base would
 * reject. Add the option in Airtable and the first test here starts matching
 * on its own; nothing needs changing in this file.
 */
function isInstantQuote(row) {
  return /instant quote/i.test(str(row.Source)) || /instant quote/i.test(str(row['Trader Notes']));
}

/**
 * Unmatched means the matcher never found stock for it. `Match Count` is what
 * the Wanted Matcher writes, so it is the primary signal; Status is the
 * fallback for a row a human moved on by hand.
 */
function isUnmatched(row) {
  if (num(row['Match Count']) > 0) return false;
  const status = str(row.Status);
  return !['Matched', 'Offered', 'Won'].includes(status);
}

/** "€12.50–14.00" across the buyers who stated a target, or '' if none did. */
function summariseTargets(targets) {
  if (!targets.length) return '';
  const byCurrency = new Map();
  for (const t of targets) {
    const list = byCurrency.get(t.currency) || [];
    list.push(t.value);
    byCurrency.set(t.currency, list);
  }
  return [...byCurrency.entries()]
    .map(([currency, values]) => {
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      return lo === hi ? `${currency} ${money(lo)}` : `${currency} ${money(lo)}–${money(hi)}`;
    })
    .join(', ');
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderText(st, gs, waits, safe) {
  const L = [];
  L.push('AKAY BUYING BRIEF — WHAT WE COULD NOT SUPPLY');
  L.push(`Last ${REPORT_DAYS} days` + (today ? ` to ${today}` : ''));
  L.push('');
  L.push(`Demand captured       ${st.rows}`);
  L.push(`  Matched to stock    ${st.matched} (${st.coverage}%)`);
  L.push(`  Unsourced           ${st.unmatched}`);
  L.push(`  via Instant Quote   ${st.fromInstantQuote}`);
  L.push(`Distinct products     ${st.groups}`);
  L.push(`Buyers waiting        ${st.clientsWaiting}`);
  L.push('');

  if (!gs.length) {
    L.push('Nothing went unsourced this week. Every line we were asked for matched stock.');
    return L.join('\n');
  }

  L.push(`WHAT TO SOURCE (${gs.length} product${gs.length === 1 ? '' : 's'}, most-asked first)`);
  L.push('Ranked by how many different buyers asked, not how many times.');
  L.push('');
  for (const g of gs.slice(0, MAX_GROUPS)) {
    const flags = [];
    if (g.buyers >= MULTI_BUYER) flags.push(`${g.buyers} buyers`);
    if (g.repeat) flags.push(`asked before (${g.priorCount}x in the prior ${DAYS_BACK - REPORT_DAYS} days)`);
    L.push(`  ${g.label}`);
    L.push(`      ${g.count} ask${g.count === 1 ? '' : 's'}${flags.length ? ' — ' + flags.join(', ') : ''}`);
    if (g.qty) L.push(`      wanted: ${g.qty}${g.units ? ' ' + g.units : ''}`);
    if (g.target) L.push(`      target: ${g.target}`);
    L.push(`      asked by: ${g.clients.length ? g.clients.join(', ') : '(unattributed)'}`);
    if (g.examples.length) L.push(`      as written: ${g.examples.join(' / ')}`);
    L.push('');
  }
  if (gs.length > MAX_GROUPS) L.push(`  ... and ${gs.length - MAX_GROUPS} more`);
  L.push('');

  if (waits.length) {
    L.push('BUYERS WAITING ON US');
    L.push('');
    for (const w of waits.slice(0, MAX_CLIENTS)) {
      L.push(`  ${w.client} — ${w.items.join('; ')}`);
    }
    if (waits.length > MAX_CLIENTS) L.push(`  ... and ${waits.length - MAX_CLIENTS} more`);
    L.push('');
  }

  L.push('---');
  L.push('SAFE TO FORWARD TO A SUPPLIER (no buyer names, no target prices)');
  L.push('');
  for (const s of safe) {
    L.push(`  ${[s.brand, s.size, s.bond && s.bond !== 'Either' ? s.bond : ''].filter(Boolean).join(' · ')}` +
      (s.qty ? ` — ${s.qty}${s.units ? ' ' + s.units : ''}` : ''));
  }
  L.push('');
  L.push('Everything above that line is internal. The Wanted table is never public and never supplier-visible.');
  return L.join('\n');
}

function renderHtml(st, gs, waits, safe) {
  const H = [];
  H.push('<h2>Akay buying brief — what we could not supply</h2>');
  H.push(`<p style="color:#666;margin-top:-8px">Last ${REPORT_DAYS} days${today ? ` to ${esc(today)}` : ''}</p>`);
  H.push('<table cellpadding="4" style="border-collapse:collapse">');
  H.push(kv('Demand captured', st.rows));
  H.push(kv('Matched to stock', `${st.matched} (${st.coverage}%)`));
  H.push(kv('Unsourced', st.unmatched));
  H.push(kv('via Instant Quote', st.fromInstantQuote));
  H.push(kv('Distinct products', st.groups));
  H.push(kv('Buyers waiting', st.clientsWaiting));
  H.push('</table>');

  if (!gs.length) {
    H.push('<p>Nothing went unsourced this week. Every line we were asked for matched stock.</p>');
    return H.join('\n');
  }

  H.push(`<h3>What to source (${gs.length})</h3>`);
  H.push('<p style="color:#666">Ranked by how many different buyers asked, not how many times.</p>');
  H.push('<table cellpadding="6" style="border-collapse:collapse" border="1">');
  H.push('<tr><th align="left">Product</th><th align="right">Buyers</th><th align="right">Asks</th><th align="right">Qty</th><th align="left">Target</th><th align="left">Asked by</th></tr>');
  for (const g of gs.slice(0, MAX_GROUPS)) {
    const label = esc(g.label) + (g.repeat ? ' <span style="color:#B4231F">· repeat</span>' : '');
    H.push(`<tr><td>${label}${g.examples.length ? `<br><span style="color:#888;font-size:12px">${esc(g.examples.join(' / '))}</span>` : ''}</td>` +
      `<td align="right"><b>${g.buyers}</b></td>` +
      `<td align="right">${g.count}</td>` +
      `<td align="right">${g.qty ? esc(g.qty + (g.units ? ' ' + g.units : '')) : '—'}</td>` +
      `<td>${esc(g.target || '—')}</td>` +
      `<td>${esc(g.clients.join(', ') || '(unattributed)')}</td></tr>`);
  }
  H.push('</table>');
  if (gs.length > MAX_GROUPS) H.push(`<p>… and ${gs.length - MAX_GROUPS} more.</p>`);

  if (waits.length) {
    H.push('<h3>Buyers waiting on us</h3><ul>');
    for (const w of waits.slice(0, MAX_CLIENTS)) {
      H.push(`<li><b>${esc(w.client)}</b> — ${esc(w.items.join('; '))}</li>`);
    }
    H.push('</ul>');
    if (waits.length > MAX_CLIENTS) H.push(`<p>… and ${waits.length - MAX_CLIENTS} more.</p>`);
  }

  H.push('<hr>');
  H.push('<h3>Safe to forward to a supplier</h3>');
  H.push('<p style="color:#666">Brand, size, bond and quantity only — no buyer names, no target prices.</p>');
  H.push('<ul>');
  for (const s of safe) {
    const label = [s.brand, s.size, s.bond && s.bond !== 'Either' ? s.bond : ''].filter(Boolean).join(' · ');
    H.push(`<li>${esc(label)}${s.qty ? ` — ${esc(s.qty + (s.units ? ' ' + s.units : ''))}` : ''}</li>`);
  }
  H.push('</ul>');
  H.push('<p style="color:#666">Everything above this line is internal. The Wanted table is never public and never supplier-visible.</p>');
  return H.join('\n');
}

function kv(label, value) {
  return `<tr><td>${esc(label)}</td><td align="right"><b>${esc(value)}</b></td></tr>`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Airtable hands back `{ fields: {...} }`; a Set node may already have flattened it. */
function flatten(json) {
  if (json && typeof json.fields === 'object' && json.fields !== null) return { ...json.fields };
  return json;
}

/**
 * Who asked. Three places, because none of them is reliable on its own:
 *
 *   1. `Client Name (Cache)` — Enquiries has one, `Wanted` does NOT (schema
 *      read 2026-09-17). Kept first because adding a lookup column of that
 *      name to Wanted is the clean fix, and this then uses it with no edit.
 *   2. The `Client` link — an array of record ids over the REST API, of names
 *      only when the n8n node is set to resolve them. Ids are dropped: nobody
 *      can read "recXXXXXXXXXXXXXX" in a Monday email.
 *   3. The `Buyer:` line the Instant Quote extractor stamps into Trader Notes,
 *      which is the only name guaranteed to be there for a quote-tool row.
 *
 * Counting distinct buyers is what ranks this whole digest, so a row that
 * names nobody is worth less than one that does — but it is still demand, and
 * it still gets counted as an ask.
 */
function clientName(row) {
  const cached = str(row['Client Name (Cache)']);
  if (cached) return cached;

  const link = row.Client;
  if (Array.isArray(link)) {
    const names = link
      .map((v) => (v && typeof v === 'object' ? str(v.name) : str(v)))
      .filter((v) => v && !/^rec[A-Za-z0-9]{14}$/.test(v));
    if (names.length) return names.join(', ');
  }

  const stamped = str(row['Trader Notes']).match(/^Buyer:\s*(.+)$/m);
  if (stamped) {
    const name = str(stamped[1]);
    if (name && name.toLowerCase() !== 'unattributed') return name;
  }
  return '';
}

/** Canonical size label: 700 -> "700ml", 1000 -> "1L". Mirrors src/lib/normalise.mjs. */
function volumeLabel(ml) {
  if (!Number.isFinite(ml) || ml <= 0) return '';
  if (ml >= 1000 && ml % 100 === 0) return `${+(ml / 1000).toFixed(2)}L`;
  return `${Math.round(ml)}ml`;
}

/** The date part of an Airtable date or datetime cell, as YYYY-MM-DD. */
function isoDate(v) {
  const s = str(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

/** Date arithmetic on ISO strings, so the node needs no date library. */
function addDays(iso, days) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
// Always two decimals: a range printed as "17.50-19" reads like two
// different kinds of number rather than two prices.
function money(n) { return n.toFixed(2); }
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function esc(v) {
  return String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
