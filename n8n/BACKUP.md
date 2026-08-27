# Daily Backup — operational notes

Workflows in n8n (`akay-team.app.n8n.cloud`):

| Workflow | ID | Role |
|---|---|---|
| `Daily Backup — Akay` | `Jwc1Em8Qh4qUUZLl` | Orchestrator. Fires 06:00 Europe/Dublin, creates the Drive folder, calls the sub-workflow once per table, writes the Backup Registry row. |
| `Backup — Export One Table` | `qQC2K28u7KnoP2ut` | Exports one Airtable table to a JSON file in that folder and returns a count. |

## Why this matters for dispatch

Gate 2 of `OFFER DISPATCH TO CLIENTS — Canonical Method` requires a Backup
Registry row **dated today (Europe/Dublin) with Status = Verified**. The
orchestrator writes `Flagged` instead of `Verified` whenever any table is
missing from the backup or drops >15% against the previous row — so a backup
failure blocks the day's Offer Dispatch.

**The remedy for a Flagged row is to re-run the backup, not to edit the row.**
Setting Status to Verified by hand makes the gate pass while the backup is
still incomplete, which is precisely the state the gate exists to catch. Once a
re-run exports all 14 tables it writes its own `Verified` row dated today and
the gate passes legitimately.

## 2026-08-27 — Products missing, Flagged (Drive rate limit)

Execution 26491 reported 13 of 14 tables; `Products` was absent. The
sub-workflow execution for Products (26495) failed at **Upload Table Export**:

```
403 NodeApiError — "Forbidden - perhaps check your credentials?"
Quota exceeded for quota metric 'Queries' and limit 'Requests per minute'
of service 'drive.googleapis.com' for consumer 'project_number:498586711441'
reason: rateLimitExceeded / RATE_LIMIT_EXCEEDED
```

It was **not** a credential problem and **not** data loss, despite what the
registry note and the alert email suggest:

- `Fetch Table Records` and `Summarize & Detect Anomaly` both ran fine — the
  Airtable read succeeded and only the Drive write failed.
- Live `Products` held 3,898 records at the time of review, up from 3,797 in
  the 08-26 backup. Nothing was deleted.
- The registry note's stock explanation ("most likely cause is a table id in
  the orchestrator that no longer matches the base") was wrong here. The
  orchestrator's Products id `tbl1m5HfC2yzWECGb` matches the live base.
- The alert email's wording ("dropped more than 15%") is hardcoded in the
  Gmail node and is sent for a missing table too. Read the registry Notes
  field, not the email body, to tell the two cases apart.

`Client Price History: 0` in the counts is normal — that table has been empty
in every backup on record, so it is not part of this incident.

### Fix applied

`Upload Table Export` had no retry, so one transient quota burst dropped a
whole table from the backup. It now has `retryOnFail` with 5 tries, 5s apart,
which absorbs a short burst. The orchestrator's `Export Each Table` node
already carries `onError: continueRegularOutput`, so a table that still fails
after the retries degrades the backup and flags it rather than aborting the run.

### Outcome

Re-run as orchestrator execution 26790 (12:13 Dublin): **14 of 14 tables,
55,518 records**, Products at 3,898. It wrote its own row for 2026-08-27 with
Status **Verified** (`recKJYe16244WPDm5`), so dispatch Gate 2 is satisfied.

The 05:06 `Flagged` row was left as Flagged — it is an accurate record of an
incomplete backup — with the review findings appended to its Notes. Both rows
now carry today's date, which is harmless: `Backup Check` in
`Offer Dispatch — Akay` filters *all* registry rows for Status = Verified AND
Backup Date = today and takes the first match, rather than reading the latest
row and checking its status.

### Precedent

2026-08-24 was the same failure class — `Products` and `Invoices` both failed
to upload, the 05:06 run logged Flagged, and a manual re-run at 11:17 exported
14 of 14 and logged Verified. Two occurrences in four days, both on the
largest tables, is what motivated the retry rather than another manual re-run.

### Residual risk

The per-minute Drive quota is shared by every workflow on Google Cloud project
`498586711441`. Five retries 5s apart cover roughly 20s of a 60s quota window,
so a sustained burst can still get through. If this recurs after the retry, the
next step is to space the per-table uploads out (a Wait node in the
orchestrator loop) rather than to raise the retry count.
