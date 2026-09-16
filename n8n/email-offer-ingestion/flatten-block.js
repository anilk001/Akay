/**
 * n8n Code node — "Flatten Block"
 * Workflow: Email Body Offer Ingestion — Akay (8oPUD8d9NPVBEime)
 * Mode: Run Once for Each Item
 *
 * Turns the extracted blocks into the headerCells + dataRows shape the SHARED
 * Normalize Rows / Resolve Body Profile code expects, and stamps the source
 * identifiers the email path never set.
 *
 * Every table block is consumed, not just the first.
 *
 * The previous version took `blocks[0]` "by design", from when a body held one
 * grid. It does not always: a sender whose mail builder splits a list across
 * content blocks produces several, and Extract Body Blocks can also emit one
 * grid per category. Whatever came after the first was dropped here without a
 * trace — no exception, no note, just a short offer count. That is invisible
 * unless someone counts the lines in the original email against Airtable.
 *
 * The LLM path never had this problem: the extractor prompt is handed the
 * whole `blocks` array, which is why Epic's 2026-09-16 re-send still produced
 * three offers rather than two. This node is the DETERMINISTIC path, so the
 * loss would have appeared the moment a column map was filled in for a sender
 * whose list arrives split — turning a profile from "Low confidence, parsed by
 * LLM" into "High confidence" would have quietly cut the offer count.
 *
 * Blocks are appended only when they agree with the first on shape: same block
 * type and same column count. A profile maps a field to a column INDEX, so a
 * grid with different columns cannot be read with the same map, and guessing
 * is worse than leaving it out.
 */
const item = $input.item.json;
const blocks = Array.isArray(item.blocks) ? item.blocks : [];

const tables = blocks.filter((b) => b && Array.isArray(b.rows) && b.rows.length);
const first = tables[0] || null;

let headerCells = [];
let dataRows = [];
const skipped = [];

if (first) {
  headerCells = first.rows[0] || [];
  dataRows = first.rows.slice(1);

  for (const block of tables.slice(1)) {
    const width = (block.rows[0] || []).length;
    if (block.type !== first.type || width !== headerCells.length) {
      skipped.push(`${block.type}/${width} cols`);
      continue;
    }
    for (const row of block.rows) {
      // A sender who restates the headings above each block would otherwise
      // land them in the data.
      if (!sameRow(row, headerCells)) dataRows.push(row);
    }
  }
}

const subject = item.subject || '(no subject)';
return {
  json: {
    ...item,
    headerCells,
    dataRows,
    fileName: `Email: ${subject}`,
    sheetName: first && first.type === 'labels' ? 'Body (labels)' : 'Body',
    sourceMessageId: item.id || item.messageId || item.sourceMessageId || null,
    blockType: first ? first.type : null,
    // Named so a short offer count can be explained without re-running the
    // email. Blank when every block was used.
    blocksMerged: tables.length,
    blocksSkipped: skipped.join('; '),
  },
};

function sameRow(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((cell, i) => cell === b[i]);
}
