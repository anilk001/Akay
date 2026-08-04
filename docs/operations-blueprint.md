# AKAY — Offer Operations Blueprint (Final Draft)

_Last updated 2026-08-04. This is the canonical description of how the Akay offer
operation runs end-to-end: intake → parse → Airtable → price intelligence → margin →
approval → send → logging → housekeeping. It reconciles Anil's intended process with
the **actual current** n8n + Airtable setup, and lists the decisions still to confirm._

Legend: ✅ live & matches intent · ⚠️ live but differs from intent · ❌ not built yet

---

## 1. Principles & safety laws (always enforced)

- **Public-safe only.** The website (`offers.akay.ie`) reads only public-safe fields.
  Supplier identity, buy price, margin and internal notes are never exposed.
- **No client email without a human.** Broadcast offers only leave after an explicit
  human approval, sent from `offers@akay.ie` via Resend (mail-merge), per agreed rules.
- **Two independent human reviews:** one before an offer is **published** to the site,
  one before it is **emailed** to clients.
- **No silent auto-publish/auto-send by trust.** The old "High-trust auto-approve"
  bypass has been removed — every offer waits for a person.

---

## 2. Intake

Anil forwards supplier offers to **offers@akay.ie** and **manually applies the
`Process_Akay` Gmail label**. Offers arrive in four forms; a separate stream comes over
WhatsApp.

| Form | Engine | Status |
|---|---|---|
| 1. Excel (.xlsx/.csv) attachment | Excel Ingestion — Claude LLM column-mapping + cached Sheet Profiles | ✅ |
| 1b. **PDF** attachment | — | ❌ not built |
| 2. Excel tables in the email body | Email Body Ingestion — LLM extraction | ✅ |
| 3. Unformatted text in the body | Email Body Ingestion — LLM extraction | ✅ |
| 4. **Image** offer (screenshot/photo) | — | ❌ not built (no OCR/vision) |
| WhatsApp message (Whapi) | WhatsApp Filter Layer → WhatsApp Log → WhatsApp Ingestion | ✅ (channel restored 2026-08-04) |

Notes:
- Labeling is **manual by design** (Anil moves mail into `Process_Akay`).
- Excel ingestion now reads **all** spreadsheet attachments (not just 2) and excludes
  inline images/logos.

---

## 3. Parse → Airtable write

On parse, each channel writes offers into the **Offers** table and links the supplier.

- **Supplier match / create.** Matched by sender email, then domain. If unknown **and**
  a genuine external sender, a supplier is **auto-created** (Status = Active, Trust =
  Medium). Internal-only senders (`@akay.ie`) never create a supplier — they route to
  review. When a sheet states no currency, the supplier's **Default Currency** is used.
  _(Fixed 2026-08-04 — this was silently dropping every Excel offer.)_
- **Offer is created** with `Status = Live`.
- **Minimum to become an offer:**
  - **Intended:** product name · pack/size · price + currency · incoterm (Ex-works).
  - **Current:** product name · price · currency (currency may come from the supplier
    default). **Pack/size and incoterm are NOT yet enforced** — incoterm defaults to
    "Other". ⚠️ _Gap → see §11._
  - Rows failing the minimum are collected as **exceptions → Needs-Review**, not created.
- **Margin.** ⚠️ **Manual.** Automation never sets `Margin %`; a trader (Annika/Anil)
  enters it in Airtable. `Sell Price` is a formula = `Buy Price × (1 + Margin %)`.
- **Good-to-have (Annika fills; NOT blocking):** quantity available, lead time, BBD
  (where the product carries one), cases per pallet / per load. Offers still process
  without these. ⚠️ There is **no queue/notification** surfacing these to Annika yet.

---

## 4. Price intelligence  ✅

Hourly job (`Price Intelligence — Akay`). For each Live offer it finds other Live offers
of the **same product** (via the Products link), **same currency**, same pricing basis,
and writes:

