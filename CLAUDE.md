# CLAUDE.md — Akay Offers Operating Rules

**Read this at the start of every Akay task.** These are the authoritative operating rules for the
Akay offer/CRM operation. They replace the Tasklet "Akay Superagent" agent — everything now runs in
Claude / Claude Code, including sending via Resend. There is no Tasklet dependency.

Base: **Akay Offers** — Airtable base ID `appaDSdZkAE9PGkjT`.
(The Airtable record `recP7GGeADD8QWOwP` is a legacy mirror of these rules; this file is now the source of truth.)

---

## 0. Roles

- **Claude Code (you) = the executor.** You do all data/code/Softr/recipient-list/dispatch work,
  **including sending offer emails via Resend**, and you write the audit log.
- **Human (Anil / Annika) = approval.** No client offer goes out without Anil's current, specific approval.
- There is **no always-on agent**. The unattended parts (offer intake) run as a scheduled Routine that
  wakes a Claude session (see §7).

---

## 1. Hard rules (never break)

1. **Never delete records.** Exception: a verified Gmail bounce → delete only that Client/Supplier
   contact and archive the bounce email. Otherwise set `Status = Archived`.
2. **Never overwrite a price or other key field in place.** Corrections = a new/superseding record; the
   prior value must remain recoverable.
3. **Never send outbound client communication without BOTH:** (a) a Claude-built + verified content and
   recipient list, and (b) Anil's current, specific approval for that exact dispatch. If either is
   missing, STOP and ask. A general "go ahead" from an earlier task does not count.
4. **Backups are recommended, not a gate.** Keep one Airtable snapshot + Drive export per day where
   possible and note any gap in `Audit Status`, but a missing same-day backup does **not** block
   recipient-list prep, bulk writes, or dispatch.
5. **Never trust run history as a data source.** Ground truth = the live Airtable base (and Resend's own
   dashboard for send status).
6. **When a hard rule would be breached or data is ambiguous:** stop, set `Claude Review Status =
   Pending Review` with a note, change nothing else. Never guess identity, amounts, provenance, trade
   terms, or routing.

---

## 2. Pricing rule

- **Buy Price** = the real supplier quote, always.
- **Sell Price** = calculated forward: `Buy Price × (1 + Margin %)`, default margin **5%**.
- Never type Sell Price directly, and never reverse-engineer Buy Price to hit a target Sell Price.

---

## 3. Pre-send gates — the COMPLETE and EXCLUSIVE list

Before any offer send, every linked Offer must pass ALL of:
1. `Send Eligible` = **Yes** (fld `fldgV6jqX8OX8J6js`)
2. `Is Expired` = **No** (fld `fldzgu5XIxyC5bWE1`)
3. `Offer Approval Status` = **Approved** (fld `fldosc71syHTiAM4w`)
4. `Do Not Broadcast` = **false / unchecked** (fld `flduf04bXYHrANxtx`)

**These four are the only gates. Do not invent additional gates** (e.g. `Broadcast Approved` is NOT a
required gate). If any offer in a dispatch fails a gate, the **whole dispatch stops** — flag the blocked
Offer ID(s), send nothing.

---

## 4. Dispatch runbook (Resend)

1. **Build the recipient list** from the repo builder (`scripts/build-recipients.js` in the Akay
   dispatch repo) or directly from Airtable with the campaign's stated filters + opt-outs. Dedupe by
   email. Never guess a recipient from conflicting client-status data — flag it.
2. **Verify** content, pricing, duplicates, exclusions, and that no supplier/internal data leaks into
   the email body or subject.
3. **Confirm the pre-send gates (§3)** on every linked offer, live from Airtable.
4. **Get Anil's explicit approval** for this exact content + list.
5. **Send per-recipient via Resend. NEVER BCC-blast.** Resend's success response shape is
   `{ result: { id } }` — read the id there. Batch with awareness of rate limits and mid-run auth-token
   refresh; resume only the unsent remainder on any interruption.
6. **Log truthfully, same run:** create **one `Offers Sent Log` row per actual recipient**, linked to
   the offers actually sent — even if an offer is later superseded. The log records truth, not intent.
   Do not skip logging "to save tokens" — a send without a log is an incomplete audit trail.
7. **Reconcile** against Resend's dashboard if anything is uncertain; never fabricate log rows.

**Client replies are human-only (Rule 3B):** replies to client feedback are sent personally by Anil or
Annika as `offers@akay.ie`. Claude only detects, matches, and logs replies — it never composes or sends
a reply to a client.

---

## 5. Offer intake (email)

> **Mailboxes are separate.** Offer intake runs on **`offers@akay.ie`**. Enquiry intake (`Akay/Enquiry-New`)
> runs on **`ak@akay.ie`**. Connect the right mailbox for the task.
>
> **Never hardcode Gmail label IDs (`Label_N`).** IDs differ per mailbox and have caused misfiling. Always
> resolve a label's ID at runtime via `list_labels` by its exact name, and watch for near-duplicate names
> (`Process_Akay`, `Akay_Processed`, `Offers_Processed`, `akay process`, `Offers in` — only the first two
> are ours).

- Trigger: emails labelled **`Process_Akay`** in `offers@akay.ie`.
- **Parse the email BODY.** Create Offer records from offers written in the body.
- **Skip spreadsheet attachments** — filenames ending `.xlsx .xlsm .xltx .xls .csv .tsv` (case-insensitive).
  Do not download/open/parse them; a separate n8n workflow owns spreadsheets. **Never touch the label
  `Akay/Excel-Done`.**
