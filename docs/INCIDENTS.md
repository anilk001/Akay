# Incident catalogue

Every failure that reached production since the automations went live, newest first,
with the pattern it belongs to. Add to this file in the same commit as the fix.
Sources: n8n execution log and version history, Airtable System Instructions,
`.claude/skills/offer-dispatch/AUDIT-2026-09-02.md`.

## The patterns (read these even if you skip the list)

| Tag | Pattern | How to avoid it |
|---|---|---|
| **DRAFT** | Fix saved to the n8n draft and never published; production kept running the old version | `publish_workflow`, then assert `versionId === activeVersionId` |
| **LIVE-EDIT** | Workflow edited during a send to get past that day's error; the edit caused the next error | Freeze on send days; change from the repo with tests, on a non-send day |
| **EXTERNAL** | A credential, quota or third-party API failed; nobody had checked it before the send | Pre-send check: Resend key, backup row, n8n quota |
| **SCHEMA** | An Airtable field or record was deleted while a workflow that writes it was running | Never delete a field a workflow writes; grep this repo and n8n first |
| **N8N-SEMANTICS** | HTTP node replaces item JSON; Airtable node nests `fields`; manual runs don't fire the error workflow; Code sandbox limits | See CLAUDE.md "n8n facts" |
| **MISLEADING** | The error named the wrong thing (404 for wrong mailbox, 403 for deleted table, wrong node on the halt path) | Read this catalogue before trusting an error message |
| **SILENT** | Failure with no notification, found days later by going looking | Every halt must throw; the ERROR HANDLER must itself work |
| **CONTENT** | A defect in the email text reached buyers (price basis, duplicates, cost price) | `compose_preview.cjs` + read the approval mail |
| **ONE-SHOT** | A throw-away send workflow built from scratch, skipping the gates | Everything goes through `Offer Dispatch — Akay` |

## Log

### 2026-09-02 — audit and fixes published
Dispatch `6a013bba`, error handler `8699a8fe`. Deterministic HTML, Resend idempotency key,
queue claim before approval, real halt reasons, node-aware alert text. First production run pending.

### 2026-09-01 — Anthropic credits, concurrent runs, HTML fallbacks · EXTERNAL, LIVE-EDIT, SILENT
- 29332, 29354, 29365: `Style as HTML` → "credit balance is too low". Fixed by making the node continue on error (text-only send).
- 29311 (09:16) and 29315 (09:25) in flight together; group choice deterministic → same-group double send was one sort order away.
- 29315: HTML fell back ("introduced number 5568"), approval declined, alert said "no reason recorded"; Compose Email then edited mid-day (Quantity line dropped, lead time hoisted) without the test suite.
- 29382: HTML fell back on `&middot;`.

### 2026-08-31 — Resend key, masked halt, deleted client · EXTERNAL, MISLEADING, SCHEMA, LIVE-EDIT
- 28533: `temperature is deprecated for this model` — first production run of the 08-27 Anthropic node.
- 28546, 28558: all 56 sends `401 API key is invalid`; halt path passed Sent-Log ids to an Offers update → alert blamed `Write Clear Flag on Halt`. Fixed the halt path mid-day.
- 28559: Heinz, 507 sends, all 401; alert "no reason recorded".
- 28570: key fixed, 507/507 sent, then `Write Sent Log` 422 on a Client deleted mid-run → offer never marked Broadcasted; alert said "NO OFFERS WERE EMAILED". Fixed `Write Sent Log` to continue on error.
- 28739 (one-shot Corona/Peroni): 288/288 sent, same 422.

### 2026-08-27 — HTML styling node added after a successful send · LIVE-EDIT
An Anthropic `Style as HTML` node inserted into the live path at 19:51. Caused every 08-31 and 09-01 model failure above. Removed 2026-09-02.

### 2026-08-25 — `Claude Review Status` field missing · SCHEMA
Execution 25069: `422 UNKNOWN_FIELD_NAME` on Create Offers; 35 parsed tequila/mezcal offers lost in one batch. Three ingestion pipelines write the field. Recreated.

### 2026-08-24 — two dispatch runs three minutes apart · SILENT
24622 cancelled after 30 min, 24624 cancelled after 3 days at `Await Approval`. Cancellations do not fire the ERROR HANDLER; the Weekly Health Check now looks for them.

### 2026-08-20 — audience could not exclude countries; malformed emails · CONTENT
`Target Countries` is include-only, so "everywhere except Ireland and USA" was inexpressible and enumerating countries dropped 440 blank-country clients. Added `Excluded Countries`. Also: 164 Clients rows store the email with a trailing comma and the old regex accepted them; "USA" did not match "United States".

