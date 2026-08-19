# Offer Dispatch (Akay)

Send an offer from the Offers table to targeted clients through the
**Offer Dispatch — Akay** n8n workflow (id `dAYMAj6mZD3hTV4T`). One run
sends ONE dispatch group: a single offer, or every offer sharing a
Bundle ID. Canonical rules live in Airtable → System Instructions →
"OFFER DISPATCH TO CLIENTS — Canonical Method"; this directory holds the
scripts and the versioned Code nodes that method refers to.

## Never send by hand
Do not fan out mail from Gmail or build a one-off workflow. That skips
the leak guard, the approval gate, the unsubscribe line and the Offers
Sent Log rows, which is where the 2026-08-14 and 2026-08-17 incidents
came from. The workflow is the only send path.

## Five gates, in the order they run
1. Send Eligible = Yes (Status Live, not expired, approved, not Do Not Broadcast).
2. A **Verified** Backup Registry row dated today (Europe/Dublin).
3. At least one eligible recipient after the client filters.
4. Composition + leak guard.
5. Human approval by email to ak@akay.ie (3-day limit).

Listing Approved is NOT a gate here — it controls offers.akay.ie only.
Never tick it to make a send work.

## Before you queue anything
```bash
node compose_preview.cjs fixtures/<your-dispatch>.json   # exact outgoing text
node test-nodes.cjs                                      # required after ANY node edit
```
`compose_preview.cjs` runs the same `compose()` the node runs, read out
of `n8n/compose-email.js`, so the preview cannot drift from what sends.
Neither the approver nor the client should be the first to read the mail.

A dispatch fixture is a JSON array of offer objects keyed by Airtable
**field names**, in the order you want the products printed — see
`fixtures/zentner-spirits-2026-08-19.json`.

## Targeting lives on the offer
- `Target Countries` — matched against Clients.Country, folded for case,
  spacing and punctuation, then compared exactly. Blank = all countries.
- `Target Capsule Tags` — client needs any one. Blank = no tag filter.
- `Match Interest Category` — when ticked, clients with blank Interest
  Categories are excluded too.
- Bundle members must agree on Target Countries, Target Capsule Tags,
  Bond/Customs Status, Match Interest Category and Category, or gate 3
  halts. **Public Terms is deliberately not in that list** — see below.

Then tick `Queued for Dispatch` on every line of the group and trigger
the workflow, or leave it for the 08:00 Europe/Dublin schedule. The flag
clears on send OR halt, so a halted group must be re-queued by hand.

## What the mail may contain
Public-safe fields only: Public Product Description, Public Spec, Price
Per Unit & Case (falling back to Price Display + Price Type), Bond/Customs
Status, Availability or Stock Display, MOQ, Lead Time, Public Terms,
Public Note, Auto Expiry Date. **Never** Offer Name, Notes, Trader
Comment, Delivery Info Source, Supplier Name, Buy Price or Margin % —
the leak guard halts the whole run on a hit.

Two rules that caused real damage:
1. **A price must state its basis.** Use Price Per Unit & Case, never a
   bare Price Display.
2. **Public Note is for what the fields do not carry.** Do not paste
   price, MOQ, terms or validity into it; the product block prints all
   four and the composer drops note lines that restate them.

Check Margin %. Blank means Sell Price = Buy Price — you are quoting cost.

## Mixed-warehouse bundles
A bundle may collect stock from more than one warehouse, because Public
Terms is not one of the audience keys. When the members' Public Terms
differ, the composer prints `Terms:` inside every product block instead
of once for the whole mail, so no line can be read as shipping from
another line's warehouse. When they all agree, the output is unchanged:
one closing Terms line. Added 2026-08-19 — see PATCH.md.

## Changing a Code node
The Code nodes are versioned here, not in the n8n UI. Edit the file, run
`node test-nodes.cjs`, paste, then read the node back and diff it. There
is no way to exercise the live workflow without emailing real clients, so
that suite is the only gate. `n8n/compose-email.baseline.js` is the
version live on 2026-08-18 and exists so the tests can assert that
unchanged scenarios still render byte identically — update it only when
deliberately re-baselining. Roll back through n8n workflow history.

## Do not say it went out
until the execution is `success`, `Reconcile._summary` reads "Dispatch
complete — N/N sent", and Offers Sent Log has N rows with Dispatch
Status = Sent. A partial send is never retried automatically.