- **Payload split, not email split:** a supplier email often carries both a sheet and useful terms in
  the body — skip the sheet, still read the body. But if the body only *summarises/repeats* the attached
  sheet ("see attached price list"), create no Offers from the body (the sheet workflow handles it).
- **Dedup by source message ID** (Gmail API message id) — check Enquiries AND Offers before writing; if
  found, do NOT create a duplicate, **but still clear the queue**: apply `Akay_Processed` and remove
  `Process_Akay` on that thread so an already-processed offer never lingers in the intake queue.
- **Unidentified supplier fallback:** if no supplier/company name can be identified, use the sender's
  email address as `Supplier Name` and flag for review. Never invent a name, never leave blank.
- **On success:** add the `Akay_Processed` label and remove `Process_Akay` (resolve both IDs at runtime by
  name via `list_labels` — never hardcode `Label_N`). On hold/failure, leave `Process_Akay` in place.

## 6. Offer intake (WhatsApp)

- Classify every inbound message **Business vs Personal** first. Ignore Personal entirely (no log, no write).
- Dedup Business messages by the Whapi message ID. Unknown business contacts → `New Contact – Pending Review`.
- Ignore supplier offers with no stated price.
- **Every Whapi (`gate.whapi.cloud`) HTTP call must set header `Accept: application/json`** — Whapi sits
  behind Cloudflare, which returns 403 (code 1010) on missing headers. A Cloudflare/1010 403 = missing
  header, not a token/plan issue.

---

## 7. Scheduled intake

Offer-email intake runs unattended via a **scheduled Routine** that wakes a Claude session on a fixed
cadence, reads new `Process_Akay` emails, and processes them per §5. Each run: dedupe first, process
only what's new, finish fast if nothing is new. Ambiguous items → `Pending Review`, never guessed.
(The scheduler's minimum interval is hourly; see the Routine's configured cadence.)

---

## 8. Airtable access rules

- **Reference tables/fields by ID, never by name.** Full map: `AKAY_AIRTABLE_HARDCODE_REFERENCE.md`.
- **Never read/write** any field whose name starts with `zzz_ARCHIVED_`, `_unused_`, or `_old_`.
- **After any write, read the record back** and confirm before marking a step complete.
- **Never use a bare/partial PUT that drops unlisted fields** — that wiped 213 Enquiries once. Use
  field-scoped updates; if using PUT, include the record's full current field set.
- If a field ID can't be confirmed with certainty: STOP, set `Claude Review Status = Pending Review` +
  note, change nothing else.
- **Collision fixes** (use these, never the legacy twins): Offers→Supplier link `fldi2bu6fbr3BQSE3`;
  Offers→Products link `fldWyjuR2ZyC2Yc6a`; Clients→price-history link `fldTlxCoKSr3tyrbo`.

### Core table IDs
- Suppliers `tblQkV5h5zuJD13w7` · Products `tbl1m5HfC2yzWECGb` · Clients `tblcWMfGioSXtZZzl`
- Offers `tbljBgWrnIMZzkSAr` · Enquiries `tblgZUj1JeGyHXmcx` · Offers Sent Log `tbllLvPXjXrAdZX3b`
- Communications Log `tblly6hsTVMO0I54k` · WhatsApp Log `tblSfenvu7iuvO4Ha`

---

## 9. Public catalogue (Softr / offers.akay.ie)

- Public site shows **only** buyer-safe fields: `Public Product Description`, `Public Spec`,
  `Price Display`, `Public Terms`, `Stock Display`, `whatsapp link`, `product icon`. Numeric `Sell Price`
  may be mapped **hidden**, for sort only.
- **NEVER expose** (deny-list): `Offer Name` (primary — leaks supplier), `Notes`, `Trader Comment`,
  `Delivery Info Source`, any `Supplier …` field, `Buy Price`, `Margin %`.
- Only offers with a populated price should appear.

---

## 10. Security

- Never expose credentials, tokens, or session secrets in chat, files, or Airtable.
- Rotate any secret that has been pasted into a chat.
- Airtable writes at scale use a scoped Personal Access Token (`data.records:read` + `:write`, this base
  only), supplied per-session as an env var — never committed.

---

## 11. Contact Sync (Google + WhatsApp → Airtable Contacts)

The n8n workflow **"Contact Sync — Google + WhatsApp → Airtable"** (id `RO9u0xxiJPNErasI`) merges Google
Contacts + WhatsApp (Whapi) contacts into the **Contacts** table `tblKEVNpKXJPxgCPU` (primary field
`Contact Name` = `fldYVBwR38vT84Y4w`), deduped by normalised phone (`Phone (E.164)`), linking to
Suppliers/Clients where a phone matches.

Standing operating rules for this sync (set by Anil — apply to **all** Claude sessions):

1. **No per-run approval needed to execute or re-run this sync.** It writes only to the internal Contacts
   table — it is *not* outbound client communication, so Rule 3 (§1) does not apply. Just run it; don't
   pause to ask permission for each execution.
2. **Never flag synced contacts for review.** Every synced contact gets `Review Status = OK`. Do not set
   `Pending Review` on contact-sync output. (This is specific to this sync; the §1/§6 "Pending Review"
   discipline still governs offer/enquiry intake.)
3. **No duplicates, ever.** One Contacts row per unique normalised phone. The dedupe lives in the workflow's
   **Build Sync Plan** Code node, which must read Airtable source rows from `json.fields` (not the top
   level) so existing-contact matching works — the earlier top-level bug made every run re-create every
   contact. Verify the phone-uniqueness invariant after any large run.
4. **Sync what you can now; handle the rest as we go.** Missing/ambiguous fields don't block the sync —
   write the contact with what's available and move on.
