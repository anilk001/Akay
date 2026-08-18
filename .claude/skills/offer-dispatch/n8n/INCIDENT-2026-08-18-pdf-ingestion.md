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

## Also worth knowing

The failing run's own summary said `IMG_0306.JPG — 0 offers … 0 rows dropped for
no price`, i.e. the vision parse returned nothing at all from a photo. That is the
`attention` flag doing its job — the mail genuinely needed a human. The labelling
was the only broken part.
