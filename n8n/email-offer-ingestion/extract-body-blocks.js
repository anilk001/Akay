/**
 * n8n Code node — "Extract Body Blocks"
 * Workflow: Email Body Offer Ingestion — Akay (8oPUD8d9NPVBEime)
 * Mode: Run Once for Each Item
 *
 * Pulls offer content out of an EMAIL BODY, as opposed to an attachment.
 *
 * Emits blocks of two shapes, because supplier emails come in both:
 *
 *   table   — a grid, from an HTML <table> or from delimited plain text.
 *             Bluebird, Brockagh, Rio Mare, Fairy, the drinks list.
 *   labels  — vertical "Label: value" pairs describing ONE product.
 *             Marco Polo writes offers this way; there is no table at all.
 *
 * It also returns the surrounding PROSE, which is not decoration. These emails
 * routinely state offer-wide terms in sentences around the grid rather than in
 * columns — "Terms: T2 | EXW Loendersloot", "Lead Time: Approximately 2 weeks",
 * "MOQ 1 pallet/line", "This is ex-works Virginia". A parser that reads only
 * the table silently drops the incoterm, the warehouse and the lead time.
 *
 * Signature blocks are removed first. Brockagh's footer carries a street
 * address and two phone numbers, which is exactly the kind of thing a
 * delimited-text reader will happily treat as a data row.
 */

const item = $input.item.json;

// ── The attachment always wins ──────────────────────────────────────────────
// An email may carry BOTH a spreadsheet and a summary table in the body. The
// spreadsheet is authoritative — it is the full list, while the body is
// usually an excerpt — so the body is not parsed when one is present. Without
// this, the Excel workflow and this one both ingest the same offer.
const SPREADSHEET = /\.(xlsx|xlsm|xltx|xls|csv|tsv)$/i;
const attached = Object.values($input.item.binary || {})
  .map((b) => String(b.fileName || ''))
  .filter((n) => SPREADSHEET.test(n));

if (attached.length) {
  return { json: { ...item, blocksFound: 0, blocks: [], prose: '',
    skipReason: `Spreadsheet attached (${attached.join(', ')}) — the Excel workflow handles this email` } };
}

const html = String(item.bodyHtml || item.html || '');
const plain = String(item.bodyPlain || item.text || item.body || item.snippet || '');

const source = html || plain;
if (!source.trim()) {
  return { json: { ...item, blocksFound: 0, blocks: [], prose: '',
    exceptionReason: 'Email body is empty' } };
}

// ── 1. Trim quoted history and the signature ────────────────────────────────
const asText = html ? htmlToText(html) : plain;
const trimmed = stripSignature(stripQuoted(asText));

// ── 1b. Who actually sent the offer ─────────────────────────────────────────
// Offers arrive FORWARDED into offers@akay.ie, so the envelope sender is
// always the forwarder, not the supplier. Keying profiles on it would match
// one address for every supplier in the business. The real sender sits in the
// forwarded header block.
const forwarded = forwardedSender(asText);
const envelope = extractEmail(item.from || item.fromAddress || '');
const effective = forwarded || envelope;

// ── 2. Tables ───────────────────────────────────────────────────────────────
const blocks = [];

if (html) {
  // Scan only the forwarded portion. Everything before the marker is the
  // forwarder's own message, and an email signature is itself built from
  // <table> for layout — left in, it is extracted as a two-column price list.
  //
  // mergeStackedRows runs first: a list the sender's mail builder split into
  // one <table> per line is one list, and every piece of it is a single row.
  // Without the rejoin each piece falls under the `>= 2` bar and is dropped.
  for (const grid of mergeStackedRows(htmlTables(afterForward(html)))) {
    if (grid.length >= 2) blocks.push({ type: 'table', rows: grid });
  }
}

// Plain-text grids. Only attempted when HTML yielded nothing, so a well-formed
// HTML table is never also parsed a second time from its text rendering.
if (blocks.length === 0) {
  for (const grid of textTables(trimmed)) {
    if (grid.length >= 2) blocks.push({ type: 'table', rows: grid });
  }
}

// ── 3. Label:value blocks ───────────────────────────────────────────────────
// Only when no table was found. An email with a grid may still contain
// "Lead Time: 2 weeks" lines, and those are offer-wide prose, not a product.
if (blocks.length === 0) {
  const labels = labelValueBlock(trimmed);
  if (labels) blocks.push({ type: 'labels', ...labels });
}

