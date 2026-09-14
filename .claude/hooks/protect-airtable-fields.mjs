#!/usr/bin/env node
/**
 * PreToolUse hook: refuse any Airtable write that ticks a HUMAN-ONLY gate.
 *
 * WHY THIS EXISTS AS A HOOK RATHER THAN AN INSTRUCTION.
 * "Listing Approved" has been a written rule since 2026-08-13, and all four
 * ingestion pipelines honour it in code: Excel strips it in "Expand Offers",
 * PDF lists it in READ_ONLY, Email and WhatsApp delete it in "Offers to
 * Create". The Airtable base itself runs no automations. So when the tick
 * reappears within hours of being told not to, the only remaining writer is an
 * assistant calling the Airtable MCP by hand — and an instruction is exactly
 * the control that has already been tried and has already failed, repeatedly.
 * This is the same rule expressed as a thing that cannot be talked out of.
 *
 * WHAT IT COSTS TO GET THIS WRONG. Sell Price falls back to Buy Price when
 * Margin % is blank, and the dispatch leak guard switches itself off when
 * sell equals buy. So "margin missing" plus "Listing Approved ticked" does not
 * fail loudly — it publishes the cost price to akay.ie and mails it to
 * clients. Over a weekend that runs unattended for two days.
 *
 * TICKING IS BLOCKED; UNTICKING IS NOT. Clearing the box is how a mistake gets
 * undone, and pulling an offer off the site is never the dangerous direction.
 *
 * Exit 2 blocks the call and returns stderr to the assistant.
 */

// field name -> is this particular value the dangerous direction?
const GATES = {
  'listing approved': isTruthy,          // the akay.ie website gate
  'send approval status': isApproving,   // Gate 2: the send-to-client gate
};

function isTruthy(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return /^(true|yes|y|1|checked|✓)$/i.test(v.trim());
  return false;
}

function isApproving(v) {
  const s = selectName(v);
  return typeof s === 'string' && /^approved$/i.test(s.trim());
}

function selectName(v) {
  const a = Array.isArray(v) ? v[0] : v;
  if (a === null || a === undefined) return '';
  return typeof a === 'object' ? String(a.name ?? '') : String(a);
}

/**
 * Walk the whole tool_input rather than matching one tool's argument shape.
 * The two Airtable MCP servers disagree about where fields live
 * (`{fields:{...}}`, `{records:[{fields:{...}}]}`, `{recordsToUpdate:[...]}`),
 * and a shape this hook has not seen must not be a way through it.
 */
function findViolations(node, trail, out) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => findViolations(v, `${trail}[${i}]`, out));
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    const gate = GATES[String(key).trim().toLowerCase()];
    if (gate && gate(value)) {
      out.push({ field: key, value, at: trail ? `${trail}.${key}` : key });
    }
    findViolations(value, trail ? `${trail}.${key}` : key, out);
  }
  return out;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }

  const tool = String(payload.tool_name || '');
  // Airtable MCP tools only. Everything else — including editing this repo's
  // own source, which is reviewed — passes straight through.
  if (!/^mcp__[Aa]irtable__/.test(tool)) process.exit(0);
  // Reads cannot tick anything.
  if (/(^|__)(list|get|search|describe|ping|analyze)/i.test(tool.replace(/^mcp__[Aa]irtable__/, ''))) process.exit(0);

  const hits = findViolations(payload.tool_input ?? {}, '', []);
  if (!hits.length) process.exit(0);

  const lines = hits.map((h) => `  • ${h.field} = ${JSON.stringify(h.value)}  (at tool_input.${h.at})`);
  process.stderr.write(
    `Blocked: ${tool} would set a HUMAN-ONLY approval gate.\n` +
    lines.join('\n') + '\n\n' +
    'Listing Approved (the akay.ie website gate) and Send Approval Status ' +
    '(the send-to-client gate) are ticked by Anil or Annika by hand, never by ' +
    'tooling — no exceptions, and not "just this once" because the record ' +
    'looks complete.\n\n' +
    'Why it matters: Sell Price falls back to Buy Price when Margin % is ' +
    'blank, so a ticked listing on a margin-less offer publishes the COST ' +
    'PRICE to akay.ie and mails it to clients.\n\n' +
    'Write every other field, leave these two alone, and tell Anil the offer ' +
    'is ready for his tick. Unticking is allowed.\n'
  );
  process.exit(2);
});
