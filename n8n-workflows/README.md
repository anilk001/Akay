# n8n Workflow Updates — 2026-08-05

Blueprint-driven safety and ingestion fixes applied to four **live** n8n workflows
in the `akay-team` n8n Cloud instance. Edits were applied via the n8n API and
**published** (the instance uses a draft/publish model, so publishing is what
makes a change take effect on the active workflow).

- `backup-2026-08-05/` — full export of each workflow **before** the edits, plus
  `RESTORE.md` with each workflow's pre-change `versionId` for one-click revert.
- `current/` — export of each workflow's **published** state after the edits.

## What changed, per blueprint item

### Item 1 — Safety fix (stop auto-emailing clients)
**Category Request Handler** (`zyLl5wt2UHZ7Deki`) and
**Excel Requirement Intake** (`eXGO9tGgutIxneYS`):
- Removed the direct client auto-reply nodes (`Send via Resend` HTTP node;
  `Reply With Quoted Prices` Gmail reply).
- The composed match/quote is now logged to the existing **Enquiries** table with
  `Claude Review Status = "Pending Review"` and the full drafted reply stored in
  `Review Brief` for a human to review and send manually.
- Added a `Notify Reviewer (ak@akay.ie)` Gmail node that emails **only**
  `ak@akay.ie` a summary + a direct Airtable record link to review the draft.

> Note: the blueprint named an "Inquiry Drafts" table. That table does not exist;
> per decision we reused the existing **Enquiries** table, whose
> `Claude Review Status` field already has a "Pending Review" option.

### Item 2 — Queue & trigger fix
**No change made.** Loop-prevention already exists and is more robust than the
blueprint's proposal: both ingestion flows filter on `-label:Akay/*-Done`, dedupe
by message ID, and a separate **Daily Close Sweep** workflow moves
`Process_Akay → Akay_Processed` once daily. Adding an immediate
`Process_Akay → Processed-Akay` swap would conflict with that design (and the
`Processed-Akay` label does not exist — the real label is `Akay_Processed`).

### Item 3 — LLM extraction & parsing fix
- **Provider swap NOT done:** there is no Google AI / Gemini credential in the n8n
  instance, so `gemini-2.0-flash` cannot be wired. Per decision the existing
  **Anthropic** extraction was kept.
- **Structured JSON** is already enforced: Email Body ingestion uses a langchain
  **Information Extractor** node with a JSON schema; Excel ingestion's LLM only
  maps columns and already expects/parses JSON.
- **5% default margin:** a new `Apply Default Margin` code node sets
  `Margin % = 0.05` on each offer when the source stated none. Feeds the existing
  `Sell Price` formula.

### Item 4 — Essential fields gate
Added to **Excel Offer Ingestion** (`j1NAhQEKz9hzi1T2`) and
**Email Body Offer Ingestion** (`8oPUD8d9NPVBEime`), after extraction/normalization:
- `Essential Fields Gate` — an **IF** node (not a Filter node: n8n's Filter drops
  non-matching items and cannot route them; IF has the two outputs the blueprint's
  TRUE/FALSE routing requires). Passes when `Product Name` and `PCS/Case`
  (pack size) are present, `Buy Price > 0`, and `Currency` is present.
  - **TRUE →** existing `Create Offers` (Status = `Live`).
  - **FALSE →** `Flag Needs-Review` (sets `Status = Hold`,
    `Claude Review Status = Pending Review`, records which fields were missing)
    → `Create Needs-Review Offers` → the existing mark-email-done step.

> Note: the blueprint named a "Needs-Review" table. Per decision, failed-gate
> offers are written to the existing **Offers** table (not Live) with
> `Claude Review Status = "Pending Review"`, matching the base's review model.

## Known validation note
The pre-existing `Map Columns (LLM)` Anthropic node in Excel Offer Ingestion
raises a validator warning about a missing `resource` discriminator. It predates
these edits, was not modified, and is functioning; left as-is to avoid disturbing
the working column-mapper.

## Revert
See `backup-2026-08-05/RESTORE.md`. Fastest path: restore each workflow's
pre-change `versionId` via the n8n version history, then re-publish.
