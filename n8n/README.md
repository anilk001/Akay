# n8n workflow node source

Mirrors of the JavaScript inside n8n Code nodes, kept here so the parsing and
classification logic gets the same review trail as the site code.

The workflows themselves live in n8n cloud. **This directory is a mirror, not the
running system** — editing a file here changes nothing until the code is pasted
into the node and the workflow is PUBLISHED.

That last step matters. The `Classify Message` node was authored on 2026-08-27
and left as an unpublished draft; the active workflow stayed on the previous
3-node version, so ~5,000 WhatsApp messages were captured and never classified
between 2026-07-29 and 2026-08-27. A draft in n8n is invisible until published.

## Contents

| File | Workflow | Node | State |
|---|---|---|---|
| `whatsapp-offer-ingestion/extract-wa-offers.js` | `Bn6Irz2Yx7MTRnKu` | Extract WA Offers | full source, **published 2026-08-30** |
| `whatsapp-filter-layer/classify-message.buy-side-guard.js` | `DO2ltjkISp2YDNnc` | Classify Message | patch only, **published 2026-08-30** |
| `whatsapp-offer-broadcast/plan-broadcast.js` | `BeGfFpgxmI7hdCTI` | Plan Broadcast | full source, **published 2026-09-04** |
| `whatsapp-offer-broadcast/build-results.js` | `BeGfFpgxmI7hdCTI` | Build Results | full source, **published 2026-09-04** |
| `trade-terms-normaliser/normalise-trade-terms.js` | `WQ6A8IVLSAd72fnk` | Normalise Trade Terms | full source, **published 2026-09-13** (v3: bare ex-stock) |
| `trade-terms-digest/build-parse-digest.js` | *(not built in n8n yet)* | Build Parse Digest | full source, **not published** |
| `pdf-image-offer-ingestion/select-pdf-image-attachments.js` | `aZvwBunq4W07XqL3` | Select PDF/Image Attachments | full source, **published 2026-09-17** (deal price, not RRP) |

The four WhatsApp nodes and the trade-terms normaliser are live. **Excel Offer
Ingestion** (`j1NAhQEKz9hzi1T2`) now calls the normaliser on every line — as a
dead-end observation branch in DRY RUN, so it writes nothing and the live
Create Offers path is untouched. That is rollout step 2. Email, PDF and
WhatsApp are still to come, and going live needs the mapping node described in
`trade-terms-normaliser/README.md`.

The exception digest is not built in n8n at all yet, because publishing it
starts sending a weekly email. Its two inputs are ready: `Parse Status` and
`Parse Notes` were added to the Offers table on 2026-09-13.

`classify-message` is a patch rather than full source
because the node could not be exported verbatim at the time; replace it with the
full source when convenient rather than transcribing it by hand.

## Known differences from the deployed nodes

`select-pdf-image-attachments.js` has the same escape-vs-literal difference on
one line. The repo holds

    const SPACER_CHARS = /[­͏​-‍⁠﻿]/g;

while the copy in n8n holds the literal characters, because the update API
decodes the escapes in transit. The two compile to the same regex — verified by
running a probe string containing all six code points through both and diffing
the output — so this is presentational, not drift. Keep the escapes here for the
reason given below.

In `extract-wa-offers.js` two regexes in `clean()` are written here with
`\uXXXX` escapes:

    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\p{Extended_Pictographic}|[\u2190-\u21FF\u2B00-\u2BFF\uFE0F\u20E3]/gu, ' ')

The copy stored in n8n holds the **literal characters** in those two classes
instead of the escape text. The two forms compile to the same regex and were
verified to produce identical output, so this is presentational only — but it
means a byte comparison of this file against the node will show two differing
lines, and that is expected rather than drift.

Keep the escapes in this file. A regex class containing raw zero-width
characters is unreadable, and some editors strip them silently, which would
break the pattern without any visible change to the source.

## Changes in this commit

**Buy price is the deal price, never the RRP**
(`pdf-image-offer-ingestion/select-pdf-image-attachments.js`, plus prompt-only
changes in `aZvwBunq4W07XqL3` and `8oPUD8d9NPVBEime`)

On 17 September two Mainline Marketing offers were ingested priced off the
recommended retail price. L'Oreal Bright Reveal serum went in at GBP 31.99
against a true cost of GBP 5.00 — a 6.4x overprice, sell GBP 33.59 instead of
GBP 5.25 — and a Nivea gift set at GBP 15.00 against a true GBP 4.50. Both
would have gone out on a quote at those numbers.

The prompt was not the problem. It already said *"buyPrice is the number the
SUPPLIER charges us. Never a retail/RRP price."* The problem was that the model
had never been shown the price. Both emails carried a product photo — in one
case a Superdrug/eBay listing screenshot — and stated the trade price only in
the body text:

    RRP £31.99 each              <- the only price in the attachment
    Take ALL DEAL @ £5.00 each   <- the real cost, body text only

`Select PDF/Image Attachments` read that body to recover the forwarded sender
and then discarded it, so `Extract Offers from Image (Claude)` received the
attachment and nothing else. Told never to use an RRP and handed a document
containing only an RRP, the model returned the one number it had.

Three changes:

1. **The body travels with the attachment.** The Select node now emits
   `bodyText` in the meta every item carries. Our own signature block and legal
   footer are cut first — the footer says *"Prices and availability quoted are
   subject to…"*, which is exactly the kind of sentence not to feed a price
   extractor — along with Mailchimp zero-width padding, then capped at 6,000
   characters. Anil's own note above a forward (*"Put 10% mark up on this"*) is
   deliberately kept, so the whole body is passed rather than only the part
   below the forward marker.

