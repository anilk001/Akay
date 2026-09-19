# Purge — Offers Sent Log

Workflow `hbZKmATpQ8tNTMh1` — **created 2026-09-19, INACTIVE, never run.**

A daily rolling purge that keeps `Offers Sent Log` (tbllLvPXjXrAdZX3b) from
eating the base's record cap, without losing the dispatch audit trail.

| Node | File |
|---|---|
| Backup Gate | `backup-gate.js` |
| Re-check And Cap Batch | `recheck-and-cap-batch.js` |

Tests: `n8n/tests/purge-offers-sent-log.test.js` (22 cases, nearly all of the
form "it must refuse to delete X").

## Why this exists

On 2026-09-19 the base held 138,605 records against a 125,000 cap. `Offers Sent
Log` was the single largest table at 33,521 rows — 24% of the base — growing at
~493/day, faster than anything else. It is a pure append-only junction table:
one row per offer per client per send.

Nothing computes from it. There are no rollups, lookups or count fields
anywhere in the base — only plain record links — and `src/data/airtable.mjs`
reads only `Offers` and `Site Stats`, so akay.ie never sees this table. Deleting
rows here cannot change a computed value or the public site.

## Why it is gated rather than simply scheduled

`Offers Sent Log` is not disposable. It is the evidence that a dispatch
happened. The canonical method in `System Instructions` is explicit:

> DO NOT SAY IT WENT OUT until the execution is 'success' … and Offers Sent Log
> has N rows with Dispatch Status=Sent.

and the Aperol 2026-07-27 partial send (449 recipients BCC'd, only 275 log rows)
was *detected by counting rows in this table*. Wiping it would destroy the
record of what was sent to which client.

It does not need re-exporting, though, because `Daily Backup — Akay`
(`Jwc1Em8Qh4qUUZLl`) already exports this table to Google Drive every morning —
it is item 8 in that orchestrator's `AIRTABLE_TABLES` list. So the purge does
not copy anything. It deletes only what the backup already holds, and it proves
that before deleting:

1. the newest `Backup Registry` row is dated **today** (Europe/Dublin), and
2. its `Status` is **Verified** (not Flagged, not Failed), and
3. **`Offers Sent Log` appears in its `Tables Covered`**.

Condition 3 is not paranoia. `Export Each Table` is deliberately set to
`continueRegularOutput` so one bad table id degrades the backup instead of
destroying it — which means a backup can be Verified overall while this
specific table is missing from it. That has happened twice: on 2026-08-03 and
2026-08-04 a dead `WhatsApp Log` id aborted the run at that list position and
the nine tables after it, `Offers Sent Log` among them, went unbacked without
anyone noticing.

If any condition fails the workflow deletes nothing and emails ak@akay.ie
saying which one. That is expected behaviour on a day the backup is late or
flagged, not an error.

## What it will and will not delete

Deletes a row only when **all** of these hold:

- `Sent Date` is set and is older than `RETENTION_DAYS` (30)
- `Dispatch Status` is **not** `Draft` and **not** `Ready to Send`

Never deletes:

- a row with no `Sent Date` — its age cannot be established (6 such rows today)
- a row still queued to go out, whatever its age
- anything, on a day the backup gate is shut

A blank `Dispatch Status` **is** purgeable once old. About 2,990 of the oldest
rows carry no status; they are history from before the field was populated, not
pending work. Only the two explicit pending states are protected.

Every rule above is asserted twice: once in the Airtable `filterByFormula`, and
again in `recheck-and-cap-batch.js` over the rows that come back. A formula typo
silently *widens* a delete set, and the cost of that here is the whole audit
trail, so the second pass drops anything the first should not have matched.

## Throttles

| Constant | Value | Purpose |
|---|---|---|
| `RETENTION_DAYS` | 30 | how much history stays live in Airtable |
| `MAX_PER_RUN` | 2000 | ramps the backlog down over days instead of one huge run |
| `ABORT_IF_MORE_THAN` | 25000 | a candidate set this big means the filter is wrong — throws, deletes nothing |

Only three fields are requested from Airtable so items stay small; building fat
per-item objects is what OOM-crashed run 11091.

## Expected first runs

Measured 2026-09-19: **6,194** rows are older than 30 days and not pending. At
2,000/run that is four days to drain, then a steady state of roughly 500/day in
and 500/day out, holding the table near 15,000 rows.

That first drain frees about 6,200 records. It is **not** on its own enough to
get under the 125,000 cap — moving `Clients — Capsule Archive` (19,036) out is
the other half of that job.

## Before publishing

- It is **inactive**. Publishing it is what arms the deletion.
- Consider running it once manually with `MAX_PER_RUN` set to something small
  (10) and confirming the summary email and the row count before letting the
  schedule have it.
- The trigger is 07:30 Europe/Dublin, after the 06:00 backup. If
  `Daily Backup — Akay` ever moves later, move this too or the gate will just
  block every day.
- **`Daily Backup — Akay` currently has an unpublished draft that changes its
  trigger to every 2 days** (`daysInterval: 2`, edited 2026-09-19 08:34). If
  that gets published, this purge will only be able to run on backup days,
  halving its throughput while the table keeps filling at the same rate.
- This workflow deliberately writes **nothing** to `Backup Registry`. That table
  is read by the dispatch gate ("a VERIFIED row dated TODAY") and by the next
  backup's `Parse Previous Table Counts`, which takes the newest row. A purge
  row there would satisfy the dispatch gate without a backup having happened,
  and would corrupt the next run's count comparison.
