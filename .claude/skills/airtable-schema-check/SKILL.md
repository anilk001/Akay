---
name: airtable-schema-check
description: Verify a change against the live Airtable schema before it ships — adding a field to FIELDS in src/data/airtable.mjs, mapping a new column in an n8n Code node, writing a select value, or wiring a sub-workflow into an ingestion pipeline. Use whenever code names an Airtable field or option, or when an n8n write "fails the whole batch". Uses the hosted Airtable connector; needs no token in the sandbox.
---

# Airtable schema check

Every Airtable defect in this repo's history was the same shape: code named
a field or an option that the base did not have, or had differently, and it
was found only when a live write failed — or would have failed on the first
real run. Airtable rejects the **whole batch** on one unknown field name, so
one bad column takes every good line down with it.

What has happened (2026-09-13, trade terms normaliser):

- `MOQ Currency` accepted 5 codes; the parser resolved 12. A CHF minimum
  would have been rejected — and dropping CHF from the vocabulary would have
  been worse: "35,000 CHF" then parsed as 35,000 *cases*.
- `Parse Status` / `Parse Notes` did not exist while `PARSE_FIELDS_LIVE` was
  true. The first wiring would have errored every line.
- Routing a sub-workflow's output through a node using `autoMapInputData`
  sends every key as a column — `tradeTerms`, `parse`, `fieldsPreview` —
  and fails the create, in dry run too.

## How to check (hosted connector, works from the sandbox)

The community `mcp__airtable__*` server needs direct egress to
api.airtable.com, which the sandbox blocks. Use the hosted
`mcp__Airtable__*` tools.

1. **Find the table and field ids** —
   `mcp__Airtable__list_tables_for_base` with base `appaDSdZkAE9PGkjT`
   (the "Akay Offers" base). Site Stats is `tblC0Bnld4aZTv7dd`.
2. **Read the exact schema** — `mcp__Airtable__get_table_schema` for the
   table, narrowed to the fields you touch. Note, per field:
   - the exact **name** (case, spaces, slashes — `PCS/Case`, `Bond/Customs
     Status`);
   - the **type** — a lookup/linked field arrives as an *array*, a number
     field omits the key when empty, a checkbox is `true` or absent;
   - for `singleSelect` / `multipleSelects`: the **option names**, verbatim.
     Writing a value not in the list fails unless `typecast: true` — and
     the repo writes with `typecast: false` on purpose, so the option must
     exist first.
3. **Read one real record** with `mcp__Airtable__list_records_for_table`
   and `pageSize: 1` to see the value shapes the code will actually get.

## What to check, by kind of change

### Adding to `FIELDS` in `src/data/airtable.mjs`
- Name matches the schema exactly.
- It is public-safe: not supplier identity, cost, margin or internal
  commentary. `isForbiddenField()` runs at module load, but the regex is a
  net, not a proof — read the field's contents, not just its name. Then run
  the `public-safety-reviewer` agent.
- `normalize()` handles the empty case: Airtable **omits** empty cells, so
  the key is `undefined`. `String(undefined)` is `"undefined"` — coerce with
  `?? ''`.
- If the value can be an array (lookup, link), `normalize()` must reduce it
  to a string or number before it reaches a template.

### An n8n Code node that writes rows
- Every key the node emits is a real column, or the node is set to map
  explicit fields rather than `autoMapInputData`.
- Every select value emitted is an existing option. If the code can produce
  a value the base cannot store, decide what it does instead *in code*
  (refuse to a known-safe value and say why in a notes field) — never let it
  fall through to a different parse.
- The mirror under `n8n/` is updated **and** the node in n8n is
  **published**; a draft is invisible to the pipelines. Record the node id
  in the README next to it.
- Test with a real write at `typecast: false` and delete the record.

### A new stat, view or table the build reads
- Address it by **table id**, not name (a rename must not point the build at
  nothing).
- Only the display fields go in `STATS_FIELDS`; the internal columns go in
  `FORBIDDEN_FIELDS` so the post-build checker scans `dist/` for them.

## Do not

- Do not widen `PATTERN_EXCEPTIONS` to make a field fetchable without
  writing down, in the comment, why the name is public-by-design.
- Do not enable `typecast` to make a select write succeed; add the option
  in Airtable deliberately, or refuse the value.
- Do not trust a field list from memory or from an old README — the schema
  call is cheap and the failure is a whole batch.