return {
  json: {
    ...item,
    blocksFound: blocks.length,
    blocks,
    // Handed to the profile so offer-wide terms can be lifted from sentences.
    //
    // Grid lines are removed first. Left in, the table's own column headings
    // are read as prose: a "MOQ" heading matches the MOQ rule and captures the
    // rest of the header row ("HS Code / Inner / Outer") as the offer-wide
    // minimum order. Harmless when MOQ is also mapped per row, since the row
    // value wins — silently wrong when it is not.
    prose: proseOnly(trimmed).slice(0, 8000),
    fromAddress: effective,
    senderDomain: (effective.split('@')[1] || ''),
    envelopeFrom: envelope,
    forwardedFrom: forwarded,
    // True when the supplier was recovered from a forwarded header rather than
    // the envelope. Useful when a profile fails to match and someone is
    // working out why.
    senderFromForward: Boolean(forwarded),
    exceptionReason: blocks.length ? null
      : 'No table or label:value block found in the email body',
  },
};

// ── helpers ──────────────────────────────────────────────────────────────────

/** HTML from the forwarded marker onward, or all of it when not a forward. */
function afterForward(src) {
  const m = src.match(/-{2,}\s*(?:Forwarded|Original)\s*message\s*-{2,}/i)
         || src.match(/Begin forwarded message:/i);
  return m && m.index !== undefined ? src.slice(m.index) : src;
}

/**
 * A layout table used for a signature, not a price list. Signatures carry
 * contact links and images; offer tables carry neither.
 */
