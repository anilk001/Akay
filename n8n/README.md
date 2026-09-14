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
| `signature-harvest/harvest-contact-details.js` | *(not built in n8n yet)* | Harvest Contact Details | full source, **not published** |

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

**Reply signatures fill blank contact fields instead of being thrown away**
(`signature-harvest/`)

Offer emails reply to ak@akay.ie, so every auto-reply, out-of-office and short
"not this month, try me in October" lands in the mailbox `Email Enquiry Intake`
already polls. That workflow discards them on purpose — `NOISE_SUBJECT` matches
"out of office" and "automatic reply" — which is correct for enquiries and
throws away the best contact data we receive. An out-of-office is the one
message that reliably carries a full signature block.

`harvest-contact-details.js` reads those messages and fills **blank** Contacts
fields: `Contact Name`, `Company`, `Phone (E.164)`. It never overwrites.

The whole design is shaped by one instruction (Anil, 2026-09-14): use the
details of the person we emailed; if they belong to somebody else, do not
process the message. That is not fussiness. A large share of out-of-office
replies read "in my absence please contact Jane Murphy, jane@other.com,
+353 87 …", and harvesting that writes Jane onto the buyer's row — a
plausible-looking contact belonging to nobody, in the table used for outreach.
Worse than the blank it replaced, because a blank is visibly missing and a wrong
name is not. So two independent signals reject the WHOLE message rather than the
offending line: a handover phrase anywhere in the harvest region, or any email
address there that is not the sender's own. Both fail closed. The cost is missed
harvests, which is the right way round.

Our own addresses are exempt from the second guard — auto-responders echo
"your email to offers@akay.ie", and without the exemption almost nothing would
ever be harvested.

Two things it deliberately does NOT do:

- **Company is never derived from the email domain.** That turns gmail.com into
  "Gmail" and a personal address into a fake employer. Only a line carrying a
  real company suffix (Ltd, GmbH, B.V., …) is read.
- **WhatsApp is never written.** A number in a signature is not proof of a
  WhatsApp account. Contact Sync already establishes that properly by checking
  numbers against Whapi and setting `On WhatsApp` / `WhatsApp Chat ID` from a
  real sighting, so a harvested number goes into `Phone (E.164)` and the Monday
  sync confirms it. Asserting WhatsApp here would put unverified numbers into
  the broadcast audience.

Phone normalisation is lifted from Contact Sync's `norm()` rather than rewritten,
so a number harvested here produces the identical E.164 key — otherwise the same
person becomes two Contacts rows. Never-guess is preserved: a national-format
number with no country evidence is left unwritten.

`DEFAULT_DRY_RUN` is `true`. It stays that way until a batch of real proposals
has been eyeballed.

## Earlier changes (published 2026-09-13)

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
    node n8n/tests/signature-harvest.test.js

The two trade-terms tests and the signature-harvest test **load and execute the
node source** rather than
re-typing it — `new Function('$input', src)`, since a Code node is a function
body — so the test and the text pasted into n8n cannot drift. The two older
tests predate that harness and still hold their own copy of the logic; worth
converting when either is next touched.

Cases are real messages from the WhatsApp Log. The buy-side test asserts both
directions: sell-side messages must stay `Supplier Offer`, buy-side must become
`Other`.

The signature-harvest cases are mostly REFUSALS, because that node's entire risk
is writing one person's details onto another person's row: the handover phrase,
the colleague's address on the same domain, the national number with no country
evidence, the domain that must not become a company name. Its first version of
the test helper merged the per-case override into `json` instead of into
`fields`, so three "never overwrite" assertions silently tested a row whose
fields were still blank and passed for the wrong reason. Worth remembering when
adding cases: assert the refusals hardest, and check a passing test is testing
what it claims.

Note `node --check` fails on `extract-wa-offers.js` with "Illegal return
statement". That is expected — an n8n Code node is a function *body*, so
top-level `return` is legal there. To syntax-check it, wrap it in a function
first.
