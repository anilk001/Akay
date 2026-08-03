# Airtable audit — `Akay Offers` base (`appaDSdZkAE9PGkjT`)

_Audited 2026-08-03. Read-only audit of all 16 tables: what each is for, who uses it
(n8n workflows / the public site / external syncs), record counts, and issues. No tables
were deleted — deletion candidates are listed for a human to approve._

Counts are from the day's verified backup (`Backup Registry`, 2026-08-03).

---

## 1. Table-by-table

| # | Table | Records | Used by | Verdict |
|---|---|---:|---|---|
| 1 | **Offers** | 1,807 | Email/WhatsApp/Excel ingestion (write), Offer Dispatch (read/update), **public site** (read) | ✅ Core — ⚠️ see [big drop](#priority-offers-dropped-62) |
| 2 | **Products** | 2,440 | Email/WhatsApp/Excel ingestion (read + create) | ✅ Core |
| 3 | **Suppliers** | 153 | WhatsApp/Excel ingestion (read), Sheet Profiles (lookup) | ✅ Core |
| 4 | **Clients** | 6,280 | Offer Dispatch (read), Bounce & Reply (read/update/delete) | ✅ Core |
| 5 | **Sheet Profiles** | 11 | Excel ingestion (spreadsheet maps) + Email ingestion (email sender profiles) | ✅ Core |
| 6 | **WhatsApp Log** | 591 | WhatsApp ingestion (read pending, mark parsed/reviewed) | ✅ Core |
| 7 | **Offers Sent Log** | 3,750 | Offer Dispatch (write) | ✅ Core |
| 8 | **Communications Log** | 2,984 | Bounce & Reply (write) | ✅ Core |
| 9 | **Backup Registry** | 17 | Daily Backup (write), Offer Dispatch (reads it as a dispatch gate) | ✅ Core |
| 10 | **Category Icons** | 8 | Feeds `Offers.Category Link` → icon lookups shown on the site | ✅ Keep |
| 11 | **Invoices** | 7,304 | **Zoho sync** (`Zoho Invoice ID`, `Last Synced`) — not touched by any n8n workflow | ✅ Keep (external owner) |
| 12 | **Enquiries** | 611 | Client enquiries — **not touched by any of the 6 n8n workflows** (populated elsewhere, e.g. Tasklet) | ✅ Keep (verify owner) |
| 13 | **System Instructions** | 2 | Config/reference for AI agents — not touched by n8n | ✅ Keep |
| 14 | **Portal Login Registry** | 3 | Manual auth-event log (no secrets) — not touched by n8n | ✅ Keep |
| 15 | **Contacts** | **0** | "Unified master contact DB", built 2026-07-31; linked from Suppliers/Clients but **never populated** | ⚠️ Review |
| 16 | **Client Price History** | **0** | Linked from Clients/Products/Offers but **never written** by any workflow | ⚠️ Review |

Every table is also read once daily by **Daily Backup** (via the `Backup — Export One Table`
sub-workflow) — that's backup coverage, not functional use, so it isn't counted as "used by" above.

The **public website** (`offers.akay.ie`, this repo) reads exactly **one** table — `Offers`
(the `Public Listing = Yes` view). Nothing else in the base reaches the browser.

---

## 2. Priority: Offers dropped 62%

The daily backup counts show a large, recent fall in `Offers`:

| Date | Offers count |
|---|---:|
| 2026-07-27 | 4,278 |
| 2026-07-30 | 4,703 |
| **2026-08-03** | **1,807** |

That's **~2,900 offers gone (-62%)**. The 2026-08-03 08:09 backup **flagged** it as an anomaly
(and, per the dispatch gate, that would have blocked same-day dispatch). The 08:50 backup then
compared 1,807 against the already-reduced 1,804 and marked itself **Verified** — so the anomaly
"cleared" simply because the lower number became the new baseline. That's a blind spot: a genuine
loss and an intentional purge look identical after one day.

**This needs a human decision.** If it was a deliberate purge of expired/superseded offers, all
good — nothing to do. If not, restore from the Drive backup for 2026-07-30
(`Backup Registry` row has the folder link). I did **not** touch any offer data. I can help
investigate (e.g. break the current 1,807 down by Status / Is Expired / Public Listing) on request.

---

## 3. Cleanup candidates (safe, but need your go-ahead)

**Dead fields** — orphaned when the "Offers copy" table was deleted 2026-07-29; each is already
annotated in the base as _"DEAD FIELD — safe to delete, nothing reads it."_ Deleting a field is
permanent, so listing rather than auto-removing:

| Table | Field |
|---|---|
| Enquiries | `zzz_DELETE_OffersCopy` |
| Offers Sent Log | `zzz_DELETE_OffersCopy` |
| Client Price History | `zzz_DELETE_OffersCopy` |
| Category Icons | `zzz_DELETE_OffersCopy` |
| Clients | `zzz_ARCHIVED_Client Price History (text)` |

**Empty tables** — `Contacts` (0) and `Client Price History` (0). Both are wired into the schema
(link fields) but never populated by any workflow. Either they're pending a sync that was never
finished, or they can be dropped. Your call — I won't delete a table.

---

## 4. Not an issue (noted for completeness)

- A temporary staging table, **Source ID Backfill Candidates** (42 rows), existed through
  2026-07-30 and has since been correctly removed — it no longer exists in the base.
- **Native Airtable automations / interfaces were not in scope of this pass.** A table marked
  "not touched by n8n" (Enquiries, Invoices, System Instructions, Portal Login Registry) may still
  be driven by an Airtable automation, a Tasklet agent, or the Zoho sync. None are deletion
  candidates on that basis.

---

## 5. Workflow → table reference map (source of the "Used by" column)

| Workflow | Tables it touches |
|---|---|
| Email Body Offer Ingestion | Sheet Profiles (r), Products (r/w), Offers (w) |
| WhatsApp Offer Ingestion | Suppliers (r), Products (r/w), Offers (r/w), WhatsApp Log (r/w) |
| Excel Offer Ingestion | Sheet Profiles (r), Suppliers (r), Products (r), Offers (r/w) |
| Offer Dispatch | Offers (r/w), Clients (r), Offers Sent Log (w), Backup Registry (r) |
| Bounce & Reply Handling | Clients (r/w/delete), Communications Log (w) |
| Daily Backup (+ sub-workflow) | Backup Registry (r/w); reads **all 16** tables for export |
