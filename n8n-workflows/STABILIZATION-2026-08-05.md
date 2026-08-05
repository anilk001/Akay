# n8n Stabilization Pass — 2026-08-05

Root-cause diagnosis and fixes for the recurring failures across the Akay n8n
instance (2,316 failed executions since 2026-07-29). All fixes were applied to
the live workflows **and published** (this instance uses a draft/publish model —
an unpublished fix does nothing, which was itself a major root cause).

## The three systemic root causes

1. **The draft/publish trap.** Fixes were repeatedly saved to a workflow's
   *draft* but never *published*, so production kept running the old broken
   version — "fixed it, but the next offer fails the same way." Found **three**
   active workflows in this exact state (all now published):
   - Price Intelligence — draft dropped the deleted `Products` field; published
     version still requested it → 422 every hour.
   - Contact Sync — draft had the evidence-based phone-normalisation fix;
     published version still silently dropped national-format numbers.
   - Daily Backup — draft repointed the WhatsApp Log table + continue-on-error;
     published version still hit the dead table and aborted the whole backup.

2. **The error handler was itself broken.** `Compose Alert` referenced an
   undefined `ALERT_TO`, so the handler crashed on every failure and **no alert
   was ever sent**. The business was blind to all failures — which is why
   problems were only found by manually prompting. Fixed (defined `ALERT_TO`);
   failure alerts to ak@akay.ie are restored.

3. **Airtable schema drift.** Deleted/renamed tables and fields kept breaking
   workflows that still referenced the old IDs:
   - WhatsApp Log table deleted + recreated (`tblSfenvu7iuvO4Ha` →
     `tblRuHFp55Up7NT7n`). Broke both WhatsApp workflows and the backup.
   - Offers `Products` link field no longer exists → broke Price Intelligence
     and Link Offers To Products.
   - `Portal Login Registry` referenced by the backup draft never existed.

## Fixes applied this pass (all published)

| Workflow | Fix |
|---|---|
| ERROR HANDLER — Akay Alerts | Defined `ALERT_TO='ak@akay.ie'`; alerts work again |
| Price Intelligence — Akay | Published the draft that removed the dead `Products` field (hourly 422 gone) |
| Contact Sync | Published the draft with the phone-normalisation fix |
| Daily Backup — Akay | Removed phantom `Portal Login Registry` table, published the WhatsApp-ID + continue-on-error fixes (backup completes → stops silently blocking dispatch) |
| Daily Close Sweep — Process_Akay | `Remove Process_Akay` used `$json.id` (undefined) → label never removed, mail piled up. Fixed to `$json.threadId` |

## Already healthy (verified, no change needed)
- WhatsApp Filter Layer & WhatsApp Offer Ingestion — table ID already repointed; recent runs all green.
- Offer Dispatch — Akay — published & healthy. The no-BCC / per-recipient mail-merge / Resend / Capsule-tag + country filtering rule is correctly implemented; the long "wait" is the **human approval gate** (Await Approval), working as designed, not an error.
- Supersede Supplier Price Lists, PDF/Image Offer Ingestion, Bounce & Reply, Backup — Export One Table, Timewaster Governance Report — published, no draft drift.

## Complete reference audit (added — full sweep, not sampling)

Established ground truth from Airtable (**14 tables**) and mechanically checked
**every** Airtable node in **every** workflow — table IDs, read `fields`, write
`columns`, and `filterByFormula` — against the live schema.

- **Dead TABLE references:** none remaining. Every workflow points only at the
  14 live tables. (The dead `tblSfenvu7iuvO4Ha` WhatsApp Log ID is gone from all
  workflows; the backup's phantom `Portal Login Registry` was removed.)
- **Dead FIELD references:** exactly one across the whole system —
  **`Offers.Products`** (the link field was missing). It was referenced by all
  four ingestion writers (Excel/Email/PDF/WhatsApp `fields['Products']=[…]`) and
  by Link Offers To Products (read + write). **Fixed by recreating the field**
  (`Products`, link → Products table, id `fldCcXqZAOmB4gUBL`), which resolves all
  five at once. **Link Offers To Products has been reactivated** so it clears the
  ~1,600-offer backlog (batched 150/run, idempotent).
- Every other field reference (Suppliers, Products, Sheet Profiles, Enquiries,
  Clients, WhatsApp Log, Offers Sent Log, Communications Log, Backup Registry,
  Contacts) validated clean.

## Open items

1. **Website "ready in Airtable but not published" (#6).** The public site
   (`offers.akay.ie`) is a static Astro build that reads Airtable at build time,
   and `Public Listing` also requires the manual **Listing Approved** tick +
   `Offer Approval Status = Approved`. So "everything looks ready" but not shown
   usually means either Listing Approved isn't ticked or a rebuild hasn't run.
   Worth a dedicated look if it persists.

## Guardrail going forward
With the error handler fixed, **any** production failure now emails ak@akay.ie
with the business consequence — so the next schema drift or bad deploy surfaces
immediately instead of silently. The remaining discipline is to **publish** after
every workflow edit (an unpublished draft changes nothing).
