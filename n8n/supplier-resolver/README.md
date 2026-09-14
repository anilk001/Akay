# Supplier identity — one resolver for all four channels

`resolve-supplier-identity.js` replaces the four near-identical
`Resolve Supplier` / `Resolve WA Supplier` nodes. They drift apart every time
one of them is fixed, and all three reported supplier failures are a
consequence of that drift.

## The three failures it is built around

### 1. A colleague at a known supplier became a new supplier

The old domain index, in Excel, Email and PDF alike:

```js
if (byDomain.has(domain)) byDomain.set(domain, null);   // "ambiguous"
```

A domain seen twice was discarded as ambiguous. But two records on
`halitlar.com` are not an ambiguity — they are two colleagues. So the moment a
supplier had a **second** contact on file, every *third* person at that company
resolved to nothing and was auto-created as a duplicate. And the duplicate was
named:

```js
const createName = senderName || senderDomain || fromAddress;
```

— the sender's display name. That is the mechanism behind "duplicate supplier
accounts with slightly wrong details": one company, three records, named after
three people.

The fix asks whether the records on a domain are the same **company**, not
whether there is more than one of them. Genuinely different companies sharing a
mail host (`shared-host.com` → Newport Global *and* Pika Trading) stay
ambiguous and go to a person — and a third record is **not** created, because
an ambiguity is resolved by a human, not by adding to it.

### 2. A supplier whose details were in the email was not created

The old code found the real sender only behind a literal forward marker:

```js
src.match(/-{2,}\s*(?:Forwarded|Original)\s*message\s*-{2,}/i) || src.match(/Begin forwarded message:/i)
```

Outlook forwards, reply chains and "please see below" all fail that test. When
they did, `fromAddress` stayed `offers@akay.ie`, `externalSender` was false, and
nothing was matched *or* created — while the supplier's address sat in the body
four lines down. Addresses are now harvested from the whole body.

A created supplier is named after the **company**: a labelled line
(`Company: …`), a signature line ending in a legal form (`Bergamo Beverages
S.R.L.`), or failing both, the domain (`vinos-iberia.es` → `Vinos Iberia`).
Never the person.

### 3. WhatsApp offers landed with a blank supplier

`Resolve WA Supplier` matched on phone digits and nothing else. It ignored the
sender's display name, the group name and the message text — all of which
routinely carry the company name, a website, or a signature with an address on
it. The information was there; it was being discarded. All three are now
evidence.

## The cascade

1. **Exact email address** — the stated sender, then any address in the body.
2. **Phone / WhatsApp digits** — tolerating the trunk prefix dropped when a
   number is internationalised (`0871234567` ↔ `353871234567`). Eight digits of
   overlap is the floor; six would let two unrelated suppliers share an
   identity.
3. **Domain**, where all records on it are the same company.
4. **Company name** — sender display name, WhatsApp group name, a company line
   in the signature, the subject.

Then, only on company-level identity and never while a match is ambiguous, it
proposes a create.

If nothing resolves the answer is `confidence: 'none'`, and **no offer should be
created**. An offer with a blank supplier is an orphan: the price is real and
nobody can say who to buy it from.

## Company names are compared as tokens, never as characters

`companyTokens()` lowercases, splits on punctuation, drops single characters
(which is how `B.V.` and `S.A.R.L.` disappear without a pattern each) and drops
legal forms and subject decoration.

Two names are the same company when one token list is a leading run of the
other and the first tokens match exactly.

A character-prefix test — which is what the first draft of this node used —
reads `java` as a prefix of `javana` and files a **Javana Foods** offer against
**Java Distri**: a real company, a real price, and the wrong supplier on the
record. Whole tokens cannot do that.

Industry words (`trading`, `beverages`, `drinks`, `foods`, `distri`, `global`,
`group`, `international`) are deliberately **kept**. They look like noise and
they are not: dropping them collapses `Newport Global` and `Pika Trading` into
one identity, which is the exact mistake this resolver exists to prevent.

## What is deployed, and where

`resolve-supplier-identity.js` is the canonical, channel-neutral cascade and
its test battery. It is **not** itself deployed. Two nodes derived from it are:

