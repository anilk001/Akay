/**
 * n8n Code node — "Build Sends"
 * Mode: Run Once for All Items
 *
 * SOURCE OF TRUTH: repo .claude/skills/offer-dispatch/n8n/build-sends.js.
 * Edit the repo file, run `node test-nodes.cjs`, then paste — never edit here.
 *
 * Fans the recipient list out into ONE ITEM PER RECIPIENT. Each send carries
 * `offerIds` (the full bundle, or a single-element array for a normal offer)
 * so Reconcile can log and later mark every bundle member.
 *
 * Updated 2026-08-27: sends multipart when Verify HTML approved an HTML body.
 * `text` is ALWAYS present and is the same approved plain text as before, so a
 * client that blocks HTML still gets a complete, readable offer. `html` is
 * added only when verification passed; the placeholder assertion below now
 * covers both bodies, since an unresolved token is just as wrong in markup.
 * The fully-formed Resend payload is built here rather than in the HTTP node's
 * expression so the html key can be omitted cleanly on the text-only path.
 *
 * Updated 2026-09-02: every send now carries `idempotencyKey`, which the HTTP
 * node passes to Resend as the `Idempotency-Key` header. The key is
 * "dispatch:<first offer id>:<client id>", stable across runs, so:
 *   - the node's own 3x retry can never deliver twice on a timeout after
 *     Resend had already accepted the message;
 *   - two overlapping runs of the same group (2026-09-01 had runs 29311 and
 *     29315 in flight at the same time) cannot mail the same client twice;
 *   - a re-queue after a partial send only reaches the clients who did not get
 *     it the first time. Resend keeps a key for 24 hours, so a deliberate
 *     re-send of the same offer to the same client must wait a day.
 * A replayed key returns the original message id, which Reconcile counts as
 * Sent — correct, the client has the email.
 */

const recipients = $('Build Recipients').first().json;
const email = $('Verify HTML').first().json;

if (!email.composed) {
  return [{ json: { halt: true, haltReason: email.haltReason } }];
}

const list = recipients.recipients || [];
if (list.length === 0) {
  return [{ json: { halt: true, haltReason: 'No eligible recipients — nothing to send' } }];
}

const FROM = 'Akay Irl Ltd <offers@akay.ie>';
const offerIds = (email.bundleOfferIds && email.bundleOfferIds.length) ? email.bundleOfferIds : [email.offerId];

const sends = list.map((r) => {
  const subject = resolveFirstName(email.subject, r.firstName);
  const textBody = resolveFirstName(email.bodyTemplate, r.firstName);
  const htmlBody = email.html ? resolveFirstName(email.html, r.firstName) : null;
  const headers = { 'List-Unsubscribe': `<${email.listUnsubscribe}>` };

  const payload = { from: FROM, to: [r.email], subject, text: textBody, headers };
  if (htmlBody) payload.html = htmlBody;

  return {
    json: {
      payload,
      idempotencyKey: idempotencyKeyFor(offerIds[0], r),
      from: FROM,
      to: [r.email],
      subject,
      text: textBody,
      html: htmlBody,
      headers,

      offerId: email.offerId,
      offerIds,
      clientId: r.clientId,
      clientName: r.clientName,
      clientEmail: r.email,
      recipientIndex: list.indexOf(r),
      recipientTotal: list.length,
    },
  };
});

const PLACEHOLDER = /\{\{\{[^}]*\}\}\}/;
const seenKeys = new Set();

for (const s of sends) {
  if (!Array.isArray(s.json.to) || s.json.to.length !== 1) {
    throw new Error(`Send payload for ${s.json.clientName} does not have exactly one recipient`);
  }
  if ('bcc' in s.json.payload || 'cc' in s.json.payload) {
    throw new Error('Send payload contains cc/bcc — one email per recipient is required');
  }
  if (PLACEHOLDER.test(s.json.text) || PLACEHOLDER.test(s.json.subject)) {
    throw new Error(`Unsubstituted placeholder left in message for ${s.json.clientName}`);
  }
  if (s.json.html && PLACEHOLDER.test(s.json.html)) {
    throw new Error(`Unsubstituted placeholder left in the HTML body for ${s.json.clientName}`);
  }
  if (!s.json.payload.text) {
    throw new Error(`Send payload for ${s.json.clientName} has no plain-text body`);
  }
  if (!s.json.idempotencyKey || s.json.idempotencyKey.length > 256) {
    throw new Error(`Idempotency key missing or too long for ${s.json.clientName}`);
  }
  if (seenKeys.has(s.json.idempotencyKey)) {
    throw new Error(`Duplicate idempotency key ${s.json.idempotencyKey} — two sends would collapse into one`);
  }
  seenKeys.add(s.json.idempotencyKey);
}

if (sends.length !== list.length) {
  throw new Error(`Built ${sends.length} sends for ${list.length} recipients`);
}

return sends;

function resolveFirstName(text, firstName) {
  return String(text).replace(/\{\{\{FIRST_NAME(\|[^}]*)?\}\}\}/g, (_m, dflt) => firstName || (dflt ? dflt.slice(1) : 'there'));
}

function idempotencyKeyFor(primaryOfferId, r) {
  // Client id when we have one (stable even if the email is later corrected);
  // the email address only for pilot rows with no Client record. Resend allows
  // up to 256 characters; this is ~45.
  const who = r.clientId || String(r.email || '').toLowerCase();
  return `dispatch:${primaryOfferId}:${who}`.replace(/[^A-Za-z0-9:@._+-]/g, '_');
}
