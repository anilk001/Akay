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

Both changes are live. `classify-message` is a patch rather than full source
because the node could not be exported verbatim at the time; replace it with the
full source when convenient rather than transcribing it by hand.

## One known difference from the deployed node

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

Plain node, no framework:

    node n8n/tests/split-quantity.test.js
    node n8n/tests/buy-side-guard.test.js

Cases are real messages from the WhatsApp Log. The buy-side test asserts both
directions: sell-side messages must stay `Supplier Offer`, buy-side must become
`Other`.

Note `node --check` fails on `extract-wa-offers.js` with "Illegal return
statement". That is expected — an n8n Code node is a function *body*, so
top-level `return` is legal there. To syntax-check it, wrap it in a function
first.
