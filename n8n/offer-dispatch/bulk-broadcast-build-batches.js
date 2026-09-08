const c = $('Email Content').first().json;
// Exactly the pattern Resend validates `to` against (from its API schema). A
// single malformed address makes Resend reject an ENTIRE batch of 100 with a
// 422, so these must be filtered before chunking. Apostrophes are accepted
// (alan.o'brien@barrys.ie sent fine 2026-09-08); missing TLDs are not.
const RESEND_EMAIL = /^(?!\.)(?!.*\.\.)([a-z0-9_'+\-.]*)[a-z0-9_+-]@([a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/;
const seen = new Set();
const recipients = [];
const rejected = [];
for (const item of $input.all()) {
  const raw = item.json.Email;
  if (!raw || typeof raw !== 'string') continue;
  const e = raw.trim().toLowerCase();
  if (seen.has(e)) continue;
  seen.add(e);
  if (!RESEND_EMAIL.test(e)) { rejected.push({ name: item.json['Client Name'] || '', email: e }); continue; }
  recipients.push(e);
}
const BATCH = 100;
const out = [];
for (let i = 0; i < recipients.length; i += BATCH) {
  const chunk = recipients.slice(i, i + BATCH);
  const payload = chunk.map(function (e) {
    return { from: c.from, to: [e], reply_to: c.reply_to, subject: c.subject, text: c.text, html: c.html };
  });
  out.push({ json: { batchNumber: out.length + 1, batchSize: chunk.length, totalRecipients: recipients.length, rejectedCount: rejected.length, rejected: rejected, payload: payload } });
}
if (!out.length) {
  return [{ json: { batchNumber: 0, batchSize: 0, totalRecipients: 0, rejectedCount: rejected.length, rejected: rejected, payload: [] } }];
}
return out;