- **Best Comparable Price**, **Price Delta %** (negative = we're cheaper),
  **Is Cheapest**, **Cheaper By 5%+**, **Price Beat Opportunity**.
- Emails **ak@akay.ie** a single summary when a new offer is a **≥5%-cheaper standout
  deal** (`Alert Sent` is the once-only flag).

Depends on **Link Offers To Products** (hourly) building the canonical product identity —
currently backfilling, so intelligence ramps up as coverage grows. Same-currency only
(no FX guessing); no false alerts.

---

## 5. Approvals — two gates, one human review each  ✅

| Gate | Mechanism | Who approves |
|---|---|---|
| **Publish to site** | `Offer Approval Status = Approved` → `Public Listing = Yes` → shows on offers.akay.ie | Annika / Anil |
| **Send by email** | Dispatch "Await Approval" email to ak@akay.ie before any client send | Annika / Anil |

`Send Eligible` (email gate) = Live **and** not expired **and** not `Do Not Broadcast`
**and** `Offer Approval Status = Approved`. Either gate can be approved independently
(publish only, send only, or both).

---

## 6. Sending  ✅

**Offer Dispatch — Akay** (daily 09:00):
1. Selects offers where `Status = Live AND Send Eligible = Yes`.
2. Builds the recipient list (rules below).
3. **Human "Await Approval"** email to ak@akay.ie — nothing sends until approved.
4. Sends via **Resend** (mail-merge, from offers@akay.ie).
5. Marks offers `Broadcasted` and writes the **Offers Sent Log**.

**Recipient rules enforced:** exclude anyone tagged "No Mailing"; `Do Not Contact` must
be false; `Status = Active` **and** the Active checkbox ticked; valid email; offer's
Bond/Customs status not in the client's `Excluded Bond Status`; client Capsule Tags
include ≥1 of the offer's `Target Capsule Tags` (blank = no restriction); client Country
∈ offer's `Target Countries` (blank = all); if `Match Interest Category` is ticked,
client's Interest Categories must include the offer's Category. Emails de-duplicated.
**Bundles:** offers sharing a `Bundle ID` go out as one email to one audience, and
dispatch halts if bundle members disagree on targeting.

---

## 7. Enquiries & product inquiries

| Path | Behaviour | Status |
|---|---|---|
| Email — self-serve category request (webhook) | Pulls Send-Eligible offers in the category → **auto-emails** via Resend; logs an Enquiry when a note is present | ⚠️ auto-sends without human approval |
| Email — "requirement list" (Gmail poll /15 min) | Parses the sheet, fuzzy-matches Send-Eligible offers → **auto-replies** priced matches; logs unmatched lines for manual pricing | ⚠️ auto-sends without human approval |
| **WhatsApp buyer inquiry** | — | ❌ not handled — inbound buyer questions land in review, unanswered |

⚠️ **Safety point to confirm:** the two email responders reply to a buyer's own request,
so they auto-send. Decide whether that is acceptable or whether they too should pass a
human check (see §11).

---

## 8. WhatsApp specifics  ✅ / ❌

- Supplier offers: inbound WhatsApp is logged; the parser **ignores messages with no
  price** (routed to review, never ingested); priced lines become offers exactly as
  above. ✅
- Buyer inquiries over WhatsApp: **no answer path** — treated only as potential offers,
  so a buyer quote request just lands in review. ❌ _Gap → §11._

---

## 9. Housekeeping & safety nets

| Job | Cadence | Purpose | Status |
|---|---|---|---|
| Supersede Supplier Price Lists | Hourly | Expire a supplier's older lists when a newer one arrives | ✅ |
| Link Offers To Products | Hourly | Build canonical product identity (feeds price intelligence) | ✅ (backfilling) |
| Daily Backup (+ Export One Table) | Daily | Airtable → Google Drive backup | ✅ |
| ERROR HANDLER — Akay Alerts | On failure | Emails ak@akay.ie when any workflow fails | ✅ |
| Bounce & Reply Handling | Live | Handle bounces/replies on offers@akay.ie | ✅ |
| Timewaster Governance Report | Weekly | Flag clients with unresolved enquiries for manual review | ✅ |
| **End-of-day sweep** `Process_Akay` → `Processed-Akay` | Daily | Clear the processed intake queue | ❌ **not built** |

---

## 10. Active workflow inventory (n8n)

Ingestion & offers: **Excel Offer Ingestion**, **Email Body Offer Ingestion**,
**WhatsApp Offer Ingestion**, **WhatsApp Filter Layer**, **Offer Dispatch**,
**Price Intelligence**, **Link Offers To Products**, **Supersede Supplier Price Lists**.
Support: **Daily Backup** (+ Export One Table), **Contact Sync**, **ERROR HANDLER**,
**Bounce & Reply Handling**, **Category Request Handler**, **Excel Requirement Intake**,
**Timewaster Governance Report**.

_11 dead/one-off workflows were archived on 2026-08-04; `workflow-1` (a 3-min no-op) and
three junk Airtable draft automations were removed._

---

## 11. Gaps to close, and decisions to confirm

**Build gaps (prioritised):**
1. **Prove the Excel spine** — re-forward the Halıtlar email; confirm offers land. _(pending)_
2. **Essential-field gate** — enforce name + pack/size + price+currency + incoterm; send the rest to Needs-Review.
3. **Annika missing-info queue** — surface offers missing qty / lead time / BBD / cases-per-pallet, without blocking processing.
4. **End-of-day label sweep** — move `Process_Akay` → `Processed-Akay` once daily.
5. **PDF offer parsing** and **image (vision) offer parsing** — cover intake forms 1b and 4.
6. **WhatsApp buyer-inquiry path** — answer quote requests like email enquiries.

**Decisions to confirm before finalising:**
- **Margin** stays a manual trader input (current), or apply a default % at ingest?
- **Trust tiers** — process all offers to approval (current), or hold Low/Unknown-trust suppliers?
- **Enquiry auto-replies** (category request + requirement list) — keep auto-send, or add a human check?
- **Priority/scope** of the six build gaps above.

---

## 12. What changed in the 2026-08-04 cleanup (for reference)

- Consolidated to the **two-gate** model; removed the High-trust auto-approve bypass.
- Simplified email sending to a single human approval; retired 7 redundant Offers fields.
- Fixed the **WhatsApp channel** (was forwarding to a dead endpoint, writing nothing).
- Archived 11 dead workflows; deleted junk automations; killed a 3-min no-op job.
- Re-enabled **Link Offers To Products** (1,007-offer backlog).
- Built **Price Intelligence**.
- Hardened **Excel Ingestion**: supplier resolve/auto-create (was `[object object]`),
  all-attachments, robust parsing of the LLM column-map, USD currency fallback.
