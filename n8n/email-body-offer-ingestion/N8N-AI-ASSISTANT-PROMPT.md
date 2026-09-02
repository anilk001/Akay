# Email Body Offer Ingestion — fix package for the n8n AI assistant

Workflow: **Email Body Offer Ingestion — Akay** (`8oPUD8d9NPVBEime`)

## What is actually wrong (verified against execution data, not guessed)

Execution **#30339** (2026-09-02, a successful production run) shows the Gmail
Trigger emitting only this per email:

```json
{
  "id": "1a0635c3939563f2",
  "threadId": "1a0635c3939563f2",
  "snippet": "Toblerone Milk 100gr - 1 EUR DAP Riga Lindt 100gr - 1,83 EUR DAP Riga",
  "From": "Anil Khetan <ak@akay.ie>",
  "Subject": "Sasa offer",
  "To": "Akay Offers <offers@akay.ie>"
}
```

Two defects follow from this:

1. **The parser never receives the email body.** The downstream Code node
   `Extract Body Blocks` reads `item.html` / `item.text` / `item.from`
   (lowercase). The trigger's simplified output has none of those fields, so
   the entire 39-node pipeline has been parsing the ~90-character Gmail
   `snippet` preview instead of the email. Tables can never parse from a
   snippet; that is why offers come out wrong or land in Needs-Review, and why
   reading the email manually always "works".

2. **Labelled emails are never picked up.** The n8n Gmail Trigger silently
   appends `after:<last poll time>` to its search, so it only sees messages
   *received* since the previous poll. Emails labelled `Process_Akay` after
   they arrived (the normal manual workflow) are invisible to it forever —
   hence having to process them by hand.

Re-polling by label is safe in this workflow: every path terminates by adding
either `Akay/Email-Done` (via *Mark Email Done*) or `Akay/Needs-Review` (via
*Mark Reviewed*), and both labels are excluded by the search query, so nothing
is processed twice.

## Prompt to paste into the n8n AI assistant

Open the workflow in the n8n editor, open the AI assistant, and paste:

---

My workflow "Email Body Offer Ingestion — Akay" needs its trigger stage
replaced. Do not change any node other than the ones named here.

Problem 1: the Gmail Trigger returns simplified output (From/Subject/snippet
only — no body), but my Code node "Extract Body Blocks" reads `item.html`,
`item.text` and `item.from` (lowercase), so the parser only ever sees the
snippet. Problem 2: the Gmail Trigger only surfaces messages received after
its last poll, but I apply the Process_Akay label manually after emails
arrive, so labelled emails are never triggered on.

Please make exactly this change:

1. Delete the "Gmail Trigger" node.
2. Add a Schedule Trigger named "Poll Process_Akay" that runs every
   5 minutes.
3. Add a Gmail node named "Fetch Labeled Emails": resource Message,
   operation Get Many, using my existing "offers n8n" Gmail credential,
   with Simplify turned OFF (I need the full parsed body), Limit 25, and
   these filters — Search query exactly:
   `label:Process_Akay -label:Akay/Email-Done -label:Akay/Needs-Review -has:attachment`
   and Read Status set to "both" (read and unread — these emails are
   usually already read before being labelled).
4. Add a Code node named "Normalize Email" (mode: Run Once for Each Item)
   with the code below, and wire:
   Poll Process_Akay → Fetch Labeled Emails → Normalize Email →
   Extract Body Blocks.

Code for "Normalize Email":

```javascript
// Maps Gmail "Get Many" output (Simplify off: mailparser shape) to the
// lowercase field contract the pipeline consumes. Also tolerates the old
// simplified shape (capitalised From/Subject) so a config change upstream
// cannot silently empty the body again.
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
```

This is safe to re-poll because every branch of the workflow ends by
labelling the email Akay/Email-Done or Akay/Needs-Review, and the search
query excludes both labels.

---

## Why these exact settings matter

- **Simplify OFF** is the whole point — it makes Gmail fetch and parse the
  raw email so `html` and `text` exist. Leaving it on reproduces bug 1.
- **Read Status: both** — the Gmail node's default is *unread only*. Emails
  are normally read before being labelled, so the default would silently skip
  almost everything.
- **The query unchanged** — it already carries the idempotency guard
  (`-label:Akay/Email-Done -label:Akay/Needs-Review`).
- **5 minutes, limit 25** — runs take under a minute, so polls never overlap;
  a backlog larger than 25 drains over successive polls.

The normalizer and the real `Extract Body Blocks` code were tested together
offline: with a full HTML body the parser finds the offer table
(`blocksFound: 1`); with the old snippet-only shape it finds nothing
(`blocksFound: 0`, "No table or label:value block found") — matching exactly
the behaviour seen in production.

`workflow.export.json` alongside this file is the full export of the current
live workflow (39 nodes) if the assistant asks for it or an import is needed.
