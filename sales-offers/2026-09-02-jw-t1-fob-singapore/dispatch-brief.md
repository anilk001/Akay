# Dispatch brief — Johnnie Walker T1, FOB Singapore

Internal. Prepared 2026-09-02, updated after Anil's go on pricing and audience.
Sensitive fields (supplier identity, buy price, margin) are deliberately not repeated
here — read them off the Airtable rows.

## The two offers

| | Black Label | Red Label |
|---|---|---|
| Airtable record | `rec5U8XvWe2gUHLBj` | `rece9uNeTX4YrLASD` |
| Pack | 12 × 100cl · 40% | 12 × 100cl · 40% |
| Sell price | USD 204.75/case · USD 17.06/btl | USD 98.70/case · USD 8.23/btl |
| Stock | 1,000 cases | 1,000 cases |
| Terms | FOB Singapore · T1 | FOB Singapore · T1 |
| Offer date / validity | 2026-09-01 / 2026-09-16 (supplier default 15 days) | same |
| Status | Live · Approved · Send Eligible · Public Listing Yes | same |

Full lot: **2,000 cases / 24,000 bottles / USD 303,450** at offer prices.
Pricing confirmed by Anil: the 5% margin already embedded in the rows is the send price.

Data check: case ÷ pack reconciles to the per-bottle figure on both lines; stock is
whole cases; currency set. Both rows pass the offer-data-validator checks.

## Recipient count — 191

Segment = Clients with Capsule Tag **Indv spirits**, in the seven named countries,
**both T1 and T2 buyers** (Anil's instruction — bond preference is not filtered on).

| Country | Recipients | T1 Spirits tag | Spirits T2 ONLY tag | No bond preference |
|---|---|---|---|---|
| Netherlands | 52 | 1 | 12 | 39 |
| Singapore | 49 | 35 | 0 | 14 |
| UAE | 34 | 12 | 0 | 22 |
| Latvia | 20 | 0 | 6 | 14 |
| Poland | 18 | 1 | 4 | 13 |
| Russia | 14 | 0 | 0 | 14 |
| Panama | 4 | 1 | 0 | 3 |
| **Total** | **191** | **50** | **22** | **119** |

How that number was reached:

1. 1,342 clients carry the *Indv spirits* tag.
2. 205 of them sit in the seven target countries — all Active, all with an email address,
   none flagged Do Not Contact, none with Excluded Bond Status = T1.
3. −14 carry the **No Mailing** tag → **191**.

The 22 clients tagged *Spirits T2 ONLY* are included on instruction. They have previously
said they take duty-paid stock only, so expect some "T2 only please" replies from the
Netherlands, Latvia and Poland — the per-market line in the email copy offers them the
Loendersloot T2 list by return, which turns those replies into a second shot rather than
a dead end.

**444 *Indv spirits* clients have a blank Country** and are therefore unreachable by this
send: Target Countries is an include-only list, so a blank country never matches. Not a
bug — worth knowing that the seven-country targeting reaches 191 of a 1,342-strong segment.

## Airtable dispatch settings — written 2026-09-02

Set identically on both rows (bundled lines must agree on the audience keys):

| Field | Value |
|---|---|
| Bundle ID | `JW-T1-SG-2026-09-02` |
| Bundle Title | `Johnnie Walker Black & Red — T1 FOB Singapore` |
| Target Capsule Tags | `Indv spirits` |
| Target Countries | `United Arab Emirates, Netherlands, Russian Federation, Panama, Singapore, Latvia, Poland` |
| Excluded Countries | blank |
| Match Interest Category | unticked — the capsule tag already narrows, and ticking would also drop blank-interest clients |
| Queued for Dispatch | **not ticked** — the one remaining action |

Country strings are matched through the base's country folding, so `Russian Federation`
also catches `Russia`, and `United Arab Emirates` catches `UAE`. Both rows read
Send Eligible = Yes, so ticking Queued for Dispatch and running the Offer Dispatch
workflow is all that is left.

## Flags still open

1. **MOQ is blank on both rows.** The client copy says "on request", which is honest but
   weak. Confirm with the supplier whether part-lots load or it is FCL only, then fill the
   field. The nearest comparable lot on the base is FCL only.
2. **Do not market the price delta.** The base shows Black −11.0% and Red −13.8% against
   the best comparable, but that comparable is priced **CFR Major Global Ports** while this
   is **FOB Singapore** — CFR carries the freight, FOB does not. The gap is partly the
   incoterm, not purely a better price, so it is not a claim to put in front of a buyer.
   Both lines are genuinely the cheapest of their spec on the base; that stands on its own.
3. **Russia (14 recipients) is included per instruction.** Noted once for the file: the
   goods are UK-origin Scotch and Akay is an EU operator, so the sanctions position and
   payment route are Anil's call. Excluded Countries is the field to use if that changes.
4. **Escrow.** The supplier is direct-payment only, so the offer states escrow is not
   available. Any client who normally insists on escrow will push back.

Client names and addresses are deliberately kept out of this repo — the recipient list
was handed over as a separate CSV.
