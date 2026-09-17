# Unmatched Demand Digest — Akay

Weekly email to Anil and Annika: **what buyers asked for that we could not
supply**, ranked by how many different buyers asked.

Every line the Instant Quote tool cannot price is a customer telling us what to
stock, with their name on it. Until this existed it went nowhere — the buyer
downloaded a file with gaps in it and the gaps were forgotten. A brand asked
for by four buyers in one week is a purchase order waiting to be written; the
same fact noticed a year later is four customers who stopped asking.

| File | Node | Workflow |
|---|---|---|
| `build-demand-digest.js` | Build Demand Digest | Unmatched Demand Digest — Akay |

## Where the data comes from

Nothing new is stored. Demand already lands in the **`Wanted`** table
(`tblWZnoQHC2E6tYPd`) from three directions, and this digest reads all of them:

- **Instant Quote** — added by this change: `extract-wanted-lines.js` in
  `../instant-quote-intake/` writes one `Wanted` row per unpriced line.
- **Enquiries** — the existing auto-extraction from email and WhatsApp.
- **Manual entry** and the digest "tell us what you want" link.

That also means the rows go in front of the existing **Wanted Matcher — Akay**
workflow, so when the stock does arrive the buyer who asked for it is already
attached. The digest is the second use of the same rows, not a parallel system.

## Workflow shape

```
Schedule (Mon 07:30) → Airtable: Search Wanted → Build Demand Digest → Gmail: Send
```

Airtable node, `Wanted` table, filter formula:

```
IS_AFTER({Created Date}, DATEADD(TODAY(), -28, 'days'))
```

Twenty-eight days, not seven, from one query: a brand asked for three weeks
running is a standing order being placed somewhere else, and a seven-day window
cannot see that. The digest **reports** on the last 7 days and uses the other 21
only to mark what is not new. If you change the window, change `DAYS_BACK` in
the node to match.

Fields to return: `Brand`, `Product Name`, `Variant`, `Volume ML`, `Category`,
`Qty`, `Qty Unit`, `Target Price`, `Currency`, `Bond/Customs Status`, `Client`,
`Match Count`, `Status`, `Source`, `Trader Notes`, `Created Date`.

Set Build Demand Digest to **Run once with all items**. Map the send node to
`{{ $json.subject }}`, `{{ $json.html }}` and `{{ $json.text }}`.

It runs half an hour after the trade-terms digest on purpose: that one is about
what we could not *read*, this one about what we could not *sell*, and they
should not arrive as one wall of email.

## What it reports

- **Match rate** — the share of the week's demand the matcher found stock for.
  This is the number that says whether the Instant Quote tool is working. A
  buyer who uploads 200 lines and gets 40 prices back does not come back.
- **What to source** — distinct products behind the unmatched rows, ranked by
  **how many different buyers asked**, then by volume. Four buyers asking once
  each is a market; one buyer asking four times is an account, and the brief is
  for buying decisions.
- **Repeats** — a product also asked for in the prior three weeks is flagged.
  A repeat that is still unsourced is the most expensive line in the email.
- **Buyers waiting on us** — who asked for something we did not have. This is
  the retention list, and it is the reason the email is internal.
- **Safe to forward to a supplier** — brand, size, bond status and quantity.
  Nothing else.

## Grouping

By **brand + volume + bond status**, using the `Wanted` row's own structured
columns. The parsing happened once, at capture, so this node never re-reads
free text: `70cl`, `0.7L` and `700ml` are already the same `Volume ML` and group
as one product.

Bond status is part of the key deliberately — the same brand T1 and T2 are two
different things to buy, and merging them would produce a quantity nobody can
act on.

## What may leave this email

The `Wanted` table's own rule, from its description in Airtable:

> INTERNAL ONLY: never public, never supplier-visible; supplier demand reports
> aggregate by Brand/Volume/Bond only (no client names or target prices).

So the node renders two things. The internal brief names buyers and prints
their targets. The **Safe to forward** block is built by *dropping* those
fields rather than by remembering not to paste them, and the test suite checks
every run that no buyer name, no target price and not even the count of who
asked survives into it — that last one tells a supplier how badly we need it.

## Two things worth fixing in Airtable

Neither blocks the digest; both make it sharper.

1. **`Wanted.Source` has no "Instant Quote" option.** The live choices are
   Enquiry, Digest Link, WhatsApp, Email, Manual. Quote-tool rows are written
   as `Enquiry` — true, since they come through one — with the origin stamped
   into `Trader Notes`, which is what the digest counts. Add the option, change
   `WANTED_SOURCE` in `extract-wanted-lines.js`, and the count moves to the
   field. Writing a value the base does not have would fail the whole batch,
   which is why it is not done already.
2. **`Wanted` has no client-name column.** Enquiries has `Client Name (Cache)`;
   Wanted only has the `Client` link, which the REST API returns as record ids.
   The digest falls back to the `Buyer:` line the extractor stamps into
   `Trader Notes`, so quote-tool rows name their buyer — but rows from other
   sources may not. A lookup column called `Client Name (Cache)` on Wanted would
   fix it for every source with no code change; the node already reads that name
   first.

## Tests

    node n8n/tests/unmatched-demand-digest.test.js

Run by `npm test`. The node source is executed rather than re-typed, so a rule
changed in the node is a rule the tests see.
