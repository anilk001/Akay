/**
 * n8n Code node — "Compose Email"
 * Mode: Run Once for All Items
 *
 * The FINAL body for this dispatch. Takes what "Compose From Fields" built
 * from the public Airtable fields and, when the offer carries hand-written
 * Approved Offer Text, uses that instead.
 *
 * WHY IT HOLDS THIS NAME. Render HTML, Verify HTML and Build Approval Email
 * all read $('Compose Email') by name rather than taking their input from the
 * chain, and n8n does not rewrite a name inside Code node source when a node
 * is renamed. So the node that decides the final body has to be the one
 * called "Compose Email" — which is also simply true: the template composer
 * upstream is now "Compose From Fields", which is what it does.
 *
 * THE PROBLEM IT SOLVES (issue 8, 2026-09-14).
 * Compose From Fields rebuilds the body on EVERY run — from Public Product
 * Description, Price Display, Public Note, Public Terms and so on. There was
 * no field anywhere on Offers holding an approved body, and the approval step
 * is a GET link (?approved=true) with no way to send text back. So an edited
 * wording was not lost in transit and not mangled by a second template: it was
 * never read. Meanwhile the one-shot sends push raw verbatim text with no
 * template at all, which is why the two never matched.
 *
 * HOW IT FIXES IT. Offers.Approved Offer Text is the one string. When it is
 * set it becomes bodyTemplate here, and everything downstream already keys off
 * bodyTemplate: Render HTML renders it, Verify HTML proves the HTML did not
 * add or drop a single number or word against it, Build Approval Email shows
 * it, Build Sends sends it. One string, one approval, one email.
 *
 * WHEN THE FIELD IS EMPTY nothing changes. This is purely additive, so the
 * composed path is exactly what it was before.
 *
 * TWO THINGS IT WILL NOT LET A HAND-WRITTEN BODY DO:
 *   - drop the unsubscribe sentence. It is a legal requirement on a bulk
 *     commercial send, and it is exactly the kind of line that disappears
 *     while tightening up wording. Re-appended when absent.
 *   - carry an unknown {{{placeholder}}}. Only FIRST_NAME is ever substituted,
 *     so anything else reaches a client verbatim. Build Sends does throw on
 *     that — but it throws PART WAY THROUGH the send loop, after some clients
 *     already have the mail. Halting here happens before the approval email is
 *     even built.
 */

const UNSUBSCRIBE_TEXT = 'To stop receiving offers, reply with "unsubscribe".';

const composed = ($input.first() || {}).json || {};

// Compose From Fields already refused — a required field was empty, the leak
// guard tripped, or no gate-passed offer arrived. Pass its reason through.
if (composed.composed !== true) {
  return [{ json: composed }];
}

let approved = '';
try {
  const passed = $('Gate Check').all().map((i) => i.json).filter((g) => g.gatePassed);
  const primary = passed.find((g) => g.offerId === composed.offerId) || passed[0] || null;
  const fields = (primary && primary.offerFields) || {};
  approved = String(fields['Approved Offer Text'] ?? '').trim();
} catch (e) {
  approved = '';
}

if (!approved) {
  return [{ json: { ...composed, approvedTextUsed: false } }];
}

// An optional leading "Subject: ..." line overrides the composed subject, so
// the whole email can be written in one field rather than two.
let subject = composed.subject;
let body = approved;
const firstLine = body.split('\n', 1)[0];
const subjectMatch = firstLine.match(/^\s*Subject\s*:\s*(.+?)\s*$/i);
if (subjectMatch) {
  subject = subjectMatch[1];
  body = body.slice(firstLine.length).replace(/^\n+/, '');
}

if (!body.trim()) {
  return [{ json: { composed: false, haltReason: 'Approved Offer Text contains only a Subject line and no body.' } }];
}

const unknown = `${subject}\n${body}`.match(/\{\{\{(?!FIRST_NAME)[^}]*\}\}\}/g);
if (unknown) {
  return [{ json: {
    composed: false,
    haltReason: `Approved Offer Text contains placeholder(s) nothing will substitute, and they would be sent verbatim: ${[...new Set(unknown)].join(', ')}. Only {{{FIRST_NAME|there}}} is supported.`,
  } }];
}

// Compare on letters and digits alone, so a reworded or re-punctuated
// unsubscribe line still counts as present and is not duplicated.
const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
if (!squash(body).includes('unsubscribe')) {
  body = `${body}\n\n${UNSUBSCRIBE_TEXT}`;
}

console.log(`Compose Email: using the hand-written Approved Offer Text for offer ${composed.offerId} (${body.length} chars)${subjectMatch ? ', subject overridden' : ''}.`);

return [{ json: {
  ...composed,
  subject,
  bodyTemplate: body,
  approvedTextUsed: true,
  noteLinesDropped: 0,
} }];

