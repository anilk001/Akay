# PDF/Image Offer Ingestion — `Mark Needs Review` 404

**Workflow:** `PDF/Image Offer Ingestion — Akay` (`aZvwBunq4W07XqL3`)
**Failing node:** `Mark Needs Review` (Gmail, thread → addLabels)
**Error:** `The resource you are requesting could not be found (item 0)` —
Gmail `404 notFound` on `threads.modify`
**Failed runs:** 14809, 14891 (11 Aug), 17367, 17377, 17450 (14 Aug),
20420, 20429, 20482 (18 Aug)

Recorded because two of the three findings here are systemic, not local.

## What was ruled out, with evidence

The obvious causes are all wrong, so don't re-check them:

- **The thread exists.** `1a0141a194cb9a68` — "Fwd: Guinness Draught 4x6x44cl &
  Kilkenny 50cl | DAP Riga", labels `UNREAD, Akay/Resubmitted, Process_Akay,
  SENT, INBOX`. Fetched successfully outside n8n.
- **The threadId reaching the node was valid.** `Parse Offers` ran once with one
  item carrying exactly that id, matching the Gmail Trigger's.
- **The label exists.** `Label_9` = `Akay/Needs-Review`, 22 messages.
- **The operation is permitted.** Adding `Label_9` to that exact thread through
  the Gmail connector **succeeded**.
- **The sibling node works.** `Mark PDF Done` does the same thread→addLabels and
  succeeded at 08:01 on 18 Aug (thread `1a013e24d37f45bd`, `Label_10`).

## What is left, and it needs 20 seconds in the UI

Every observation is consistent with **`Mark Needs Review` authenticating as a
different Gmail account than the trigger and `Mark PDF Done`**. Gmail returns 404,
not 403, for a thread that is not in the authenticated mailbox — so a wrong
credential looks exactly like a missing thread.

The error snapshot shows `Mark Needs Review` using `gmailOAuth2` credential
`1C9YXLyY85aeKPpf` ("Gmail account"). The n8n API strips credentials from
`get_workflow_details` and from version snapshots, so **which credential
`Mark PDF Done` uses cannot be read through MCP** — only the UI shows it.

> **Action for Anil:** open both `Mark PDF Done` and `Mark Needs Review` and
> confirm they point at the same Gmail account. There are six `gmailOAuth2`
> credentials on this instance ("Gmail account" 1–5 and "offers n8n"), and the
> base already has one credential-hygiene incident on record (the dead duplicate
> "Bearer Auth account 2", deleted 2026-08-06).

This is an inference, not a proof. It is the only hypothesis left standing.

## Fixed on 18 Aug, published

A reviewed fix for a *different* bug had been sitting in the draft since 14 Aug,
never published — see the version-trap note below. It adds
`Collect Threads (Done)` / `Collect Threads (Review)`, which emit one item per
**distinct** thread so a poll carrying several emails labels all of them, and
switches both label nodes to `$json.threadId`. Two flaws in that draft were fixed
before publishing:

1. **`Mark PDF Done` still had `executeOnce: true`,** which defeated the new node
   completely — `Collect Threads (Done)` carefully emits N distinct threads and
   `executeOnce` then discards all but the first. Removed.
2. **Neither label node retried.** Both now retry 3× with a 2 s gap.

`onError` was deliberately left at `stopWorkflow`. The 404 is not transient, and
`continueRegularOutput` would convert a visible failure into a silent loop:
an unlabelled thread keeps getting resent by the Catch-up Sweep and reprocessed.
Once the credential question is settled, revisit — labelling is bookkeeping and
should not fail a run that already created offers in Airtable.

The batching this fixes is real: execution 14809 carried two threads in one run,
`19fef9d5d8f5a415` (Smirnoff Ice) and `19fef9d5949a35bd` (Bluebird spirits), and
only one could ever be labelled.

## The version trap — the systemic finding

**This n8n instance uses draft / published versions. `update_workflow` writes to
the draft. Production keeps running the published version until
`publish_workflow` is called.**

- The PDF labelling fix was authored 14 Aug and never published. Production had
  been failing for four days on a bug already fixed in the editor.
- The entire dispatch repair earlier the same day was also still unpublished, and
  therefore not live, until this was noticed. It is now published.
- **`Excel Offer Ingestion — Akay` (`j1NAhQEKz9hzi1T2`) still has an unpublished
  draft that nobody has reviewed.** Review it before publishing — the PDF draft
  needed two corrections, and an ingestion workflow writes to Airtable.

Anything reading a workflow to explain a failure must read the **published**
version (`get_workflow_version` with `activeVersionId`). `get_workflow_details`
returns the draft, and the two diverge.

## Why this made every offer need a human

The 404 does not just fail one node. It breaks the **self-healing loop**, which is
why a labelled email ends up needing someone to ask Claude to process it.

Traced end to end on the Guinness/Kilkenny offer:

| Time (UTC) | What happened |
|---|---|
| 07:58 | Email arrives in `Process_Akay`, message `1a013e0f6d12bd47` |
| 08:00, 08:05 | PDF ingestion fires on the new arrival and **fails** — the 404. No Done label written |
| 09:00 | Catch-up Sweep sees it stranded (>45 min old, no Done label), resends it → new message `1a0141a194cb9a68` |
| 09:01 | Ingestion runs on the copy and **fails again** — the same 404 |
| next sweep | The copy carries `Akay/Resubmitted`, so it is **not** resent again. It gets `Akay/Needs-Review` and one alert to ak@akay.ie |

The one retry is now spent, and `Akay/Needs-Review` is in the sweep's exclusion
list (`-label:Akay/Needs-Review`), so **nothing will ever pick that mail up
again**. A human has to. That is the loop being described as "we always have to
tell Claude".

So: labelling an email really is automatic (see below), and the automation really
does work. It is the ingestion failure that consumes the retry budget and strands
the mail. Fix the credential and this stops.

## Labelling `Process_Akay` by hand: how it actually reaches ingestion

n8n's Gmail Trigger fires only on **newly arriving** mail — it compares
`internalDate` against a watermark, so an older message that is newly *labelled*
never looks new. The `Backfill — Get Message` node's own note states this.

The bridge is **`Catch-up Sweep — Process_Akay Stranded Mail`**
(`NlzK9DMrkNmfcZoY`), and its sticky note says so explicitly: *"This also makes
MANUALLY labelling any email with Process_Akay work."* It runs every 30 minutes,
finds `Process_Akay` mail with no Done/Needs-Review label that is more than 45
minutes old, and **resends it to offers@akay.ie** so the triggers see a fresh
arrival. Verified healthy: 530 executions, every recent one successful.

Two consequences worth knowing:

- **Latency is up to 30 minutes** for hand-labelled mail — the sweep interval. The
  45-minute rule is measured on when the email *arrived*, not when it was
  labelled, so an old email is already "settled" and only waits for the next tick.
  Genuinely new mail is unaffected: the live trigger polls every minute.
- **There is exactly one retry.** A resent copy is labelled `Akay/Resubmitted`,
  and the sweep refuses to resend anything already carrying it. That is the right
  call against infinite loops, but it means a single ingestion failure permanently
  strands the mail behind one alert email that is easy to miss. A standing digest
  of queued `Akay/Needs-Review` mail would make the backlog visible instead.

## Also worth knowing

The failing run's own summary said `IMG_0306.JPG — 0 offers … 0 rows dropped for
no price`, i.e. the vision parse returned nothing at all from a photo. That is the
`attention` flag doing its job — the mail genuinely needed a human. The labelling
was the only broken part.
