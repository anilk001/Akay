---
id: 2
title: Intake script cannot read compact supplier headers, and has no markup step
status: open
type: open-source
skill: [price-list-intake]
proposes_skill: []
siblings_checked: "akay offer-data family: price-list-intake, offer-data-validator — the header-matching half is shared and is filed under observation 1; the markup gap and the header-as-metadata point are specific to the intake half (the validator never reads supplier files), so no propagation for those. offer-data-validator not added."
area: intake_pricelist.py convert()/pick(); SKILL.md normalization rules
date: 2026-09-09
session_context: Converting a supplier price list into the Akay import CSV
parked_until:
resolved:
resolution:
reference:
---

**Issue:** A real supplier sheet used compact headers — a two-letter column for
case quantity and a combined currency/basis column of the form `<CUR>/cs`. The
intake script's header matcher searches for long substrings ("cases", "qty",
"price type", "per"), none of which occur in headers that short, so stock
quantity came out blank for every row and currency came out blank for every
row. Price type was then guessed row by row and flagged, producing a
review-flag on essentially every line — noise that hides the handful of rows
that genuinely need a human.

None of this failed. It produced a complete-looking CSV with two empty columns
and 200+ spurious flags.

The root cause of the currency and price-type loss is that both facts were
stated **in the header**, not in the cells: `<CUR>/cs` declares the currency
and the per-case basis for the whole column, authoritatively, while the script
only ever inspects cell values and so has to guess what the header already
said.

Separately, there is no markup capability at all. The output carries Buy Price
only, so the routine step of deriving a sell price from a supplier cost has no
home in the skill and gets improvised per run.

**Suggested improvement:** In `intake_pricelist.py`, (a) match headers by
normalised token equality first — a header of `cs` should match the concept
"cases" — before falling back to substring containment, and treat a two-letter
header as a legitimate name rather than noise; (b) parse the header itself for
currency and basis (`USD/cs`, `EUR/case`, `GBP/btl`) and let it set Currency
and Price Type for the whole column, falling back to per-cell guessing only
when the header is silent — a fact stated once for a column should not be
re-derived, less reliably, 200 times; (c) add a `--markup PCT` option that
emits `Sell Price` and `Markup %` alongside Buy Price, never overwriting Buy
Price, so margin stays auditable after import. Document all three in SKILL.md.

**Principle:** In tabular imports the header is data, not decoration: when a
column header states a unit, currency or basis, read it and let it govern the
column, instead of inferring the same fact per row from the values. And when a
derived commercial figure is wanted, add it as a new column — never overwrite
the source figure it was derived from, or the derivation becomes unauditable
the moment it lands.