| File | Workflow(s) | Node |
|---|---|---|
| `email-resolve-supplier.js` | Excel **and** PDF/Image ingestion | `Resolve Supplier` |
| `whatsapp-rescue-supplier.js` | WhatsApp ingestion | `Resolve WA Supplier` |
| `email-body-carry-supplier.js` | Email Body ingestion | `Carry Existing Supplier Id Forward` |

**The email node is byte-identical in both pipelines**, verified by SHA-256
against this file after deploying. That is the guard against the drift that
caused these issues: the two copies cannot disagree, because they are the same
16,676 bytes.

Each keeps its pipeline's existing **output contract**, so nothing downstream
was rewired — `Need Supplier?`, `Create Missing Supplier` and `Merge Supplier`
read exactly the keys they always did.

### The WhatsApp node is a rescue, not a replacement

The phone-only resolver also carries the duplicate guard, the unparseable-type
check and the Skip/Blacklist gates. None of that failed, so none of it was
touched: the original is still there as `Resolve WA Supplier (Phone)` and the
rescue runs after it. It can **only** turn unknown into known — it never
overrides a phone match, never revives a duplicate or skipped message, and
never creates a supplier, because on WhatsApp a name in the text is evidence of
who is *speaking*, not proof of who is *selling*.

Both new nodes had to take the name the workflow already reads
(`$('Resolve Supplier')`, `$('Resolve WA Supplier')`): n8n does not rewrite a
node name inside Code node source or inside an IF expression when a node is
renamed — verified against these workflows, not assumed.

### The Email Body pipeline had the worst version of issue 4

The other three matched a domain and then threw it away when two records shared
it. This one **never looked at the domain at all**. The Airtable search filtered
on the address alone:

    AND({Email} != '', LOWER({Email}) = LOWER("{{ $json.fromAddress }}"))

so it was not the third contact at a supplier that became a duplicate — it was
the **second**, and every one after. And `Create New Supplier` named it
`{{ $json.senderDomain || $json.fromAddress }}`: the bare domain string. That is
where a supplier record called `halitlar.com` comes from, sitting beside the
real `Halitlar Gida Ltd`.

The search now returns the whole supplier book once (`executeOnce`, no filter)
and the matching moved into the Code node, where the cascade can run.

**Ambiguity is not allowed to fall through into a create.** `Need New Supplier?`
used to gate on `existingSupplierId` being null — and an ambiguous match is also
null, so it would have created a third record for a domain that already had two
companies on it. It now gates on an explicit `createSupplier` boolean.

One contract had to be preserved exactly: `Attach New Supplier & Finalize
Offers` reads this node **positionally**
(`$('Carry Existing Supplier Id Forward').all()[$itemIndex]`), so the output is
still one item per original email, in the original order. The tests assert that
first, before anything about matching.

## Known, pre-existing, and not introduced here

That positional read misaligns when a single batch contains **both** a matched
sender and an unmatched one: the matched item goes straight to
`LLM Extract Offers` while the unmatched one detours through
`Create New Supplier`, and the two arrive in a different order than
`Carry Existing Supplier Id Forward` emitted them. The Airtable create nodes
replace the item, so there is no key to correlate on — which is why the original
author reached back positionally in the first place.

This predates these changes and is untouched by them. It is recorded here rather
than quietly worked around, because the fix is a restructure of that branch, not
a line.

`update_workflow` also reports a `MISSING_EXPRESSION_PREFIX` warning on
`Carry Existing Supplier Id Forward`. It is a false positive: the two `{{ }}`
it finds are inside the header comment, quoting the old filter formula and the
old `Supplier Name` expression. `jsCode` is not an expression field.

## Tests

    node n8n/tests/supplier-identity.test.js          # the canonical cascade (43)
    node n8n/tests/email-resolve-supplier.test.js     # what Excel and PDF run (33)
    node n8n/tests/whatsapp-rescue-supplier.test.js   # what WhatsApp runs (36)
    node n8n/tests/email-body-carry-supplier.test.js  # what Email Body runs (30)

Every node source is loaded and executed, not re-typed.
