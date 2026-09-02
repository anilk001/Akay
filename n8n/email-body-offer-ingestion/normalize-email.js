// n8n Code node — "Normalize Email" (Run Once for Each Item)
//
// Sits between Gmail "Get Many" (Simplify OFF) and "Extract Body Blocks",
// replacing the old Gmail Trigger, which had two faults:
//
//   1. It only surfaced messages RECEIVED after its last poll, so an email
//      labelled Process_Akay any time after arrival was never seen at all.
//      The label search feeding this node has no such window.
//   2. It emitted metadata only (From/Subject/snippet — no body), so the
//      parser read the ~90-character Gmail snippet instead of the email.
//
// Accepts both the parsed-raw shape ({from:{value,text}}, html, text) and the
// old simplified shape (capitalised From/Subject), so a config change
// upstream cannot silently empty the body again.
const j = $input.item.json;

let from = '';
if (typeof j.from === 'string') from = j.from;
else if (j.from && typeof j.from === 'object') {
  const first = Array.isArray(j.from.value) ? j.from.value[0] : null;
  from = j.from.text || (first ? [first.name, first.address && ('<' + first.address + '>')].filter(Boolean).join(' ') : '');
}
if (!from) from = String(j.From || '');

const subject = (typeof j.subject === 'string' && j.subject) ? j.subject : String(j.Subject || '');

return {
  json: {
    id: j.id,
    threadId: j.threadId,
    labelIds: j.labelIds,
    sizeEstimate: j.sizeEstimate,
    date: j.date || null,
    snippet: typeof j.snippet === 'string' ? j.snippet : '',
    from,
    subject,
    html: typeof j.html === 'string' ? j.html : '',
    text: typeof j.text === 'string' ? j.text : '',
  },
  binary: $input.item.binary,
};
