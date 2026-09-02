# Data rules — what an offer is and how it may be shown

These rules apply to the Astro data layer, the validator and intake skills, and
the n8n ingestion mirror. They all describe the same Airtable `Offers` table.

## Public-safe field allowlist

Only these Airtable fields are ever requested by the site (`FIELDS` in
`src/data/airtable.mjs`). Adding one is a review item: ask "could this hurt Akay if
a competitor or supplier read it?" before adding.

| Airtable field | Maps to | Notes |
|---|---|---|
| `Public Product Description` | `name` (+ `variants` if a list is split off) | required; rows with no name are dropped |
| `Variant` | `variants` | wins over any list found in the name |
| `Brand` | `brand` | |
| `Category` | `category` | defaults to `Other` |
| `Public Spec` | `spec` | pack spec, e.g. `12 x 500ml`; missing on ~24 live rows |
| `Price Display` | fallback `amount`/`currency` | used only when the detail string has no parseable part |
| `Currency` | `currency` | wins over any code found in the price strings |
| `Price Per Unit & Case` | `priceDetail`, `amount`, `priceBasis`, `unitAmount` | the authoritative price string |
| `PCS/Case` | pack size fallback | number; used when the detail/spec don't state a pack |
| `Stock Display` | `stock` | text containing "in stock" / "limited" / anything else → `in` / `warn` / `enq` |
| `Stock Cases` | `qty` | rounded to whole cases |
| `Public Terms` | `terms` | incoterm, e.g. `EXW Shannon` |
| `Bond/Customs Status` | `tier` | `T1` (under bond / export) or `T2` (duty paid) |
| `Origin Country` | `origin` | |
| `Public Listing` | filter only | fetch filter is `{Public Listing}='Yes'` |
| `Featured` | `featured` | checkbox |

**Never** requested, and never to be added: supplier name or contact, buy price,
cost, margin, internal notes, warehouse contact, BBD unless explicitly cleared.

## Price rules

1. The detail string looks like `EUR 9.24/case (12pk) · EUR 0.77/unit`. Parts are
   split on `·`. Each part yields `{currency, amount, basis}`.
2. **The headline `amount` is the first part, and `priceBasis` is that same part's
   basis.** They are never taken from different strings.
3. Recognised bases: `case`, `pack` (case-level) and `unit`, `btl`, `bottle`, `can`,
   `piece`, `jar` (unit-level). Anything else is `''` = unknown.
4. When the basis is unknown, **assert nothing**: no "/case" label, no
   `eligibleQuantity` in JSON-LD, no "per case" in the WhatsApp text.
5. `unitAmount` exists only for sorting. Case-only offers get `amount ÷ pack`; if the
   pack is unknown the case figure stays (documented as imperfect).
6. `amount` may be `null`. Guard every `.toFixed()`.
7. Currency is a 3-letter uppercase code. The `Currency` field wins; otherwise the
   code parsed from the price part; otherwise `''`.

The class of error this prevents: a `EUR 0.77/unit` offer displayed as
`EUR 0.77 / case`, or a `EUR 112.44/case` offer sorted against per-bottle prices.
Fixed three times; see TROUBLESHOOTING.

## Pack and stock rules

- Pack size: from `(Npk)` in the detail string, else a leading `N x` in the spec,
  else `PCS/Case` when > 1, else unknown.
- Stock is whole cases. A fractional value means units were entered as cases; the
  site rounds, the validator flags (check 2).
- A pack string like `12 x ` with no volume is incomplete (validator check 5).

## Name and variant rules

- `Variant` field set → name is used as-is, variants = field.
- Otherwise the name is split at the first ` — `/` – `/` - ` only if the tail has
  two or more commas **and** the head is at least 8 characters. Single-dash product
  names (`Coca-Cola Zero - 330ml`) stay intact.
- Names with 3+ commas that are not split are variant enumerations the validator
  flags (check 3). Prefer splitting rows or moving variants to the `Variant` field.
- Rows whose name starts `TESTBRAND` or `TESTPRODUCT` are dropped.
- In the WhatsApp ingestion (`n8n/`), a leading or trailing quantity with an explicit
  unit word (`1250 cs`, `24 bottles`, `500 pcs`) is stripped from the product name
  so it never becomes part of `productKey`. A bare number (`1000 Islands Vodka`) is
  left alone.

## Duty tier vocabulary

| Tier | Meaning | Who can buy |
|---|---|---|
| `T1` | under bond, duty and excise not paid | licensed importers, exporters, bonded traders |
| `T2` | duty paid in the EU | any licensed EU wholesaler or retailer |

Copy on the site must not imply a T1 price is available duty-paid.

## Display rules for prices on the site

- Show the headline amount with its own basis label from `priceParts()`, and the
  other parts verbatim as secondary text.
- WhatsApp text: `Hi, I'd like a quote for <name> (<spec>) listed at <CUR> <amount> <per basis>.`
  Each clause is dropped, not blanked, when its field is missing.
- JSON-LD `Offer.price` is `amount.toFixed(2)`; `eligibleQuantity.unitText` is
  `case` or `unit` from the basis, omitted when unknown.
- Page titles and descriptions must use the same basis logic. (Currently they don't
  on the offer page; see ARCHITECTURE known debt #4.)

## Validator and intake alignment

`.claude/skills/offer-data-validator/validate_offers.py` encodes the rules above as
checks 1–6 and exits non-zero on price errors so it can gate an import.
`.claude/skills/price-list-intake/intake_pricelist.py` normalises supplier lists
into the Airtable column set (Brand, Product Name, Variant, Volume ML, PCS/Case,
Unit Type, Buy Price, Currency, Price Type, Stock Cases, MOQ, Incoterm, Warehouse,
BBD, Notes). If you change a rule here, change it in the script and vice versa.
Note the intake columns include **Buy Price** — that column is internal and is never
part of the site's `FIELDS` allowlist.