function isSignatureTable(t) {
  return /<img\b/i.test(t) || /href\s*=\s*["']?(?:tel:|mailto:)/i.test(t);
}

/** Rows of cells from every <table> in the HTML. */
function htmlTables(src) {
  const out = [];
  const tables = src.match(/<table[\s\S]*?<\/table>/gi) || [];

  for (const t of tables) {
    if (isSignatureTable(t)) continue;
    const rows = [];
    for (const tr of t.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(cellText);
      if (cells.some((c) => c !== '')) rows.push(cells);
    }
    if (rows.length) out.push(rows);
  }
  return out;
}

/**
 * Rebuild a price list that the sender's mail builder split into one <table>
 * per line.
 *
 * Brevo, Mailchimp and Outlook stack content blocks, and a supplier who types
 * each offer line into its own block ships a list where every row is a
 * separate one-row <table>. Read table by table, each of those is a single row
 * and falls under the `>= 2` bar in section 2. Epic's 13-line ExW New Corp
 * list arrived on 2026-09-09 and again on 2026-09-16 as ten one-row tables
 * plus one three-row table, so only the three were ever ingested — the other
 * ten were dropped silently, twice.
 *
 * Consecutive grids with the same column count are one list split by markup,
 * so they are joined back into one grid. Column count is the guard because it
 * is what the downstream mapping keys on: grids that disagree on it were never
 * one table. MIN_COLUMNS excludes the layout wrappers these builders also
 * emit — a spacer table is one cell wide, never nine.
 *
 * Two MULTI-row tables are left alone. Those are two real lists, whatever
 * their shape, and fusing them would corrupt suppliers who send a table per
 * category. A run is only rejoined once a single-row table has started it,
 * which is the signature of a split list.
 *
 * A row identical to the grid's first row is dropped on the join, for senders
 * who restate the headings above each block.
 */
function mergeStackedRows(grids) {
  // Declared inside: the node body runs top to bottom and calls this
  // helper long before a `const` down here would be initialised.
  const MIN_COLUMNS = 3;
  const out = [];
  const stacked = []; // parallel to out: was this grid built by rejoining?

  for (const grid of grids) {
    const last = out.length - 1;
    const prev = out[last];
    const cols = columnCount(grid);

    const joinable = Boolean(prev)
      && cols >= MIN_COLUMNS
      && columnCount(prev) === cols
      && (grid.length === 1 || prev.length === 1 || stacked[last]);

    if (joinable) {
      for (const row of grid) {
        if (!sameRow(row, prev[0])) prev.push(row);
      }
      stacked[last] = true;
    } else {
      out.push(grid.slice());
      stacked.push(grid.length === 1);
    }
  }
  return out;
}

/** Widest row in the grid — a trailing spacer row can be narrower. */
function columnCount(grid) {
  return grid.reduce((n, row) => Math.max(n, row.length), 0);
}

function sameRow(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((cell, i) => cell === b[i]);
}

function cellText(cell) {
  return decode(cell.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Grids in plain text. A run of consecutive lines sharing the same delimiter
 * and a consistent column count is treated as one table.
 *
 * Tabs are tried before multi-space, because a tab-delimited line also contains
 * runs of spaces inside product names ("Absolut Blue Original") and splitting
 * on those would shred the row.
 */
function textTables(text) {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  const out = [];
  let current = null;

  for (const line of lines) {
    const cells = splitRow(line);

    if (cells && cells.length >= 2) {
      if (current && current[0].length === cells.length) current.push(cells);
      else { if (current && current.length >= 2) out.push(current); current = [cells]; }
    } else {
      if (current && current.length >= 2) out.push(current);
      current = null;
    }
  }
  if (current && current.length >= 2) out.push(current);
  return out;
}

/**
 * Drop lines that are grid rows, keeping only the sentences around the table.
 * A line that splits into two or more cells is part of the table, not prose.
 */
function proseOnly(text) {
  return text
    .split('\n')
    .filter((line) => {
      const cells = splitRow(line);
      return !(cells && cells.length >= 2);
    })
    .join('\n');
}

function splitRow(line) {
  if (!line.trim()) return null;
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());

  // Two or more spaces as a column break — how pasted grids usually survive.
  const parts = line.split(/ {2,}/).map((c) => c.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

/**
 * "Label: value" lines describing a single product.
 *
 * Returns the labels as a header row and the values as one data row, so the
 * SAME downstream mapping applies — a profile maps a field to a column index
 * either way, and nothing after this node needs to know which shape it was.
 */
function labelValueBlock(text) {
  const labels = [];
  const values = [];
  let title = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = line.match(/^([A-Za-z][A-Za-z0-9 \/&().'-]{1,40}?)\s*:\s*(.+)$/);
    if (!m) {
      // A line ending in a colon with nothing after it is a heading. Keep the
      // LAST one seen before the pairs begin, not the first: these emails open
      // with a prose lead-in that also ends in a colon ("Please see the
      // following offers for ...:"), and the product heading sits below it,
      // directly above the values it describes.
      if (labels.length === 0 && /:$/.test(line) && line.length > 8) {
        title = line.replace(/:$/, '').trim();
      }
      continue;
    }

    const label = m[1].trim();
    const value = m[2].trim();

    // Contact-detail labels are not product attributes.
    if (/^(tel|fax|mobile|office|email|e-?mail|phone|web|www|http)/i.test(label)) continue;

    labels.push(label);
    values.push(value);
  }

  if (labels.length < 2) return null;

  if (title) { labels.unshift('Product'); values.unshift(title); }
  return { rows: [labels, values], title };
}

/**
 * Separate the message we care about from the surrounding conversation.
 *
 * A FORWARD and a REPLY need opposite treatment, and getting it backwards
 * deletes the offer:
 *
 *   forward — the offer is what follows the marker. Everything BEFORE it is
 *             the forwarder's own signature and covering note, so drop that.
 *   reply   — the offer, if any, is what precedes the marker. Everything
 *             after is the earlier message, so drop that.
 *
 * The previous version treated a bare "From:" line as a reply marker, which
 * cut at the forwarded header and removed the entire forwarded offer.
 */
function stripQuoted(text) {
  const fwd = text.match(/^-{2,}\s*Forwarded message\s*-{2,}\s*$/im)
           || text.match(/^-{2,}\s*Original Message\s*-{2,}\s*$/im)
           || text.match(/^\s*Begin forwarded message:\s*$/im);

  let body = text;
  if (fwd && fwd.index !== undefined) {
    // Skip past the forwarded header block (From/Date/Subject/To lines).
    const after = body.slice(fwd.index + fwd[0].length);
    const headerEnd = after.search(/\n\s*\n/);
    body = headerEnd >= 0 ? after.slice(headerEnd) : after;
  }

  const reply = body.match(/^\s*On .+ wrote:\s*$/m) || body.match(/^_{5,}\s*$/m);
  return reply && reply.index !== undefined ? body.slice(0, reply.index) : body;
}

/**
 * The supplier's address from a forwarded header block. Taken only from the
 * lines directly under the forward marker, so a mailto: elsewhere in the body
 * cannot be mistaken for the sender.
 */
function forwardedSender(text) {
  const fwd = text.match(/^-{2,}\s*(?:Forwarded|Original)\s*message\s*-{2,}\s*$/im)
           || text.match(/^\s*Begin forwarded message:\s*$/im);
  if (!fwd || fwd.index === undefined) return null;

  const header = text.slice(fwd.index, fwd.index + 600);
  const m = header.match(/^\s*From:\s*.*?([^\s<>"]+@[^\s<>"]+\.[a-z]{2,})/im);
  if (!m) return null;

  const addr = m[1].toLowerCase().replace(/[.,;>]+$/, '');
  // A forward of our own mail is not a supplier.
  return /@akay\.ie$/i.test(addr) ? null : addr;
}

/**
 * Drop the sign-off and everything after it. Supplier footers carry street
 * addresses and phone numbers that a delimited-text reader treats as rows.
 */
function stripSignature(text) {
  const re = /^\s*(kind regards|best regards|regards|many thanks|thanks and regards|br|yours (sincerely|faithfully))\s*[,.]?\s*$/im;
  const m = text.match(re);
  return m && m.index !== undefined ? text.slice(0, m.index) : text;
}

function htmlToText(src) {
  return decode(
    src
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^>]+>/g, '')
  ).replace(/[ \t]+\n/g, '\n');
}

function decode(s) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£' };
  return String(s)
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

function extractEmail(raw) {
  const m = String(raw).match(/<([^>]+)>/);
  return (m ? m[1] : String(raw)).trim().toLowerCase();
}
