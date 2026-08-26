---
name: price-list-intake
description: Convert a supplier price list (xlsx/csv/pasted text) into Akay Offers import format - normalized columns matching the Airtable base. Use when the user gets a new supplier price list to load, or asks to prepare offers for import.
---

# Price List Intake (Akay)

Takes a raw supplier price list and produces a CSV whose columns match
the Akay Offers base (Brand, Product Name, Variant, Volume ML,
PCS/Case, Unit Type, Buy Price, Currency, Price Type, Stock Cases,
MOQ, Incoterm, Warehouse, BBD, Notes) plus a skipped-rows report.

## How to run
`python3 intake_pricelist.py <supplier-file.xlsx|csv> [--supplier NAME]`
Output: `<name>-akay-import.csv` next to the input + a console report.
Rows it cannot price are written to the report, never silently dropped
(the Akay rule: no offer disappears quietly).

## Normalization rules
- Pack strings ("12x500ml", "6 x 70cl", "24/33cl") -> PCS/Case +
  Volume ML (cl converted to ml). Unit Type guessed from volume/name
  (Can/Bottle/Piece) - review flagged guesses.
- Price: detects currency symbol/code (EUR/GBP/USD); explicit
  Price Type column wins; otherwise "per case" if price/pack ratio
  says so - ambiguous rows are FLAGGED, not guessed.
- Variants ("Flavours: A, B, C" or comma lists in the name) go to the
  Variant column, name stays clean - matching the portal fix.
- Quantity: whole cases; unit counts divided by pack and flagged if
  fractional.
- After writing the CSV, run the offer-data-validator skill on it -
  import only a clean file.

## Supplier adapters
Some lists do not fit the one-header-row shape `intake_pricelist.py`
assumes. Those get a named adapter next to it:
- `intake_surya_graha.py` - PT. Surya Graha Pasaraya (Jakarta). Handles
  brand-banner rows inside the L'Oreal/Garnier/Maybelline sheet and the
  merged cells of the Ellips sheet, expands the supplier's SKU shorthand
  where it is unambiguous (and flags what it will not guess), and applies
  the trade margin plus the offer expiry date:
  `python3 intake_surya_graha.py --loreal A.xlsx --ellips B.xlsx --out DIR
   --margin 5 --expiry-days 30 --currency USD`
  Writes `surya-graha-akay-import.csv` + `surya-graha-skipped.csv`.

## Import
Airtable: Offers table -> view "zz temp..." or any grid -> right-click
"Import data" -> CSV -> map columns 1:1 (names already match).
