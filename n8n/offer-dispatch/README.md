# Offer Dispatch — Akay (email via Resend)

n8n workflow `dAYMAj6mZD3hTV4T` (`Offer Dispatch — Akay`). Daily 08:00
Europe/Dublin, plus `POST /webhook/dispatch-offer` for a single offer.

Picks the oldest queued group (`Queued for Dispatch` + `Send Eligible = Yes`),
checks a Verified backup exists for today, builds the recipient list from
Clients, composes the plain-text email, renders and verifies the HTML, emails an
approval request to `ak@akay.ie` with Approve / Decline links, and only then
sends one Resend email per recipient (2/s, `Idempotency-Key` per offer×client).

Only the two Code nodes that were changed are mirrored here. The rest of the
node code remains in n8n only.

## Files

| File | Node | State |
|---|---|---|
| `fail-loudly-on-halt.js` | Fail Loudly on Halt | full source, **published 2026-09-08** |
| `untick-queue-on-halt.js` | Untick Queue on Halt | full source, **published 2026-09-08** |

The same publish also changed one expression on the `Approved?` If node:

    before:  {{ $json.query.approved }}
    after:   {{ ($json.query || {}).approved || '' }}

As everywhere in `n8n/`: **this directory is a mirror, not the running
system** — editing here changes nothing until pasted into the node and the
workflow is published.

## Fix of 2026-09-08 — the halt path after an approval decline

Execution 36640 (2026-09-07, KitKat 4-finger bundle, 436 recipients) was
declined via the email link. The run correctly sent nothing, but the alert it
raised read:

    Offer dispatch HALTED and sent nothing. Reason: no reason recorded.

Three defects sat on that path, all introduced when the Gmail approval step was
replaced by *Wait for Approval* on 2026-09-03:

1. **`Fail Loudly on Halt` still read `$('Await Approval')`**, the node that
   no longer exists. The lookup threw, was swallowed, and the decline was
   reported as "no reason recorded". It now reads `Wait for Approval` and
   distinguishes a Decline click (`query.approved === 'false'`) from a 3-day
   expiry (no `query` at all, because the Wait node passes its input through
   on timeout). The 401 hint also named the retired "Bearer Auth account"
   credential; the sends use "Resend API Key" since 2026-09-04.
2. **`Approved?` evaluated `$json.query.approved`.** On expiry there is no
   `query`, so the expression throws and the If node itself errors instead of
   routing to the halt path. Made null-safe.
3. **`Untick Queue on Halt` cleared every queued offer on a decline.** Its
   input on that path is the Wait node's webhook payload, which names no
   offer, so it fell straight through to the `Find Sendable Offers` fallback —
   *all* queued offers, including groups deferred to a later run that nobody
   had approved or declined. It now falls back to the group `Build Recipients`
   actually claimed. (In 36640 there happened to be no deferred group, so no
   damage was done that day.)

## Tests

    node n8n/tests/offer-dispatch-halt.test.cjs

Five scenarios run the mirrored sources against a stand-in for n8n's `$()`:
declined, expired, post-send incomplete, 401 on every send, and a gate halt.
The test fails against the pre-fix node code (declined → "no reason recorded",
deferred offer unticked), and passes against these files.