### 2026-08-19 — mixed-warehouse bundle told every buyer one warehouse · CONTENT
Bundle `SPIRITS-APERITIFS-T2-2026-08-19`: Terms read from member[0] only. Caught in preview before sending. Terms now printed per line when they differ.

### 2026-08-18 — dispatch audit: six defects, one DRAFT trap · SILENT, DRAFT, N8N-SEMANTICS
- Schedule fired 01:00 UTC (instance TZ Asia/Shanghai), four hours before the backup → **no scheduled dispatch had ever passed gate 2**; every send was hand-triggered.
- `Send via Resend` had no `onError`/retry → one bad address aborted the send with zero log rows.
- Halts were a silent NoOp.
- Group selection was whichever record Airtable returned first.
- The six fixes landed in the draft and were not live until someone checked `activeVersionId`.
- PDF ingestion: `Mark Needs Review` 404 for eight days = node authenticated against the wrong Gmail mailbox (Gmail returns 404, not 403); the fix also sat in draft four days. See `.claude/skills/offer-dispatch/n8n/INCIDENT-2026-08-18-pdf-ingestion.md`.

### 2026-08-17 — Coffee-Mate offer printed twice · CONTENT
Trader had hand-written the price list into `Public Note` because the template omitted MOQ and validity; 181 buyers got both renderings (4.03 by hand vs 4.02 derived). Note lines restating printed facts are now dropped.

### 2026-08-14 — n8n quota; price with no basis; cost price · EXTERNAL, CONTENT
- 17009: `Execution limit reached` — n8n Cloud plan quota; backup and dispatch both lost.
- 377 EU/UK spirits buyers were told "Price: EUR 18.25" for a per-bottle price (`Price Display` has no basis).
- `Margin %` blank on the whole bundle → `Sell Price = Buy Price`; quoted at cost.

### 2026-08-08 — Supersede Supplier Price Lists would have expired 1,981 of 2,136 offers
Wipe bug (not strictly-older-only). Disabled per Anil; fixed in draft; **do not enable without his OK**.

### 2026-08-06 — one-shot campaign send, five failure classes in one day · ONE-SHOT, N8N-SEMANTICS
`AKAY — Campaign / Offer Send` (1,232 recipients): dead duplicate Resend credential (401); `require('zlib')` blocked in n8n Cloud; OOM building an HTML body per item (11091); Airtable `fields` nested under `.fields` made every recipient look email-less (11153, 11220, 11270); two crashes. Codified as System Instructions "Email Campaigns via n8n + Resend — Canonical Method".

### 2026-08-05 — `Products` field missing; ERROR HANDLER never worked · SCHEMA, SILENT
- `Products` link field gone → `422 UNKNOWN_FIELD_NAME` in Price Intelligence, Link Offers To Products and all four ingestion pipelines. Recreated.
- ERROR HANDLER `Compose Alert` referenced an undeclared `ALERT_TO` → the handler itself crashed on every failure since 08-03, so no alert was ever sent.
- `WhatsApp Log` table found deleted (since ~07-29): Airtable `403 INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND`, long misread as a Whapi token problem; every inbound WhatsApp message dropped and the nightly backup aborted at that table. Recreated; 591 records restored from the 08-04 export.

### 2026-08-04 — Nivea send: field deleted mid-run, ignore list stale, wrong offer · SCHEMA, LIVE-EDIT
- 9317: `Send Approval Status` deleted from Offers while the send was running → filter 422.
- 9308, 9311: `_offerIds` not in `Write Sent Log` ignore list after bundle support was added that morning.
- "A random grocery offer with 5,042 recipients" selected instead of Nivea; filter temporarily hard-coded, then reverted. Same TEMP hard-code pattern repeated 08-05 (Guinness, Absolut) and 08-07 (Budweiser).

### 2026-08-03 — blank Sent Log; approval mail lost in SENT · N8N-SEMANTICS, MISLEADING
- 7846: all 194 log rows blank — Reconcile read metadata from the HTTP node's output, which is the Resend response, not the send.
- Approval mail sent from offers@ to offers@ → Gmail filed it under SENT with no INBOX label. Redirected to ak@akay.ie.

### 2026-07-30 → 08-03 — four days of silent dispatch failure · EXTERNAL, SILENT
Published dispatch carried an expired Airtable credential; every 9am run 401'd and nothing reported it. Found by going looking. This is why the ERROR HANDLER exists.

### 2026-07-29 → 08-27 — ~5,000 WhatsApp messages never classified · DRAFT
`Classify Message` authored 08-27 but left as a draft earlier; the active workflow stayed on the previous 3-node version. Published 2026-08-30. See `n8n/README.md`.
