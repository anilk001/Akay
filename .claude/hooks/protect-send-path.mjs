#!/usr/bin/env node
/**
 * PreToolUse hook: client-facing email goes through Resend, never Gmail.
 *
 * CLAUDE.md golden rule 6 says every client-facing send goes through Resend
 * from offers@akay.ie. This is that rule as a thing that cannot be talked out
 * of — the same reasoning as protect-airtable-fields.mjs: an instruction is
 * the control that has already been tried, and "sending the offer often does
 * not default to Resend" is what it produced.
 *
 * WHY IT MATTERS. Resend is where the unsubscribe handling, the bounce and
 * complaint suppression (Resend Events Intake), the per-recipient idempotency
 * and the Offers Sent Log all live. An offer that leaves through Gmail has none
 * of them: no suppression, no send log, no List-Unsubscribe header, and a
 * client who has already unsubscribed gets mailed again.
 *
 * WHAT IS BLOCKED — precisely the case in the complaint, no wider:
 *   - Gmail send_message or forward where ANY recipient is outside @akay.ie.
 *
 * WHAT IS DELIBERATELY ALLOWED:
 *   - sending to @akay.ie addresses (an internal note, a test to ak@akay.ie);
 *   - reply — answering a client's enquiry on its own thread is correspondence,
 *     not a send, and blocking it would make the desk unusable;
 *   - drafts — a draft sends nothing;
 *   - every read, label and search.
 *
 * Recipients are gathered from the whole tool_input rather than from one named
 * field, because the connector's argument shape is not something this hook
 * should have to know. Any string shaped like an address counts.
 *
 * Exit 2 blocks the call and returns stderr to the assistant.
 */

const OURS = /@akay\.ie$/i;
const SEND_TOOLS = /^mcp__[Gg]mail__(send_message|forward)$/;
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function addressesIn(node, out, inRecipient = false) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string') {
    if (inRecipient) for (const a of node.match(ADDRESS) || []) out.add(a.toLowerCase());
    return out;
  }
  if (Array.isArray(node)) { node.forEach((v) => addressesIn(v, out, inRecipient)); return out; }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      // Once inside a recipient field, everything beneath it counts — a
      // recipient written as { email: "..." } or { address: "..." } included.
      // Outside one, only descend: the body of an email can legitimately
      // mention a client's address without that address being a recipient.
      const recipientKey = /^(to|cc|bcc|recipients?|recipient_?emails?|to_?emails?)$/i.test(key);
      if (recipientKey || inRecipient) addressesIn(value, out, true);
      else if (typeof value === 'object') addressesIn(value, out, false);
    }
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
  if (!SEND_TOOLS.test(tool)) process.exit(0);

  const recipients = [...addressesIn(payload.tool_input ?? {}, new Set())];
  const external = recipients.filter((a) => !OURS.test(a));
  if (!external.length) process.exit(0);

  process.stderr.write(
    `Blocked: ${tool} would email ${external.length} address(es) outside akay.ie via Gmail:\n` +
    external.map((a) => `  • ${a}`).join('\n') + '\n\n' +
    'Client-facing email goes through Resend from offers@akay.ie — CLAUDE.md rule 6. ' +
    'Gmail has none of the unsubscribe handling, bounce/complaint suppression, ' +
    'per-recipient idempotency or the Offers Sent Log that Resend carries, so an ' +
    'offer sent this way can reach someone who has already unsubscribed.\n\n' +
    'For an offer: set Approved Offer Text on the Offer and let Offer Dispatch send it, ' +
    'or use the Resend tools directly. Replies on a client\'s own thread, drafts, and ' +
    'mail to @akay.ie addresses are not blocked.\n'
  );
  process.exit(2);
});
