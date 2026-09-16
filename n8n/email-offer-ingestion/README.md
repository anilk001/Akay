# Email Body Offer Ingestion — node source

Mirrors of two Code nodes from **Email Body Offer Ingestion — Akay**
(`8oPUD8d9NPVBEime`). As everywhere under `n8n/`, this is a mirror, **not the
running system** — nothing here changes anything until the file is pasted into
the node and the workflow is PUBLISHED.

| File | Node | State |
|---|---|---|
| `extract-body-blocks.js` | Extract Body Blocks | full source + fix, **not published** |
| `flatten-block.js` | Flatten Block | full source + fix, **not published** |

## Why these were changed

Epic (EUROPEIA PORTUGUESE INTER COMMERCIO, `sandro@9665675.brevosend.com`)
sends its ExW New Corp price list through Brevo. Brevo stacks content blocks,
and Epic types each offer line into its own block, so the list arrives as **one
`<table>` per line** rather than one table of 13 rows.

The 2026-09-16 list held 13 lines. Three were ingested. The same thing had
happened on 2026-09-09 with the same 13 lines. Nothing errored either time —
the offers simply were not there, and the gap only showed up when the email was
read against Airtable by hand.

**1. `Extract Body Blocks` dropped ten of the thirteen lines.**

```js
for (const grid of htmlTables(afterForward(html))) {
  if (grid.length >= 2) blocks.push({ type: 'table', rows: grid });   // ← here
}
```

The `>= 2` bar is there to skip layout tables, and it is a reasonable bar when
a list is one table. Against Brevo's markup every line is a one-row table and
fails it. The real email held eleven product tables: ten with a single row, and
one that happened to carry three lines plus spacer rows. Only that one cleared
the bar, which is exactly the three offers that appeared.

The fix rejoins a list that markup split. `mergeStackedRows()` merges
consecutive grids that agree on column count, once a single-row table has
started the run — column count because it is what the downstream column map
keys on, so grids that disagree were never one table. Two *multi-row* tables
are still left alone: those are two real lists, and fusing them would put one
list's headings into the other's data. A one-cell layout wrapper is excluded by
a three-column floor, and a restated header row is dropped on the join.

**2. `Flatten Block` then used only the first block.**

```js
const first = blocks[0] || null; // first/primary block only, by design
```

Whatever followed was discarded without an exception or a note. This is the
DETERMINISTIC path, so it did not bite here — the LLM extractor prompt is
handed the whole `blocks` array, which is why three offers still came through.
It would have bitten the moment someone filled in a column map for a sender
whose list arrives split: raising a profile from Low confidence to High would
have quietly *cut* the offer count. Now every block that agrees with the first
on type and column count is appended, and any block left out is named in
`blocksSkipped`.

## Deploying

Paste each file into its node and publish the workflow. `n8n/README.md`
explains why publishing is the step that matters: a draft in n8n is invisible,
and a node left unpublished once cost ~5,000 unclassified WhatsApp messages.

Verified before publishing: run against the raw HTML of execution `54558`
(2026-09-16 07:45) the patched extractor returns `blocksFound: 1` with 13 rows
of 9 columns, in document order, sender `sandro@9665675.brevosend.com`.

## Still open

`Flatten Block` treats `rows[0]` as the header row. Epic's list has **no header
row** — the merged grid is 13 data rows — so on the deterministic path the
first line would be eaten as headings. It does not matter today because Epic's
Sheet Profile (`recJq1uloeTJeIQj4`) is Low confidence with no column map, so
the LLM path runs and reads all 13. It has to be settled before that profile is
promoted to High: either the profile records that the sender sends no header,
or the header row is detected rather than assumed.
