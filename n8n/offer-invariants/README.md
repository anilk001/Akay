# Offer invariants — the last gate before an offer exists

`enforce-offer-invariants.js` is a Code node that sits immediately before the
`Create Offers` Airtable node in **all four** ingestion pipelines. Nothing
reaches the Offers table without passing through it.

## Why one gate instead of four fixes

Every rule in this node already exists somewhere in the base. That is the
problem, not the solution:

| Rule | Excel | Email | PDF | WhatsApp |
|---|---|---|---|---|
| Strip `Listing Approved` | `Expand Offers` deletes it | `Offers to Create` deletes it | listed in `READ_ONLY` | `Offers to Create` deletes it — while `Build Airtable Payload` still *sets* it three nodes earlier |
| Apply a margin | `Apply Default Margin` | `Apply Default Margin` | `Apply Default Margin` (added 2026-09-06, after PDF batches shipped with no margin at all) | `Apply Default Margin` |
| Validity fallback | inline in the payload builder | inline | inline | a node of its own, `Validity Fallback 30d` |

Four copies of one rule means the rule is only ever three-quarters true, and
the quarter that is false is whichever pipeline was not edited that day. That
is why the same symptoms keep coming back on a different channel.

The WhatsApp row is the clearest case. `Build Airtable Payload` contains:

```js
if (autoApproved) fields['Listing Approved'] = true;
```

It is currently harmless only because `Offers to Create`, three nodes further
on, deletes it again — and that node's own comment warns that the header
comment upstream is stale. One rewire and the website gate ticks itself.

## What it does

**Removes, always:**
- `Listing Approved` and `Send Approval Status` — the two human-only gates.
- Every formula, lookup and rollup field (`Sell Price`, `Auto Expiry Date`,
  `Public Listing`, the `Supplier *` lookups …). Writing one of these errors
  the Airtable request, and with a batch size of 10 that is ten offers that
  silently never arrive.

**Holds** — writes the record, but as `Status = Hold`,
`Offer Approval Status = Awaiting Approval`,
`Claude Review Status = Pending Review`, with the reason in `Notes`:
- no `Margin %` (or zero)
- no `Supplier` link
- no `Product Name`, no `Buy Price`, no `Currency`

**Defaults** — fixes and carries on, noting it:
- no `Auto Expiry Days` → 30

### Hold or default?

Hold when getting it wrong misstates the trade — those records reach a client.
Default when the safe value is obvious *and* errs toward less exposure: an
offer with no expiry never expires and sits Live at a stale price forever, so
30 days is strictly safer than blank.

### It never invents a margin

`Apply Default Margin` has already had its turn, with the supplier's
`Default Margin %` and the 5% company default behind it. A record arriving here
with no margin means something upstream genuinely broke, and the one response
that is never acceptable is to make a number up and let the offer go Live:

```
Sell Price = IF(AND({Buy Price},{Margin %}), ROUND({Buy Price}*(1+{Margin %}),2), {Buy Price})
```

With `Margin %` blank, **Sell Price is the buy price**. A margin-less offer that
reaches the site is publishing what we paid.

### It never drops a record

A dropped offer is a supplier email nobody ever answers. Everything is written;
what fails an invariant is written held, where the daily
*Awaiting Website Publish* digest and Annika both see it.

## Output shape

`Create Offers` uses **Map Automatically**, so every top-level key on an item
becomes an Airtable column. This node therefore emits Airtable field names and
nothing else — no counters, no flags, no debug keys. The run summary goes to
`console.log`, where the execution log keeps it.

## Tests

    node n8n/tests/offer-invariants.test.js

The node source is loaded and executed (`new Function('$input', src)`), not
re-typed, so the rule the tests assert is the rule pasted into n8n.
