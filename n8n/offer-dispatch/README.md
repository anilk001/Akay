# Offer Dispatch — Akay (Resend email)

n8n workflow `dAYMAj6mZD3hTV4T` (`Offer Dispatch — Akay`). The Resend email
side of offer dispatch; the WhatsApp counterpart is
[`../whatsapp-offer-broadcast/`](../whatsapp-offer-broadcast/), same Offers
table, different transport.

Two ways in, one path after that:

- **Schedule** — daily 08:00 Dublin, picks up Offers where
  `Queued for Dispatch` is ticked and `Send Eligible = Yes`.
- **Webhook** `POST /webhook/dispatch-offer` with `{"offerId": "rec..."}` —
  the Airtable button path, for sending one offer now.

Gate Check → backup check → Build Recipients → claim → compose → render/verify
HTML → **approval email to ak@akay.ie** → Wait → Send via Resend → Reconcile →
Sent Log → Mark Broadcasted.

Nothing reaches a client without the approval link being clicked.

## The 2,412-recipient failure this directory was created to fix

Execution **50042**, 2026-09-14, Elizabeth Arden, 2,412 recipients:

| | |
|---|---|
| Started | 15:02:19 |
| Reconcile finished | 15:28:54 — `"_sent":2412, "_failed":0` |
| Killed | 15:36:32, status `canceled`, `lastNodeExecuted: "Reconcile"` |

`executionTimeout` was 1800 s. The run took 34m13s, so n8n killed it in
`Write Sent Log` — **after all 2,412 emails had been accepted by Resend.**
`Dispatch Complete?` never ran, so `Mark Broadcasted` and `Clear Queue Flag`
never ran: Status stayed `Live`, `Queued for Dispatch` stayed ticked, the Sent
Log was partial, and the offer looked unsent although every client had it.

The time went on pacing. `Send via Resend` posted **one request per recipient**
to `/emails`, batched 2 per 1,100 ms — 1,206 intervals, **22 minutes**, 73% of
the timeout budget before anything else ran. Under ~1,000 recipients it fits
(198 recipients took 9.5 min, 139 took 4.5 min); over ~2,000 it cannot.

**The fix is Resend's `/emails/batch`**: up to 100 emails per request, so 2,412
emails are 25 requests (~14 s at the same pacing). The endpoint supports
`from`, `to`, `subject`, `text`, `html` and `headers` — everything this
dispatch uses. It does **not** support `attachments`; this dispatch has never
sent one.

Resend's docs guarantee the ordering the reconcile depends on: *"each entry in
`data` corresponds to the email at the same index in the batch payload
(0-based)"*.

## Everything else that changed at the same time

The batch endpoint removed the timeout. These removed the fix-and-retry loop
around it — each of them used to cost a full cycle of *fix a field, re-tick
`Queued for Dispatch`, run again, find the next problem*.

- **One bad offer no longer kills the run.** `Gate Check` ran *once for each
  item*, so a failing offer emitted its own `gatePassed:false` item, which
  routed to `Fail Loudly on Halt` — and that throws. One expired offer in a
  queue of three stopped the other two and turned the run red. It now runs
  *once for all items*, sends whatever passed, carries the rest as
  `skippedOffers` into the approval email, and halts only when **nothing**
  passes — naming every failing condition on every offer at once.
- **`Compose From Fields` reports every problem in one halt** instead of
  returning on the first missing required field or leak-guard hit.
- **`Build Recipients` names every field a bundle disagrees on**, not just the
  first.
- **The webhook answers immediately.** `responseMode` was `lastNode`, so the
  caller waited for the whole dispatch *including the 3-day approval Wait* —
  the Airtable button always showed a timeout even on a healthy run. Now
  `onReceived`.
- **`executionTimeout` 1800 → 2400 s**, as headroom rather than as the fix.

## Idempotency

The `Idempotency-Key` is `dispatch:<offerId>:b<batchIndex>:<fingerprint>`,
where the fingerprint hashes the batch's recipient addresses and body. Resend
replays the original response for a reused key **for 24 hours**, so this has to
cut both ways:

- same recipients, same body → same key → a retry does **not** re-send;
- edited body or changed recipients → new key → the corrected email **does**
  go out, rather than being silently swallowed by the replay.

## Files

| File | Node | Mode |
|---|---|---|
| `gate-check.js` | Gate Check | Run Once for All Items |
| `build-recipients.js` | Build Recipients | Run Once for All Items |
| `compose-from-fields.js` | Compose From Fields | Run Once for All Items |
| `build-approval-email.js` | Build Approval Email | Run Once for All Items |
| `build-sends.js` | Build Sends | Run Once for All Items |
| `reconcile.js` | Reconcile | Run Once for All Items |

All six are **full source, published 2026-09-19** (workflow version
`ce90cd3e-a094-4f17-8106-bf7a6edb9339`).

`../tests/offer-dispatch.test.js` loads and executes these files rather than
re-typing them, so the repo and the node cannot drift. It runs in `npm test`.

As everywhere in `n8n/`: **this directory is a mirror, not the running
system** — editing here changes nothing until it is pasted into the node and
the workflow is PUBLISHED. A draft is invisible until then.
