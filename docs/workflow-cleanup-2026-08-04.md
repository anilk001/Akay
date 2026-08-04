# Workflow & Airtable cleanup — 2026-08-04

A consolidation pass across the Airtable `Akay Offers` base (`appaDSdZkAE9PGkjT`)
and the n8n instance, to remove duplicate fields, kill dead/broken triggers, and
reduce the offer lifecycle to **two clear gates with one review each**:

1. **One review before an offer is published** to `offers.akay.ie`.
2. **One human review before offers are emailed** to clients.

This document is the record of what changed and why. Nothing in this repo's code
changed — all edits were in Airtable and n8n.

---

## The offer lifecycle now

```
Ingest (Excel / Email / WhatsApp)
        │   offers created as Status = Live, Offer Approval Status = "Awaiting Approval"
        ▼
[ REVIEW 1 ]  a human sets Offer Approval Status = Approved
        │
        ├──────────────▶ PUBLISH: appears on offers.akay.ie
        │                (Public Listing = Yes; site rebuilds hourly)
        │
        ▼
Offer Dispatch (daily 09:00) selects Status=Live AND Send Eligible=Yes
        │
        ▼
[ REVIEW 2 ]  human approves the dispatch email to ak@akay.ie ("Await Approval")
        │
        ▼
        EMAIL sent to matched clients via Resend
```

- **Publish gate** = `Public Listing` formula: `Status ∈ {Live, Broadcasted, Sent}`
  AND not expired AND `Offer Approval Status = Approved`.
- **Email eligibility** = `Send Eligible` formula: `Status = Live` AND not expired
  AND NOT `Do Not Broadcast` AND `Offer Approval Status = Approved`.
- **The single human email review** is the `Await Approval` step inside the
  `Offer Dispatch — Akay` workflow — it shows the exact offers and recipients
  before anything sends.

### What made this necessary
Previously the **same** `Offer Approval Status = Approved` unlocked *both* publish
and email, and High-trust suppliers were **auto-approved on ingestion** — so their
offers reached the website (and became send-eligible) with **no human review**.
Meanwhile sending required **three** stacked approvals. Both are now fixed.

---

## n8n changes

### Live workflows edited
- **Email Body Offer Ingestion** (`8oPUD8d9NPVBEime`)
  - Removed the High-trust **auto-approve** (`Build Airtable Payload`): offers now
    stay at "Awaiting Approval".
  - Removed the redundant **"Backstop — every 10 min"** schedule trigger and its
    orphaned `Get Offer Emails` node — the every-minute Gmail Trigger is the sole trigger.
  - Gmail query now ends `-has:attachment` so attachment emails are handled only by
    Excel Ingestion (no more double-ingestion).
- **WhatsApp Offer Ingestion** (`Bn6Irz2Yx7MTRnKu`)
  - Removed the High-trust **auto-approve**.
  - `Create Offers` node no longer writes the retired flags `Reviewed`,
    `Broadcast Approved`, `Broadcast Flag`, `Broadcast Candidate` (kept `Do Not Broadcast`).
- **Offer Dispatch — Akay** (`dAYMAj6mZD3hTV4T`)
  - `Find Sendable Offers` filter simplified to `AND(Status='Live', Send Eligible='Yes')`
    (dropped the redundant `Send Approval Status='Approved'` term).
  - `Gate Check` no longer requires `Send Approval Status`; all other guards
    (Do Not Broadcast, Offer Approval Status, Send Eligible agreement, backup check) intact.
  - The `Await Approval` human gate is unchanged — it is the single email review.
- **WhatsApp Filter Layer** (`DO2ltjkISp2YDNnc`)
  - Published the existing (2026-08-01) draft that **removes the decommissioned
    `tasklet.ai` forward** and writes inbound WhatsApp messages into the WhatsApp Log
    table. The channel was previously starved; it now feeds WhatsApp ingestion again.

### Workflows archived (11)
Dead one-offs / tests / migrations / retired layers: `TEMP — Wipe Contacts Table`,
`Gmail Approval Layer — DECOMMISSIONED`, `REPAIR — Heineken Sent Log Links`,
`Capsule Migration Phase 1`, `Backfill Client Active Flag`, `Gmail Filter Layer`
(pointed at a retired `tasklet.ai/webhook/retired` endpoint), and the four parked
feature stubs `Two-Way Sell Offer Bridge`, `Supplier-Client Contact Matcher`,
`Gmail Attachment → Drive Bridge`, `Read Red-Marked Prices`. Also archived the stray
`workflow-1` — an unnamed 3-minute scratch job that dead-ended in a disconnected node.
Archives are reversible in n8n if any is wanted back.

### Left active & untouched (essential)
Excel Ingestion, Daily Backup (+ Export One Table), Contact Sync, ERROR HANDLER,
Bounce & Reply Handling, Supersede Supplier Price Lists, Category Request Handler,
Excel Requirement Intake, Timewaster Governance Report.

### Re-enabled
- **Link Offers To Products** (`NtEyhHN4tQYzjwj0`) — re-activated 2026-08-04. A count found
  **1,007 Live offers with no linked Product**, so the backlog clearly still needed clearing.
  Now runs hourly, clearing the backlog and keeping new offers linked.

---

## Airtable changes

### Junk draft automations deleted (3)
`Automation 1`, `Automation 2`, and the one-off `Merge Duplicate Supplier Records`
draft — all undeployed.

### Fields retired (renamed `zzz_DELETE_…`, ready for one-click UI deletion)
Airtable's API cannot delete fields, so each was renamed with a `zzz_DELETE_` prefix
and a description explaining why it is safe to delete. In the **Offers** table:
`Send Approval Status`, `Reviewed`, `Broadcast Approved`, `Broadcast Flag`,
`Broadcast Candidate`, `Pack Format` (superseded by `Public Spec`),
`Stock Status` (superseded by `Stock Display`).

---

## Manual follow-ups (UI only — cannot be done via API)

1. **Delete the retired fields** — in the Offers table, delete every field whose name
   starts with `zzz_DELETE_` (also the pre-existing `zzz_DELETE_OffersCopy` in
   Offers Sent Log).
2. **Archive `TEST — WhatsApp Ingestion (mock, no writes)`** — not reachable via the
   n8n MCP; archive it from the workflow list.
3. **Delete the `Akay Offers (Copy)` base** (`appLSPWjZd2R0e8p4`) — a stale duplicate;
   daily backups make it redundant.

## Candidates NOT touched (need a decision before removal)
- **Price-intelligence cluster** on Offers — `Is Cheapest`, `Cheaper By 5%+`,
  `Price Delta %`, `Best Comparable Price`, `Price Beat Opportunity`, `Alert Sent`.
  Still initialised by WhatsApp ingestion; part of a price-comparison feature. Removing
  them safely means retiring that feature first.
- **Offers Sent Log** two-stage fields — `Send Approval Status`, `Stage 1 Approved At`,
  `Stage 2 Approved At`. Left in place because the dispatch `Write Sent Log` step may
  still map them; verify that first.
- **`Claude Review Status`** (Offers) — never written by any workflow; harmless. Keep as
  a manual internal QA flag or delete.
