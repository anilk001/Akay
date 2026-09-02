# Changing an n8n workflow — the only allowed way

Fifty live edits in August produced a new error on nearly every send day
(`docs/INCIDENTS.md`, tags LIVE-EDIT and DRAFT). This protocol exists so that never
happens again. It applies to every workflow in `docs/SYSTEMS.md`; the dispatch
workflow is the strictest case.

## 0. Is now the time?

- **No run in flight, nothing queued.** `search_workflow_executions` with status
  `running`/`waiting` on the workflow. For dispatch also check `Queued for Dispatch`
  is unticked everywhere (`list_records_for_table` on Offers, filter `fldAiPD3Z47lXmb85 = true`).
- **Not a send day** for dispatch. If a send just failed: fix the *cause* (credential,
  credits, data), re-queue, and change the workflow tomorrow.
- **Is it a workflow problem at all?** Check `docs/SYSTEMS.md` "External services" first.
  Four of the month's failures were Resend, Anthropic, the n8n plan, and Airtable.

## 1. Edit the repo file, not the node

Code nodes live in `.claude/skills/offer-dispatch/n8n/*.js` (dispatch, error handler) and
`n8n/*/` (WhatsApp). Each file header names its node. If a node has no file yet, read the
**published** version (`get_workflow_version(activeVersionId)`), save it as the file first,
commit that, then change it.

## 2. Test

```bash
node .claude/skills/offer-dispatch/test-nodes.cjs      # must print "N passed, 0 failed"
```

Add a test for the behaviour you are changing. The suite runs the real node bodies with a
fake `$` / `$input`, so anything a node reads (`$('Node Name').first().json`) can be staged.
Fixtures under `n8n/fixtures/` are real Airtable records from real sends. There is no other
test: exercising the live workflow emails real clients.

## 3. Apply — one atomic `update_workflow` call

- One named version per change: `versionName` ≤ 80 chars, `versionDescription` ≤ 1000 chars,
  saying what and why, with execution ids. The version history is the only change log n8n has.
- Prefer a saved payload file (`n8n/apply-YYYY-MM-DD.<workflow>.json`) generated from the
  source files, so what was applied is what was tested. Diff the `jsCode` in the payload
  against the file with `jq -j … | diff - file`.
- For `updateNodeParameters` pass only the keys you change; the default is a merge.
- Removing a node also removes its connections; add the replacement's connections explicitly.

## 4. Publish, then prove it

```
publish_workflow(workflowId)
get_workflow_details(workflowId)  →  versionId === activeVersionId, activeVersion.sameAsDraft === true
```

Then read the changed nodes back and diff their `jsCode` against the repo files, byte for
byte. Check the connections around the change. A draft that is not published is invisible to
production — this trap cost four days of PDF ingestion and a whole dispatch repair in August.

## 5. Record

Same commit: the source file, the test, the payload file, an entry in the workflow's
`PATCH.md`, and — if anything broke on the way — a line in `docs/INCIDENTS.md`. Mirror any
*rule* change into the Airtable `System Instructions` record so claude.ai chat sessions see it.

## 6. Prove in production

The first real run after a change is the proving run. For dispatch, watch the approval mail
(`HTML STYLING: OK`, recipient count, deferred groups), the queue flag (already unticked when
the mail arrives), and `Reconcile._summary` (`Dispatch complete — N/N sent`). Say so in
`PATCH.md` once it has happened.

## Rollback

`get_workflow_history` → pick the previous version → `restore_workflow_version` →
`publish_workflow` → the same read-back check. Dispatch's last known-good versions:
`6a013bba` (2026-09-02), `86e75e04` (2026-09-01).

## Things that look like fixes and are not

- Editing a node in the n8n UI "just this once".
- A TEMP hard-coded record id in `Find Sendable Offers` to make one offer go out.
- A new one-shot workflow for one campaign.
- Disabling `Verify HTML`, the leak guard, the backup gate or the approval step to get a send through.
- Ticking `Listing Approved` to satisfy a send.
