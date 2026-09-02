# Systems inventory — IDs and ownership

Everything a session needs to find without re-discovering it. Verified 2026-09-02.
When something here changes, change it here in the same commit.

## People and addresses

| Who / what | Address | Role |
|---|---|---|
| Anil Khetan (owner) | ak@akay.ie | approves every dispatch; receives all alerts |
| Sending identity | `Akay Irl Ltd <offers@akay.ie>` | Resend verified domain; Gmail mailbox the ingestion triggers watch |
| Info desk | info@akay.ie | receives the "Awaiting Website Publish" digest |
| WhatsApp | +353 87 238 2368 | quoted in offer emails |

## Airtable — base `appaDSdZkAE9PGkjT` ("Akay Offers")

No Airtable automations exist in this base (checked 2026-09-02); everything runs in n8n.

| Table | ID | Notes |
|---|---|---|
| Offers | `tbljBgWrnIMZzkSAr` | the product/price records; ~4,700 rows |
| Clients | `tblcWMfGioSXtZZzl` | ~6,100 rows; `Capsule Tags` carries the segments (`Indv spirits`, `Indv beers`, `Indv groceries`, `No Mailing`) |
| Offers Sent Log | `tbllLvPXjXrAdZX3b` | one row per recipient per dispatch (~13,400 since Aug) |
| Backup Registry | `tblD9YqHE6GeOxzsq` | gate 2 of dispatch reads today's `Verified` row |
| System Instructions | `tblhZFeYPGbiBSMX1` | the canonical methods as prose; mirror any rule change here |
| Suppliers | `tblQkV5h5zuJD13w7` | supplier identity — never public |
| Products | `tbl1m5HfC2yzWECGb` | canonical products; linked by `Link Offers To Products` |
| Contacts | `tblKEVNpKXJPxgCPU` | unified contacts (Google + WhatsApp) |
| Enquiries | `tblgZUj1JeGyHXmcx` | never delete |
| Communications Log | `tblly6hsTVMO0I54k` | |
| Client Price History | `tblBIxP5UDgrurthu` | |
| Invoices | `tbl1RLM7M1n8Q9khx` | Zoho sync |
| Sheet Profiles | `tblnsxQlNDzpHhwfV` | cached column maps for supplier spreadsheets |
| WhatsApp Log | `tblRuHFp55Up7NT7n` | recreated 2026-08-05 after the original was deleted |
| Beer Portal Recipients | `tblcuQiMZDo8Fxnva` | temp; safe to delete |

Offers fields the automations depend on (IDs matter because filters need them):

| Field | ID | Meaning |
|---|---|---|
| Status | `fld89AoUTM1bmodUh` | Live → Broadcasted after a send |
| Send Eligible (formula) | `fldgV6jqX8OX8J6js` | Status=Live ∧ Is Expired=No ∧ ¬Do Not Broadcast ∧ Offer Approval Status=Approved |
| Queued for Dispatch | `fldAiPD3Z47lXmb85` | tick to queue; the workflow unticks it at selection (since 2026-09-02) and again at the end |
| Listing Approved | `flddRGgVMAoI6Q2gX` | human-only website gate; NOT a dispatch gate |
| Public Listing (formula) | `fldZXCqLLDkdTXviT` | drives offers.akay.ie |
| Target Countries / Target Capsule Tags / Excluded Countries | `fld5oA0zXAoWibzbG` / `fld2rSxJzN7pDuqul` / `fldMRpzuUSkJatQz8` | dispatch audience |
| Bundle ID / Bundle Title | `fld1dx85NPkhiiPEh` / `fldiBKPlqs6AD8qhQ` | lines sharing a Bundle ID send as ONE email |
| Price Per Unit & Case (formula) | `fldisUkTtJ6Ddi1V4` | the only price string allowed in an email |
| Claude Review Status | `fldHkQCJFijh9RNgH` | recreated 2026-08-25; three ingestion pipelines write it |
| Products (link) | `fldCcXqZAOmB4gUBL` | recreated 2026-08-05; four pipelines write it |

## n8n Cloud — `akay-team.app.n8n.cloud`

Production workflows (all active unless noted). "Owner" is the runbook that governs it.

