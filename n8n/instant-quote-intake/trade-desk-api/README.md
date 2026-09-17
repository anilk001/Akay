# The Trade Desk API side of the intake

`post-to-intake.js` is the missing half of the Instant Quote intake: the call
the Trade Desk API makes after it has priced a buyer's list. **It belongs in
`trade-desk-api`, not in this repo** — it lives here because this is where the
contract is written down and tested, and because keeping it beside the n8n node
means a change to either side breaks a test rather than production.

Without it, nothing else in this folder can do anything: the webhook is live,
the nodes are written, and no request ever arrives.

## Install

1. Copy `post-to-intake.js` into `trade-desk-api` (it has no dependencies and
   needs Node 18+ for global `fetch`).
2. Call it from the `/api/upload-excel` handler, **after** the response:

   ```js
   import { postToIntake } from './post-to-intake.js';

   const result = await priceTheList(file);
   res.json(result);                         // the buyer never waits on us

   postToIntake({
     result,
     upload: { name: file.originalname, type: file.mimetype, buffer: file.buffer },
     quoted: { name: pricedName, type: pricedType, buffer: pricedBuffer },
     contact: req.body.contact || {},
   });
   ```

   It never throws and never rejects. A logging call must not be able to break
   a download the buyer already waited for.

3. Set `AKAY_INTAKE_SECRET` (see below). `AKAY_INTAKE_URL` defaults to the
   production webhook; override it to point a staging deploy somewhere else.

That is the whole change. The SPA does not have to collect contact details
first — `contact` can be `{}`, and the enquiry is logged unattributed rather
than dropped, because a list we cannot attribute is still a buying signal.

## The mapping

The API's own response shape (read from the shipped bundle,
`quote/assets/index-*.js`) is richer than the webhook needs, so the adapter
narrows it:

| Trade Desk row | Intake line | Why |
| --- | --- | --- |
| `description` | `description` | the buyer's line as they typed it |
| `match.{brand,productName,variant}` | `matched` | its presence is what marks a line as quoted |
| `match.brand`, `match.volumeMl` | `brand`, `volumeMl` | skips re-parsing text we already parsed |
| `needsReview`, `match.matchMethod` | `needsReview`, `matchMethod` | so a low-confidence match is visible |
| `quantity`, `quantityBasis` | `qty`, `unit` | become Wanted's Qty and Qty Unit |
| `wholesalePrice` + currency + basis | `price` | "17.95 EUR/Bottle" |
| **`customerPriceBase`** | **`target`** | the buyer's own €/unit — see below |
| `note`, `sourceRow` | `note`, `sourceRow` | context on the enquiry record |

**`customerPriceBase` is the field that matters most.** On an unmatched line it
is the difference between "somebody wants this" and "somebody wants this at
€22.50 and is buying it from someone else today". It flows into the `Wanted`
row's Target Price and into the weekly buying brief.

**An unmatched row carries no `matched` key.** That absence is the entire
signal: it is what the n8n node reads as "we had nothing to sell them", and it
is what creates the `Wanted` row. A low-confidence match still counts as
quoted, because we did put a price against it — it travels flagged instead. To
chase those too, omit `matched` when `row.needsReview` is true; the n8n side
needs no change.

## What is deliberately not sent

`marginPct`, `lineSaving`, `wholesalePriceBase` and `alternatives` stay in the
API.

The buyer's price and our price are both already on their screen, so logging
them tells nobody anything new. `marginPct` is a different matter. It is
rendered in the SPA underneath "Line saving", which makes it *probably* the
buyer's saving percentage rather than ours — but a margin-shaped number with an
ambiguous name is not something to copy into Airtable and from there into a
weekly email on a guess. **Worth confirming with whoever owns the API what it
actually is.** If it is the buyer's saving, the name is misleading enough to be
worth changing; if it is ours, it is on a page buyers can read.

## The webhook is public

`POST /webhook/instant-quote` takes no credential today and creates Airtable
records. The honeypot in the payload stops a dumb crawler, not somebody who
reads this file.

Setting `AKAY_INTAKE_SECRET` makes the adapter send `X-Akay-Intake-Secret`.
**That does nothing until the n8n workflow checks it** — add an IF node after
the webhook comparing the header against a credential and dropping anything
that does not match. Worth doing before the launch email puts the tool in front
of a few thousand people.

## Tests

The contract is checked from both ends in
`../../tests/instant-quote-intake.test.js` (`npm test`): a real Trade Desk
response goes through `buildIntakePayload`, then the "Validate & Compose" node,
then "Extract Wanted Lines", and the resulting `Wanted` rows are asserted. It
also asserts that no margin field reaches the wire.

If the API's response shape changes, update the fixture in that test in the
same commit — it is the only place the two systems are compared.
