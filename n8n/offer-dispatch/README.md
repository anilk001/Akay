# Offer Dispatch — the send path

Mirrors of the Code nodes in `Offer Dispatch — Akay` (`dAYMAj6mZD3hTV4T`) that
this repo has had to change. The workflow has 38 nodes; only what was touched
is mirrored here.

## `compose-email.js` — published 2026-09-14

**The problem it solves.** The text presented for approval was never the text
that went out, and edits made to it disappeared. Not a bug in transit — a
design gap. `Compose Email` (now `Compose From Fields`) rebuilt the body from
Airtable fields on *every* run, from `Public Product Description`,
`Price Display`, `Public Note`, `Public Terms` and the rest. No field on Offers
held an approved body, and the approval step is a GET link (`?approved=true`)
with no way to send text back. So an edited wording was never read.

Meanwhile the one-shot sends — "Nescafe Gold", "Corona & Peroni",
"The Pink Stuff" — push **raw verbatim text with no template at all**. Two
genuinely different templates, which is why they never agreed.

**The fix.** `Offers.Approved Offer Text` (`fldKT8KgPb0LonqZL`, long text) is
the one string. When it is set, this node swaps it in as `bodyTemplate`.
Everything downstream already keys off `bodyTemplate`, so the approval email
and the client email now render from the same text — and `Verify HTML` already
proves the HTML did not add or drop a single number or word against it.

Empty field ⇒ nothing changes. Purely additive.

### Why this node is called "Compose Email"

`Render HTML`, `Verify HTML` and `Build Approval Email` all read
`$('Compose Email')` **by name** rather than taking their input from the chain,
and n8n does **not** rewrite a node name inside Code node source when a node is
renamed — verified on this workflow, not assumed. So inserting a node into the
chain changed nothing for them.

The template composer was therefore renamed to `Compose From Fields`, which is
what it does, and this node — which decides the final body — took the name the
rest of the workflow is already asking for. The chain is now:

    Write Claim → Compose From Fields → Compose Email → Composed?
                → Render HTML → Verify HTML → Build Approval Email

### Two things it will not let a hand-written body do

- **Drop the unsubscribe sentence.** A legal requirement on a bulk commercial
  send, and exactly the kind of line that disappears while tightening wording.
  Re-appended when absent, compared on letters and digits alone so a reworded
  one is not duplicated.
- **Carry an unknown `{{{placeholder}}}`.** Only `FIRST_NAME` is ever
  substituted. `Build Sends` does throw on anything else — but it throws *part
  way through the send loop*, after some clients already have the mail. This
  halts before the approval email is even built.

An optional leading `Subject: ...` line overrides the composed subject, so a
whole email can be written in one field.

## `leak-guard.patch.js` — NOT applied

The buy-price leak guard in `Compose From Fields` and `Verify HTML` only runs
when the sell price differs from the buy price — so it disarmed itself exactly
when `Margin %` was missing. The Airtable fix on 2026-09-14 closes the hole
from the other side (`Sell Price` is now `BLANK()` rather than `Buy Price`, so
such an offer cannot be composed at all), which is why this is no longer
urgent. It is still worth applying: a guard that switches itself off reads as
protection in every review, and the next person to touch the `Sell Price`
formula will not know it was load-bearing.

Verified safe to apply: `Find Sendable Offers` requests no field list, so it
returns every field, and `Gate Check` carries `offerFields` wholesale —
`Margin %` is available in both nodes.
