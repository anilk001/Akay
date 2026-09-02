# Dispatch brief — Johnnie Walker T1, FOB Singapore

Internal. Prepared 2026-09-02 by Claude Code for Anil.
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
Data check: case ÷ pack reconciles to the per-bottle figure on both lines; stock is
whole cases; currency set. Both rows pass the offer-data-validator checks.

## Recipient count

Segment = Clients with Capsule Tag **Indv spirits**, in the seven named countries.

| Country | Mailable | of which tagged *T1 Spirits* |
|---|---|---|
| Singapore | 49 | 35 |
| Netherlands | 40 | 1 |
| UAE | 34 | 12 |
| Poland | 14 | 1 |
| Latvia | 14 | 0 |
| Russia | 14 | 0 |
| Panama | 4 | 1 |
| **Total** | **169** | **50** |

How that number was reached:

1. 1,342 clients carry the *Indv spirits* tag.
2. 205 of them sit in the seven target countries (all Active, all have an email address,
   none flagged Do Not Contact, none with Excluded Bond Status = T1).
3. −14 carry the **No Mailing** tag → 191.
4. −22 carry **Spirits T2 ONLY** → **169**. These are EU buyers who have said they only
   take duty-paid stock; this offer is T1, so they should not get it.

### Two things that follow from the count

- **The dispatch workflow will send to 191, not 169.** Build Recipients filters on Target
  Capsule Tags and Excluded Bond Status — it has no knowledge of the *Spirits T2 ONLY*
  tag. The structural fix is to set **Excluded Bond Status = T1** on those 22 client
  records (12 NL, 6 LV, 4 PL). Find them in Airtable → Clients, filtered on Capsule Tags
  *has* `Spirits T2 ONLY`; then the workflow lands on 169 by itself and every future T1
  offer is protected too. Without that, drop them by hand.

  Client names and addresses are deliberately kept out of this repo — the recipient and
  suppression lists were handed over as separate CSVs.
- **444 *Indv spirits* clients have a blank Country** and are therefore unreachable by
  this send: Target Countries is an include-only list, so a blank country never matches.
  Not a bug — worth knowing that the seven-country targeting reaches 169 of a 1,342-strong
  segment.

## Proposed Airtable dispatch settings

Set identically on both rows (bundled lines must agree on the audience keys):

| Field | Value |
|---|---|
| Bundle ID | `JW-T1-SG-2026-09-02` |
| Bundle Title | `Johnnie Walker Black & Red — T1 FOB Singapore` |
| Target Capsule Tags | `Indv spirits` |
| Target Countries | `United Arab Emirates, Netherlands, Russian Federation, Panama, Singapore, Latvia, Poland` |
| Excluded Countries | blank — or `Russia` if the check below is not cleared |
| Match Interest Category | leave unticked (the capsule tag already narrows; ticking also drops blank-interest clients) |
| Queued for Dispatch | tick only at dispatch approval |

Country strings are matched through the base's country folding, so `Russian Federation`
also catches `Russia`, and `United Arab Emirates` catches `UAE`.

## Flags before you send

1. **MOQ is blank on both rows.** The client copy says "on request", which is honest but
   weak. Confirm with the supplier whether part-lots load or it is FCL only, then fill the
   field. The nearest comparable lot on the base is FCL only.
2. **Do not market the price delta.** The base shows Black −11.0% and Red −13.8% against
   the best comparable, but that comparable is priced **CFR Major Global Ports** while this
   is **FOB Singapore** — CFR carries the freight, FOB does not. The gap is partly the
   incoterm, not purely a better price, so it is not a claim to put in front of a buyer.
   Both lines are genuinely the cheapest of their spec on the base; that stands on its own.
3. **Russia (14 recipients).** Goods are UK-origin Scotch and Akay is an EU operator, so
   confirm the line may be offered to Russian buyers under the applicable EU/UK measures
   before including that segment — and expect payment/banking friction even if it clears.
   Unresolved → put `Russia` in Excluded Countries and send to the other 155.
4. **Escrow.** The supplier is direct-payment only, so the offer states escrow is not
   available. Any client who normally insists on escrow will push back.