| Workflow | ID | Trigger | Owner / notes |
|---|---|---|---|
| Offer Dispatch — Akay | `dAYMAj6mZD3hTV4T` | Schedule 08:00 Europe/Dublin + webhook `POST /webhook/dispatch-offer` | `.claude/skills/offer-dispatch/`. Published version `6a013bba` (2026-09-02) |
| ERROR HANDLER — Akay Alerts | `OnCFbngmILTKsdkw` | Error Trigger | emails ak@akay.ie; production runs only. Version `8699a8fe` |
| Weekly Health Check — Akay | `ryLkRKMH7eKG1tY7` | Mon 08:00 Dublin | scans last 20 runs of every active workflow incl. cancellations |
| Daily Backup — Akay | `Jwc1Em8Qh4qUUZLl` | daily ~05:00 UTC | writes the `Verified` Backup Registry row dispatch needs |
| Backup — Export One Table | `qQC2K28u7KnoP2ut` | sub-workflow | one execution per table |
| Excel Offer Ingestion — Akay | `j1NAhQEKz9hzi1T2` | Gmail `Process_Akay` | supplier price lists |
| Email Body Offer Ingestion — Akay | `8oPUD8d9NPVBEime` | Gmail | |
| PDF/Image Offer Ingestion — Akay | `aZvwBunq4W07XqL3` | Gmail | Claude vision; see INCIDENT-2026-08-18 (wrong mailbox credential) |
| WhatsApp Filter Layer | `DO2ltjkISp2YDNnc` | Whapi webhook | `n8n/whatsapp-filter-layer/` |
| WhatsApp Offer Ingestion — Akay | `Bn6Irz2Yx7MTRnKu` | schedule | `n8n/whatsapp-offer-ingestion/` |
| Catch-up Sweep / Daily Close Sweep / Stranded Queue Digest | `NlzK9DMrkNmfcZoY` / `DCgYTQx0DuvU2OOg` / `6ueV5nDquyLIKeX9` | 15 min / 21:00 / daily | Process_Akay mailbox hygiene |
| Bounce & Reply Handling / Resend Bounce Intake | `Qb8hZEPunRkVT3J2` / `7gHZ4Tz1GDJlF3Hl` | Gmail / Resend webhook | tick `Do Not Contact` on bounces |
| Excel Requirement Intake | `eXGO9tGgutIxneYS` | Gmail "requirement list" | |
| Category Request Handler / Chat Quote Handler / RFQ Intake | `zyLl5wt2UHZ7Deki` / `A4mcc8ze7rgrviQD` / `7h6qhxXzZptdZPMF` | webhooks from offers.akay.ie | |
| Contact Sync | `RO9u0xxiJPNErasI` | schedule | no request timeout on Whapi pagination — can hang the queue |
| Link Offers To Products / Price Intelligence | `NtEyhHN4tQYzjwj0` / `5VTOa4DvuZx0lyCi` | hourly | |
| Awaiting Website Publish — Daily Digest / Timewaster Governance | `OcLUsD6PAtSgI37q` / `dUMX2fBgohPPVBgN` | daily / weekly | |
| Supersede Supplier Price Lists | `x09qSkS0XdDPoSXr` | **DISABLED** | per Anil 2026-08-08; wipe bug; do not enable |
| SEO Rebuild — Netlify Build on Airtable Change | `qckyUzd6KNwhVHbd` | inactive | superseded by the GitHub Action |

Retired one-shot send workflows — **do not copy, do not reactivate** (each skipped a gate):
`SDyUh9yTr4NmA22U` Campaign/Offer Send, `YgwZjPKsHT3AClnh` Indv Groceries 08-27,
`0l2lT4JEUAEW4qkk` Nescafe, `POnqJmKJLiLi4LYp` Corona & Peroni, `wEuId3UJi2xSwniu` Pink Stuff.
Temp helpers safe to delete: `1IO2dv432qaJkqi2`, `Ec3XrkPSm3gDr7xZ`. Test mock: `6Su50m345ovfs5Gp`.

Credentials (IDs only — the API never reveals secrets):

| Credential | ID | Used by |
|---|---|---|
| Airtable Personal Access Token account | `rgwpGVX08dlSKzwI` | every Airtable node. A second "account 2" (`z2ohacifc5nLYA76`) was dead and removed 2026-08-03 |
| Bearer Auth account (Resend) | `PuWxkKZ5oLpxI4lM` | `Send via Resend`. Went invalid 2026-08-31 → 401 on every send; check before send days |
| offers n8n (Gmail OAuth) | `qunIwKuc11bYHBVr` | ERROR HANDLER `Email Alert`. One of six gmailOAuth2 credentials — see INCIDENTS |
| Anthropic account | `ok6MpgvaMeiLUwQk` | PDF/Image ingestion. **No longer** used by dispatch (removed 2026-09-02); credits ran out 2026-09-01 |

## Website

| Piece | Where |
|---|---|
| Source | `src/` (Astro), `src/data/airtable.mjs` is the only Airtable reader; `FIELDS` allowlist there is the public-safe boundary |
| Deploy | Netlify from `netlify.toml`; Node 20; builds on every push to the deploy branch |
| Refresh | `.github/workflows/refresh.yml` — every 5 min re-bakes `offers-snapshot.json` on branch `claude/softr-webflow-migration-50kj20` and commits only on change (needs repo secret `AIRTABLE_TOKEN`) |
| Domain | offers.akay.ie, CNAME at GoDaddy → Netlify |

## External services and how they fail

| Service | Failure seen | Signature in n8n | Where to fix |
|---|---|---|---|
| Resend | rotated/invalid API key (2026-08-31) | `401 validation_error "API key is invalid"` on every `Send via Resend` item | credential `PuWxkKZ5oLpxI4lM` |
| Anthropic | credits exhausted (2026-09-01); `temperature` deprecated (2026-08-31) | `Bad request` on the model node | Plans & Billing; no longer in the dispatch path |
| n8n Cloud plan | execution quota (2026-08-14) | `Execution limit reached` at the trigger | the plan, not a workflow |
| Airtable | field deleted (08-04, 08-05, 08-25); records deleted mid-run (08-31) | `422 UNKNOWN_FIELD_NAME`; `422 Record ID … does not exist` | restore the field; never delete a field a workflow writes |
| Gmail | wrong mailbox credential | `404 notFound` on a thread that exists | swap the node's gmailOAuth2 credential |
| Whapi | table deleted underneath | Airtable `403 INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND` (looked like a Whapi token) | the Airtable table, not Whapi |

The Resend MCP connector available to Claude Code sessions is attached to an **empty**
Resend account (no keys, domains or sends) — it is not the account n8n uses, so
deliverability must be checked in the Resend dashboard.
