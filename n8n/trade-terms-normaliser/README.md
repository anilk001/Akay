# Trade Terms Normaliser — Akay

Parses MOQ, lead time and mixed-load out of every incoming supplier line **at
the moment it is ingested**, resolves it through a cascade, and labels where the
value came from.

Free text is kept as evidence (`rawProductName`, `Parse Notes`), never as the
operational value.

## Why it is a sub-workflow

The parser gets extended every time a supplier words something a new way. Four
pasted copies means four edits and three of them get forgotten — the existing
four-way copy of the "no EAN stated" logic already shows that drift. One
sub-workflow, called from all four pipelines, means one edit.

| File | Node | Workflow |
|---|---|---|
| `normalise-trade-terms.js` | Normalise Trade Terms | `WQ6A8IVLSAd72fnk` — Trade Terms Normaliser — Akay (sub-workflow, **published 2026-09-13**) |

Published, but **nothing calls it yet**. A sub-workflow with no caller runs
nothing and changes nothing, so this is rollout step 1 only.

## Where it goes in each pipeline

Immediately after **Apply Default Margin**, which already reads the supplier
record — so `Default MOQ Qty`, `Default MOQ Unit` and `Default Lead Time Days`
are in hand and cost nothing extra to pass in.

```
… → Apply Default Margin → Execute Sub-workflow: Trade Terms Normaliser → Upsert Offer → …
```

Set the Execute Sub-workflow node to **Run once with all items** so the header is
parsed once per list rather than once per line.

### Input mapping

One item per line. Everything not listed is passed through untouched, so the
caller's own keys survive the round trip.

| Key | Excel | Email | PDF | WhatsApp |
|---|---|---|---|---|
| `rawName` | mapped product column | table cell | line text | product fragment (`COL.productName`) |
| `rawMoq` | MOQ column if the profile has one | MOQ column | MOQ cell | `COL.moq` |
| `rawLeadTime` | lead-time column | lead-time column | lead-time cell | `COL.leadTime` |
| `rawNotes` | notes / remarks / conditions | notes column | notes cell | the rest of the message |
| `headerText` | sheet header rows above the table | email body above the table | PDF top block | the message's non-product lines |
| `supplierDefaults` | the supplier record already fetched by Apply Default Margin | — | — | — |
| `category` | resolved category | — | — | — |
| `dryRun` | optional per-item override | — | — | — |

`headerText` matters more than it looks. Order-level terms usually sit in the
header — "Minimum mixed order USD 35,000" is a property of the list, not of any
one line — and a line-only parser finds nothing on 2,000 rows in a row.

### Output

```js
{
  ...everything the caller sent,
  productName,      // cleaned: "Jim Beam Apple 12x70cl MOQ 50 cases" → "Jim Beam Apple 12x70cl"
  rawProductName,   // the original, so nothing is lost
  tradeTerms,       // resolved values in camelCase
  fields,           // Airtable field name → value, ONLY the keys resolved. {} when dryRun
  fieldsPreview,    // what `fields` would have been, always populated
  parse,            // { status, notes[], unrecognised[] }
}
```

Map `fields` straight into the Airtable node. It contains only keys that were
actually resolved, so it can never write a blank over an existing value.

## Fields it resolves

| Field | Notes |
|---|---|
| `MOQ Type` | Order Value / Cases / Cartons / Bottles / Pieces / Pallets / Container / Full Truckload / No Minimum / Applies — Unspecified |
| `MOQ Qty` | lower bound where a range is given |
| `MOQ Currency` | only when Type = Order Value |
| `MOQ Source` | Supplier Stated / Parsed From Text / Supplier Default / Category Rule |
| `Mixed Load Allowed` | checkbox, public. Set only on an explicit statement either way |
| `Lead Time Days` | 0 = ex-stock; **upper** bound where a range is given |
| `Parse Status` | Clean / Partial / Unrecognised |
| `Parse Notes` | what could not be resolved on this line |

`Parse Status` (Clean / Partial / Unrecognised) and `Parse Notes` were added to
the Offers table on 2026-09-13, so `PARSE_FIELDS_LIVE` is correctly `true`. Set
it false only if they are ever removed — an Airtable node handed an unknown
field name errors the whole batch, taking every good line in it down with the
one it could not write.

`MOQ Currency` offers EUR, USD, GBP, AED and SGD. A minimum stated in any other
currency is read, refused and reported rather than published; see **Never
guess** below.

## The cascade

```
line value  →  list header  →  supplier default  →  category rule  →  unknown
```

A default is only consulted when everything above it was silent, and `MOQ Source`
records which tier answered. `Supplier Stated` means the value arrived in its own
column; `Parsed From Text` means it was dug out of a name, a note or a header.

`CATEGORY_RULES` ships **empty on purpose**. A category rule publishes an MOQ
that no supplier ever stated, on every line in that category, for as long as
nobody notices — that is the exact shape of "never guess". The tier is wired and
tested, so adding one is a single line once Anil or Annika has signed it off
against real supplier behaviour.

