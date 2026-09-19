/**
 * n8n Code node — "Build Sends"  (workflow dAYMAj6mZD3hTV4T, Offer Dispatch — Akay)
 * Mode: Run Once for All Items
 *
 * Emits ONE ITEM PER RESEND BATCH of up to 100 emails — not one item per
 * recipient, which is what it used to do.
 *
 * WHY (execution 50042, 2026-09-14). "Send via Resend" was posting one
 * request per recipient to /emails, paced by the node's own batching at
 * batchSize 2 / batchInterval 1100ms. For the 2,412-recipient Elizabeth Arden
 * dispatch that is 1,206 batches x 1.1s = 22 minutes of pure pacing, against a
 * workflow executionTimeout of 1800s. All 2,412 emails were accepted
 * ("_sent":2412, "_failed":0) and then n8n killed the execution in Write Sent
 * Log at 34m13s. The emails were out, but Write Sent Log was partial,
 * Mark Broadcasted never ran so Status stayed Live, and Clear Queue Flag never
 * ran so Queued for Dispatch stayed ticked — the offer looked unsent.
 *
 * Resend's /emails/batch takes up to 100 emails in one request, so the same
 * 2,412 emails become 25 requests (~14s at the same pacing). The timeout class
 * of failure goes away rather than being pushed a bit further out.
 *
 * WHAT DOWNSTREAM SEES. Each item carries `payload` (the bare array Resend
 * wants as the request body) and `members` (the recipients, in the SAME
 * ORDER). Resend documents that data[i] of the response corresponds to the
 * email at index i of the request, which is what lets Reconcile map message
 * ids back to clients.
 *
 * NOT SUPPORTED BY /emails/batch: attachments. This dispatch has never sent
 * one, so nothing is lost — but do not add one here without moving back to
 * per-email /emails for that send.
 */

const BATCH_SIZE = 100;
const FROM = 'Akay Irl Ltd <offers@akay.ie>';

const recipients = $('Build Recipients').first().json;
const email = $('Verify HTML').first().json;

if (!email.composed) {
  return [{ json: { halt: true, haltReason: email.haltReason } }];
}

const list = recipients.recipients || [];
if (list.length === 0) {
  return [{ json: { halt: true, haltReason: 'No eligible recipients — nothing to send' } }];
}

const offerIds = (email.bundleOfferIds && email.bundleOfferIds.length) ? email.bundleOfferIds : [email.offerId];
const PLACEHOLDER = /\{\{\{[^}]*\}\}\}/;

const messages = [];
const members = [];
const seenTo = new Set();

for (const r of list) {
  const subject = resolveFirstName(email.subject, r.firstName);
  const text = resolveFirstName(email.bodyTemplate, r.firstName);
  const html = email.html ? resolveFirstName(email.html, r.firstName) : null;

  const msg = {
    from: FROM,
    to: [r.email],
    subject,
    text,
    headers: { 'List-Unsubscribe': `<${email.listUnsubscribe}>` },
  };
  if (html) msg.html = html;

  // Same guards as before the batch change. They run per message as it is
  // built so the throw names the client that caused it.
  if (!Array.isArray(msg.to) || msg.to.length !== 1) {
    throw new Error(`Send payload for ${r.clientName} does not have exactly one recipient`);
  }
  if ('cc' in msg || 'bcc' in msg) {
    throw new Error('Send payload contains cc/bcc — one email per recipient is required');
  }
  if (PLACEHOLDER.test(msg.subject) || PLACEHOLDER.test(msg.text)) {
    throw new Error(`Unsubstituted placeholder left in message for ${r.clientName}`);
  }
  if (msg.html && PLACEHOLDER.test(msg.html)) {
    throw new Error(`Unsubstituted placeholder left in the HTML body for ${r.clientName}`);
  }
  if (!msg.text) {
    throw new Error(`Send payload for ${r.clientName} has no plain-text body`);
  }
  if (seenTo.has(r.email)) {
    throw new Error(`Duplicate recipient ${r.email} — two sends would go to the same address`);
  }
  seenTo.add(r.email);

  messages.push(msg);
  members.push({
    clientId: r.clientId,
    clientName: r.clientName,
    clientEmail: r.email,
    subject,
    offerId: email.offerId,
    offerIds,
  });
}

if (messages.length !== list.length) {
  throw new Error(`Built ${messages.length} message(s) for ${list.length} recipient(s)`);
}

const batches = [];
for (let start = 0; start < messages.length; start += BATCH_SIZE) {
  batches.push({
    msgs: messages.slice(start, start + BATCH_SIZE),
    mem: members.slice(start, start + BATCH_SIZE),
  });
}

const keys = new Set();

return batches.map((b, batchIndex) => {
  // Resend replays the original response for a reused Idempotency-Key for 24h.
  // So the key has to change when the batch CONTENT changes and stay the same
  // when it does not: a key ignoring content would silently not-send an edited
  // re-run, and a key that was unique per attempt would re-send a genuine
  // retry. Fingerprinting the addresses and the body covers both.
  const fingerprint = hash(
    b.mem.map((m) => m.clientEmail).join(',') + '|' + b.msgs[0].subject + '|' + b.msgs[0].text
  );
  const idempotencyKey = `dispatch:${offerIds[0]}:b${batchIndex}:${fingerprint}`
    .replace(/[^A-Za-z0-9:@._+-]/g, '_')
    .slice(0, 256);

  if (keys.has(idempotencyKey)) {
    throw new Error(`Duplicate idempotency key ${idempotencyKey} — two batches would collapse into one`);
  }
  keys.add(idempotencyKey);

  return {
    json: {
      batchIndex,
      batchCount: batches.length,
      batchSize: b.msgs.length,
      payload: b.msgs,
      members: b.mem,
      idempotencyKey,
      offerId: email.offerId,
      offerIds,
      recipientTotal: list.length,
    },
  };
});

function resolveFirstName(text, firstName) {
  return String(text).replace(/\{\{\{FIRST_NAME(\|[^}]*)?\}\}\}/g, (_m, dflt) => firstName || (dflt ? dflt.slice(1) : 'there'));
}

// FNV-1a. Not security — just a short stable fingerprint, and no require().
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
