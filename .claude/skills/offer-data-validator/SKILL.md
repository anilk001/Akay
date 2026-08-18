---
name: offer-data-validator
description: Validate Akay offer rows before publishing to the portal - catches price/pack/name data errors that break offers.akay.ie cards. Use when the user asks to check offers, validate a price list, or before a portal publish.
---

# Offer Data Validator (Akay)

Validates offer rows against the data rules that keep offers.akay.ie
clean. Input: CSV/XLSX export of the Offers table (or rows pasted as
text). Output: a numbered problem list, worst first, with the exact
row and a suggested fix.

## Checks (in priority order)
1. **Case price vs unit price**: if pack size N > 1, then
   price_per_case should be ~N x price_per_unit (tolerance 2%).
   Flag rows where case == unit while N > 1 (the "EUR 0.77/case for
   12x500ml" class of error). A published unit price is rounded to
   2dp, so the case price it implies is a band ((unit +/- 0.005) x N),
   not a point - a case figure inside that band is not an error. This
   check needs case and unit prices supplied INDEPENDENTLY; it cannot
   detect anything when one was derived from the other.
2. **Missing price basis**: a blank Price Type is published as a CASE
   price by the Price Per Unit & Case formula. If the supplier actually
   quoted per unit, the case price on the card is understated by the whole
   pack factor - e.g. H&S 330ml at EUR 1.88 shows as a case of 6
   (EUR 0.31/bottle) when EUR 1.88 is the per-bottle price and the case is
   EUR 11.28. Split by how bad the result is:
   - **PRICE** (gates the publish) when the implied per-unit price falls
     below `MIN_UNIT` (EUR 0.60) - no real FMCG unit wholesales that low,
     so the figure cannot be a case price.
   - **BASIS** (warns only) otherwise. Blank is right more often than not,
     because spirits are quoted per case; gating on every blank would bury
     50 real errors under 500 correct rows and get the gate ignored.

   Only runs when the export actually carries a Price Type / price basis
   column: an absent column says nothing about the data, an empty cell is
   a real gap.
3. **Whole cases**: stock quantity in cases must be a whole number.
   Fractional cases (e.g. 12,412.3) mean units were entered as cases.
4. **Variant lists in product name**: names containing 3+ commas or
   long dash-separated lists are variant enumerations, not names.
   Suggest: split into separate rows or move variants to a Variants
   field.
5. **Truncated brand**: single-word brands that match the first word
   of a multi-word product name ("THE" from "The Epicurean") - flag
   for manual brand correction.
6. **Incomplete pack spec**: pack strings like "12 x " with no volume
   - flag missing unit size.
7. **Currency sanity**: price present but currency missing, or
   currency not in {EUR, GBP, USD}.

## How to run
Run `python3 validate_offers.py <file.csv|file.xlsx>` from this
skill's directory. With no file argument, it reads rows from stdin
(paste from Airtable). The script prints a numbered report and exits
non-zero if any PRICE-severity errors exist (checks 1 and 2) - so it
can gate a publish pipeline later.

Pack size is read from a pack string ("12x500ml", "6 x 70cl") or, when
there is none, from a numeric PCS/Case column - so a raw Airtable
export of the Offers table validates without reshaping. Export
Price Type along with it, or check 2 stays silent.

## Output format
One line per problem: `[SEVERITY] row N (Brand - Product): issue ->
suggested fix`. Severity: PRICE > BASIS > STOCK > NAME > BRAND > PACK >
CURR. Only PRICE gates the publish.
End with a summary count per severity.