## Parsing rules inherited from the backfill

- **Money minimums dominate.** Three quarters of stated MOQs are whole-offer
  values, not per-line counts. Both orderings are matched — `USD 35,000` and
  `35,000 USD` — along with `35k`, `35.000` and `35 000`.
- **Ranges resolve in the buyer's favour.** MOQ takes the lower bound, lead time
  the upper. Deliberately opposite, deliberately consistent.
- **Ex-stock is a real value, not a blank.** `ex-stock`, `immediate`, `prompt`,
  `on floor`, `in stock` → `Lead Time Days` = 0. A stated duration still wins:
  "in stock, delivery 3 days" is three days, not zero.
- **Working days convert at five to the week.** "10 working days" is 14 calendar
  days. A buyer asks when goods arrive, not how many shifts the warehouse works.
- **"Mixed" is a selling point.** `mixed`, `can be mixed`, `flexible variants`,
  `partial quantities permitted` → tick. `no mixed pallets`, `full pallets only`
  → untick. Silence leaves it alone.

## The four rules that keep it honest

1. **Never guess.** Unmatched text sets nothing and goes to `Parse Notes`. A
   bare `MOQ: 50` is fifty of *what* — it resolves only if the supplier record
   carries a `Default MOQ Unit`, otherwise the qty is left blank. A wrong MOQ on
   a public page costs more than a missing one, and the site already renders
   "MOQ on request" gracefully.

   The same rule covers a currency the base cannot store. `MOQ Currency` offers
   five codes; a minimum in a sixth is recognised **precisely so that it can be
   refused**. Dropping the code from the vocabulary instead looks like the
   obvious fix and is the dangerous one: with `chf` unrecognised, "Minimum order
   35,000 CHF" stops matching as money, falls through to the bare-number rule,
   borrows the supplier's default unit and publishes **MOQ 35,000 cases**.
2. **Never let a default overwrite a stated value.** Cascade order, enforced.
3. **Never block ingestion on a parse failure.** Every line is parsed inside a
   try/catch; a throw emits the line untouched with the error in `Parse Notes`.
   Lines going missing is the worse failure — the silent-loss guard exists
   because of it.
4. **Never write a blank over an existing value.** `fields` carries only the
   keys actually resolved.

## Rollout

1. ~~Build the sub-workflow.~~ Done — `WQ6A8IVLSAd72fnk`, published
   2026-09-13, verified against this file with a 12-case battery run through
   the deployed node.
2. Wire it into **one** pipeline with `DEFAULT_DRY_RUN = true`, ingest a real
   list, and compare `fieldsPreview` against the source file by hand.
3. Roll to the other three. Excel and Email share a shape; PDF and WhatsApp are
   the noisy ones and go last.

   **Excel is wired (2026-09-13) as a DEAD-END OBSERVATION BRANCH, not in-line.**
   `Create Offers` maps with `autoMapInputData`, so every key on the item
   becomes an Airtable field — routing this node's output through the main path
   would send `tradeTerms`, `parse`, `fields` and `fieldsPreview` as unknown
   columns and fail the entire create batch, dry run included, because `dryRun`
   only empties `fields` and does not remove the scaffolding.

   Going live therefore needs an **Apply Trade Terms** node after the
   sub-workflow that returns only the original payload merged with `fields`,
   and Essential Fields Gate rerouted to read from it. Two open items before
   that: `headerText` is empty for Excel (order-level terms sit in the rows
   above the table, which Detect Header consumes and does not pass on), and
   `DRY_RUN` in Build Trade Terms Input has to be flipped at the same time.
4. ~~Add `Parse Notes` / `Parse Status` to the Offers table.~~ Done 2026-09-13,
   verified with a real write at `typecast: false`. Still to do: schedule the
   exception digest (`../trade-terms-digest/`).
5. Only then set the historic backfill (`6bQp3mZgAvfq8Wfo`) live, so old and new
   data land in the same shape.

## Extending it

When the next round of fields is added — EAN / barcode, cases per pallet, cases
per 20' and 40', gross weight and cube, best-before, label language, HS code —
they belong in **this node**, with the same cascade and the same source
labelling. Only add a field when its parser goes in at the same time. A field
added ahead of its parser is how free text ends up in the base.

## Ask for it at source too

Parsing is a workaround for lists that do not carry the data. The next version
of the spirits supplier outreach template, and the standard reply to any new
supplier, should ask for five things on every list: **list date, MOQ, lead time,
pack configuration, EAN**.

And where a supplier's terms are stable, set `Default MOQ Qty`,
`Default MOQ Unit` and `Default Lead Time Days` on their supplier record once,
alongside `Default Margin %` and Trust Score. Twelve supplier records cover 85%
of the current lead-time gap.

## Tests

    node n8n/tests/trade-terms.test.js

The test **loads and executes this node's source** rather than re-typing it, so
a regex fixed in the node is a regex the tests see. Cases are the wordings the
12 September backfill found across 2,052 records.
