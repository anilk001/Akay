# Offer Dispatch — change log

## 2026-09-02 — audit fixes (repo: DONE · n8n: PENDING APPROVAL)

Full report: [`../AUDIT-2026-09-02.md`](../AUDIT-2026-09-02.md).

| Node | Change | Why |
|---|---|---|
| `Style as HTML` → **`Render HTML`** | Anthropic node removed; deterministic Code node in its place (`render-html.js`) | Blocked 4 of 9 runs (temperature 400, credits ×3), fell back on 2 of 4 that ran |
| `Build Sends` | `idempotencyKey` per send (`build-sends.js`) | Retries / overlapping runs / re-queues could double-deliver |
| `Send via Resend` | `Idempotency-Key: {{ $json.idempotencyKey }}` header | ditto |
| **`Claim Dispatch Group`** + **`Write Claim`** | New, between `Recipients OK?` and `Compose Email` (`claim-dispatch-group.js`) | Queue flag was cleared only at the end; concurrent runs re-read it (29311 ‖ 29315) |
| `Fail Loudly on Halt` | Recovers the reason from Await Approval / Reconcile (`fail-loudly-on-halt.js`) | "no reason recorded" on 21497, 28559, 29315 |
| ERROR HANDLER `Compose Alert` | Consequence depends on node + message (`error-handler-compose-alert.js`) | Said "NO OFFERS WERE EMAILED" after 507 were delivered (28570) |

**Apply** (on a day with no dispatch in flight):

1. `update_workflow` with the contents of `apply-2026-09-02.dispatch.json`.
2. `publish_workflow dAYMAj6mZD3hTV4T`; assert `versionId === activeVersionId`; assert nodes
   `Render HTML`, `Claim Dispatch Group`, `Write Claim` exist and `Style as HTML` does not.
3. `update_workflow` with `apply-2026-09-02.error-handler.json`; `publish_workflow OnCFbngmILTKsdkw`.
4. Proving run: one small group, `PILOT`-style (a single client record if possible); confirm
   `Reconcile._summary` reads `Dispatch complete — N/N sent`, the Sent Log rows exist, the
   HTML version rendered (approval mail shows `HTML STYLING: OK`), and `Queued for Dispatch`
   was already unticked when the approval mail arrived.

**Rollback**: `restore_workflow_version` to `86e75e04-5066-4843-93c9-5eaa0e6a3117`
(published 2026-09-01 10:01). The Anthropic node's configuration is in that version.

**Verification**: `node test-nodes.cjs` → 38/38. Tests 24 run the real renderer through the
real `Verify HTML` on six bodies (both 2026-08 fixtures, the 2026-08-19 bundle, a single
offer, a shared-lead-time bundle with a quoted note).

---


## 2026-08-19 — Terms printed per line on mixed-warehouse bundles

**Symptom.** A bundle whose lines ship from different warehouses told every
recipient that all of it shipped from one warehouse.

**Cause.** `compose()` read Public Terms from `resolvedMembers[0]` only and
printed a single closing `Terms:` line for the whole mail. `Public Terms` is not
one of `Build Recipients`' `AUDIENCE_KEYS`, so a mixed-warehouse bundle passes
every gate. Worse, which warehouse got named depended on the order Airtable
returned the records in, so the same bundle could mis-state either side.

**Found on.** Bundle `SPIRITS-APERITIFS-T2-2026-08-19` — three lines EXW
Loendersloot, one EXW Intereuropa, Slovenia, aimed at 391 buyers. Caught in
preview, before sending.

**Fix.** Count the distinct non-empty Public Terms across the group.
- More than one → print `Terms: <line's own terms>` inside each product block,
  between `Status:` and `Quantity:`, and print no closing Terms line.
- One or none → unchanged: one closing `Terms:` line, nothing per line.

The existing suppression rule is preserved in both modes: a warehouse the
surviving Public Note already names is not printed again.

**Verification.** `node test-nodes.cjs` — 19 cases. Tests 3 and 4 assert that a
same-warehouse bundle and a single offer render **byte identically** to
`n8n/compose-email.baseline.js` (the version live on 2026-08-18), so the change
is provably inert outside the mixed-terms case. Tests 1, 2 and 5 cover the new
behaviour, including the "one line has terms, others blank" boundary.

**Rollback.** Restore the previous workflow version in n8n history, or paste
`n8n/compose-email.baseline.js`.

## 2026-08-19 — repo source of truth restored

`.claude/skills/offer-dispatch/` was referenced by the canonical method in
Airtable but did not exist on any branch of anilk001/Akay, so the preflight and
preview steps the method requires could not be run at all. The Code nodes were
recovered from the live workflow (version `da008da0-1e1b-4f9a-9d1e-3cafaa82a51a`,
updated 2026-08-18) and committed here as the source of truth, with the preview
script and regression suite rebuilt around them.

Still missing versus the method's description: `preflight_dispatch.py`. The gate
checks it performed are re-run inside the workflow itself; the content checks it
performed are not yet reimplemented.

## Before 2026-08-19

Items 1-6 in the header comment of `n8n/compose-email.js` record the
2026-08-18 patch (price basis, MOQ and validity printed, Public Note
de-duplication, leak-guard false positive on whole-number Buy Price,
deterministic group selection, approval moved after composition).
