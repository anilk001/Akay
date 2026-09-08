# Offer Dispatch — Akay (email via Resend)

n8n workflow `dAYMAj6mZD3hTV4T` (`Offer Dispatch — Akay`). Daily 08:00
Europe/Dublin, plus `POST /webhook/dispatch-offer` for a single offer.

Picks the oldest queued group (`Queued for Dispatch` + `Send Eligible = Yes`),
checks a Verified backup exists for today, builds the recipient list from
Clients, composes the plain-text email, renders and verifies the HTML, emails an
approval request to `ak@akay.ie` with Approve / Decline links, and only then
sends one Resend email per recipient (2/s, `Idempotency-Key` per offer×client).

Only the Code nodes that have been changed from this repo are mirrored here.
The rest of the node code remains in n8n only.

## Files

| File | Workflow | Node | State |
|---|---|---|---|
| `fail-loudly-on-halt.js` | `dAYMAj6mZD3hTV4T` | Fail Loudly on Halt | full source, **published 2026-09-08** |
| `untick-queue-on-halt.js` | `dAYMAj6mZD3hTV4T` | Untick Queue on Halt | full source, **published 2026-09-08** |
| `build-recipients.js` | `dAYMAj6mZD3hTV4T` | Build Recipients | full source, **published 2026-09-08** |
| `bulk-broadcast-build-batches.js` | `SrfRd6s06xumu0HD` Ad-hoc Bulk Broadcast (template) | Build Batches | full source, saved 2026-09-08 (manual-only workflow, send node disabled) |

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

## Fix of 2026-09-08 — email validation matched to Resend

The Lotus Biscoff bulk send that morning (workflow `SrfRd6s06xumu0HD`, 2,497
recipients in 25 batches of 100) had three batches rejected by Resend with
`422 Invalid \`to\` field`, because one malformed address fails the whole
batch. The retry that followed used a home-grown "strict" regex to drop bad
addresses, and the same regex was copied into Offer Dispatch's Build
Recipients. It was stricter than Resend: it rejected apostrophes, so
`alan.o'brien@barrys.ie` (a valid, deliverable address) was dropped from the
retry and would have been silently excluded from every future dispatch.

Both nodes now use the exact pattern Resend validates `to` against:

    /^(?!\.)(?!.*\.\.)([a-z0-9_'+\-.]*)[a-z0-9_+-]@([a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/

(applied after lower-casing). Rejects what Resend rejects: no TLD
(`info@organic`), one-letter TLD (`grosshandel@medivon.d`), leading or double
dots. Accepts what Resend accepts, apostrophes included; proven by a live
single send to Alan O'Brien (Resend id `4d08184d`, 200).

## Tests

    node n8n/tests/offer-dispatch-halt.test.cjs
    node n8n/tests/resend-email-regex.test.cjs

Five scenarios run the mirrored sources against a stand-in for n8n's `$()`:
declined, expired, post-send incomplete, 401 on every send, and a gate halt.
The test fails against the pre-fix node code (declined → "no reason recorded",
deferred offer unticked), and passes against these files.