2. **Both vision prompts gained a PRICE SOURCE block** naming the labels that
   mark a consumer price (RRP, SRP, MSRP, retail, was, worth, and the retailers
   whose screenshots turn up in these emails), the wordings that mark a trade
   price (deal, take all, offer price, reduced to, `@ X each`, `X/cs`), and the
   precedence rule: **when the email text and the attachment disagree, the email
   text wins.** Where a product's only price is a retail figure the row is now
   omitted rather than emitted at that price — a missing row is visible, a 6x
   overprice is not.

3. **The body-text workflow got the same block.** `LLM Extract Offers` in
   `8oPUD8d9NPVBEime` had a careful dual-price-column rule but nothing
   separating trade from retail, so the identical failure was available to it on
   any email that quotes both. A retail and a trade figure for one product are
   explicitly called out as *not* a dual price column.

Both workflows were published and verified active (`versionId` equal to
`activeVersionId`) rather than left as drafts.

`n8n/tests/select-pdf-image-attachments.test.js` executes the node source and
asserts the deal price reaches `bodyText`, that the signature and footer are
stripped, that Anil's mark-up instruction survives at the top, and that the
pre-existing inline-logo skip, spreadsheet hand-off and no-op sentinel still
behave. The prompt itself cannot be unit-tested here, which is why the rules
are written out above.

## Earlier changes in this commit

**Trade terms are parsed at ingestion instead of being backfilled later**
(`trade-terms-normaliser/`, `trade-terms-digest/`)

On 12 September a backfill had to be built because minimum order quantity and
lead time were sitting in the base as free text — and in many cases not even in
their own fields, but inside product names: *"Jim Beam Apple 12x70cl MOQ 50
cases"*. The same fact was written 63 different ways across 2,052 records, two
competing lead-time fields covered 23% of public lines between them, and the
site could show neither.

None of that was caused by suppliers being inconsistent. Suppliers will always
be inconsistent. It was caused by the pipelines storing what arrived instead of
resolving what it meant, so every day it stayed unfixed the backfill became more
of a recurring chore.

`normalise-trade-terms.js` is one sub-workflow called from all four ingestion
pipelines, sitting immediately after the **Apply Default Margin** node that
already proved the pattern. It extracts, resolves through the cascade
line → header → supplier default → category rule, and labels the result in
`MOQ Source` so nothing downstream has to choose between over-claiming and
saying nothing. `build-parse-digest.js` is the weekly exception email that makes
new wording visible the week it starts rather than two years later.

The normaliser is published as `WQ6A8IVLSAd72fnk`, verified against the repo
source by running a 12-case battery through the deployed node and diffing the
output against the same battery run locally — all four MOQ Source tiers, both
range directions, ex-stock, the fail-open path and the never-guess path match
exactly. Nothing calls it yet, which is deliberate: see the rollout in
`trade-terms-normaliser/README.md`.

## Earlier changes (published 2026-08-30)

**1. Leading quantity swallowed into product identity** (`extract-wa-offers.js`)

`splitQuantity()` only stripped a *trailing* dash-delimited quantity
("Hennessy VS GBX 6x70cl - 1,250 cs"). A quantity stated first with no dash
("1250 cs Martini Bianco 6x1L original T2") was left in the name, because
without a " - " the split yields one part and the `parts.length > 1` loop never
runs.

Observed on a real offer (execution 28254): `brand: "1250"`, `productKey:
"1250|1250csmartinibianco6x1loriginalt2|1000|t2"`. Since productKey is the
Product-matching identity, the same product quoted at a different quantity
yields a different key and a duplicate Product record — a slow corruption of
Products and of price intelligence.

Price, currency, basis, pack, volume, incoterm, warehouse and stock were all
extracted correctly; only product identity was affected.

**2. Buy-side enquiries classified as supplier offers**
(`classify-message.buy-side-guard.js`)

The classifier emits only `Supplier Offer` or `Other`, deciding purely on the
presence of a price. A client asking to buy ("I'd like a quote for Carlsberg
Elephant ... EUR 13.55 per case") therefore classifies as `Supplier Offer`.

Until now that was contained only by the sender being unknown to Suppliers. For
a counterparty who both buys and sells — Java Distri is filed as a Client while
sending sell-side stock — registering them as a Supplier would turn their next
enquiry into an Offer to sell, at the price they asked to pay.

The guard is deliberately narrow, because the asymmetry runs the other way: a
missed offer costs more than a review line. It excludes "do you have", "do you
need" and a bare "looking for", all of which appear in genuine sell messages —
a real Pilsner Urquell offer opens "Do you need Pilsner Urquell".

## Tests

Plain node, no framework. `npm test` runs all of them:

    node n8n/tests/split-quantity.test.js
    node n8n/tests/buy-side-guard.test.js
    node n8n/tests/trade-terms.test.js
    node n8n/tests/trade-terms-digest.test.js

The two trade-terms tests **load and execute the node source** rather than
re-typing it — `new Function('$input', src)`, since a Code node is a function
body — so the test and the text pasted into n8n cannot drift. The two older
tests predate that harness and still hold their own copy of the logic; worth
converting when either is next touched.

Cases are real messages from the WhatsApp Log. The buy-side test asserts both
directions: sell-side messages must stay `Supplier Offer`, buy-side must become
`Other`.

Note `node --check` fails on `extract-wa-offers.js` with "Illegal return
statement". That is expected — an n8n Code node is a function *body*, so
top-level `return` is legal there. To syntax-check it, wrap it in a function
first.
