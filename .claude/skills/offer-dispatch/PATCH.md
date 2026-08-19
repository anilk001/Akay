# Compose Email — change log

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
