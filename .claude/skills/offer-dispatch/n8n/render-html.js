/**
 * n8n Code node — "Render HTML"   (Offer Dispatch — Akay, dAYMAj6mZD3hTV4T)
 * Mode: Run Once for All Items
 * Added 2026-09-02, replacing the Anthropic "Style as HTML" node.
 *
 * SOURCE OF TRUTH: repo .claude/skills/offer-dispatch/n8n/render-html.js.
 * Edit the repo file, run `node test-nodes.cjs`, then paste — never edit here.
 *
 * WHY THIS EXISTS. From 2026-08-27 the HTML version of the offer was produced
 * by a call to claude-opus-5. In four working days that one node stopped the
 * dispatch outright three times (`temperature is deprecated` 400 on 28533, then
 * "credit balance is too low" on 29332, 29354 and 29365) and its output failed
 * the verbatim check on two of the four sends that did reach the model
 * (29315: a number the model invented; 29382: a `&middot;` entity). A formatter
 * has no business depending on a metered third-party API, and the approved text
 * has a fixed shape, so it is rendered here deterministically: no credentials,
 * no credits, no network, and the same input always gives the same HTML.
 *
 * CONTRACT — identical to the node it replaces:
 *   - input is the ALREADY-COMPOSED, already leak-checked body from Compose Email
 *   - output is { content: "<html…>" }, which is the shape Verify HTML reads
 *   - it adds NO words, NO numbers, NO links and NO images of its own. Only the
 *     approved text is emitted between tags, HTML-escaped. Verify HTML still runs
 *     after this node and still falls back to plain text if that ever fails.
 *   - the {{{FIRST_NAME|there}}} token is left intact for Build Sends
 *
 * Body shape (from Compose Email): paragraphs separated by blank lines. A
 * paragraph whose first line is free text and whose remaining lines all read
 * "Label: value" is a product block and is rendered as a card with a two-column
 * table. A paragraph made only of "Label: value" lines (Terms / Validity /
 * Lead time) is rendered as a bare two-column table. Everything else is a <p>.
 */

const composed = $('Compose Email').first().json;
const text = String(composed.bodyTemplate || '');

return [{ json: { content: renderHtml(text) } }];

function renderHtml(body) {
  const NAVY = '#1A202C', INK = '#2D3748', MUTED = '#4A5568', LINE = '#E2E8F0', ACCENT = '#2563EB', PAGE = '#F7FAFC';
  const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const LABEL = /^([A-Za-z][A-Za-z ]{1,30}): (.+)$/;

  const paragraphs = String(body).replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => p.replace(/^\n+|\n+$/g, '')).filter(Boolean);

  const parts = paragraphs.map((p) => {
    const lines = p.split('\n');
    const labelled = lines.map((l) => l.match(LABEL));
    const restLabelled = lines.length > 1 && labelled.slice(1).every(Boolean);
    const allLabelled = labelled.every(Boolean);

    if (allLabelled) return factsTable(labelled);
    if (restLabelled && !labelled[0]) return productCard(lines[0], labelled.slice(1));
    return `<p style="margin:0 0 14px 0;">${lines.map(esc).join('<br>')}</p>`;
  });

  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    `<body style="margin:0;padding:0;background:${PAGE};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border:1px solid ${LINE};border-radius:8px;">`,
    `<tr><td style="height:6px;background:${ACCENT};border-radius:8px 8px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>`,
    `<tr><td style="padding:24px 28px 12px 28px;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK};">`,
    parts.join('\n'),
    '</td></tr></table></td></tr></table></body></html>',
  ].join('\n');

  function productCard(title, rows) {
    return [
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;border:1px solid ${LINE};border-radius:6px;">`,
      `<tr><td style="padding:12px 16px;font-family:${FONT};">`,
      `<div style="font-size:16px;font-weight:600;color:${NAVY};margin:0 0 6px 0;">${esc(title)}</div>`,
      rowsTable(rows),
      '</td></tr></table>',
    ].join('');
  }

  function factsTable(rows) {
    return `<div style="margin:0 0 14px 0;font-family:${FONT};">${rowsTable(rows)}</div>`;
  }

  function rowsTable(rows) {
    const trs = rows.map((m) =>
      `<tr><td style="padding:2px 12px 2px 0;color:${MUTED};font-weight:600;white-space:nowrap;vertical-align:top;">${esc(m[1])}</td>` +
      `<td style="padding:2px 0;color:${NAVY};">${esc(m[2])}</td></tr>`
    ).join('');
    return `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.5;">${trs}</table>`;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
}
