# Trade Terms Exception Digest — Akay

Weekly email to Anil and Annika listing what the normaliser could not read.

Parsing at ingestion stops the problem growing. It does not stop new wording
appearing. This is the part that prevents the next backfill: a pattern seen 40
times in one week is a five-minute edit to the normaliser; the same pattern
found after 18 months is a day of dry runs against live data.

| File | Node | Workflow |
|---|---|---|
| `build-parse-digest.js` | Build Parse Digest | Trade Terms Exception Digest — Akay |

## Workflow shape

```
Schedule (Mon 07:00) → Airtable: Search Offers → Build Parse Digest → Gmail: Send
```

Airtable node, `Offers` table, filter formula:

```
IS_AFTER({Created}, DATEADD(TODAY(), -7, 'days'))
```

Fields to return: `Parse Status`, `Parse Notes`, `MOQ Type`, `Lead Time Days`,
`Supplier Name`. Set Build Parse Digest to **Run once with all items**.

Map the send node to `{{ $json.subject }}`, `{{ $json.html }}` and
`{{ $json.text }}`.

## What it reports

- **Distinct unrecognised strings** from the last 7 days, with a count and the
  suppliers they came from, commonest first. This is the edit list for the
  normaliser, already in priority order.
- **Suppliers over 50% Unrecognised** — usually means their list format changed.
  Suppliers with fewer than 3 lines in the week are skipped: two bad lines out
  of two is noise, not a signal.
- **Coverage**: % of new lines with MOQ resolved, % with lead time resolved.
  This is the number that says whether the whole exercise is working.

Only `Unparsed:` segments of `Parse Notes` are listed as unrecognised wording.
The normaliser also writes explanatory notes there ("MOQ taken from the list
header"), and those would drown the list.

## One thing to keep an eye on

Supplier names appear in this digest because it is an internal email. They must
never travel any further — the site's `FIELDS` allowlist in
`src/data/airtable.mjs` exists precisely to keep supplier identity out of
anything public.

## Tests

    node n8n/tests/trade-terms-digest.test.js
