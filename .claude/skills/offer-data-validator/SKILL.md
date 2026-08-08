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
   12x500ml" class of error).
2. **Whole cases**: stock quantity in cases must be a whole number.
   Fractional cases (e.g. 12,412.3) mean units were entered as cases.
3. **Variant lists in product name**: names containing 3+ commas or
   long dash-separated lists are variant enumerations, not names.
   Suggest: split into separate rows or move variants to a Variants
   field.
4. **Truncated brand**: single-word brands that match the first word
   of a multi-word product name ("THE" from "The Epicurean") - flag
   for manual brand correction.
5. **Incomplete pack spec**: pack strings like "12 x " with no volume
   - flag missing unit size.
6. **Currency sanity**: price present but currency missing, or
   currency not in {EUR, GBP, USD}.

## How to run
Run `python3 validate_offers.py <file.csv|file.xlsx>` from this
skill's directory. With no file argument, it reads rows from stdin
(paste from Airtable). The script prints a numbered report and exits
non-zero if any check-1 (price) errors exist - so it can gate a
publish pipeline later.

## Output format
One line per problem: `[SEVERITY] row N (Brand - Product): issue ->
suggested fix`. Severity: PRICE > STOCK > NAME > BRAND > PACK > CURR.
End with a summary count per severity.
