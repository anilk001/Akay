# n8n migration — Cloud → self-hosted (DigitalOcean)

Working notes for moving the Akay n8n instance off n8n Cloud. Written 2026-08-15.
Everything below marked "verified" was read from the live Cloud instance via the
n8n API, not assumed.

## Source and target

| | |
|---|---|
| Source | n8n Cloud — `akay-team.app.n8n.cloud` |
| Target | Self-hosted on DigitalOcean droplet `134.122.0.108`, domain `n8n.akay.ie` |
| Reason | Cloud execution limit was being hit — the whole instance failed for ~9h on 2026-08-13/14 (476+ failed runs, every workflow, including the error handler itself) |

**Source n8n version: 2.33.4** — *this figure came from the contractor, not from
our own check; confirm it in the Cloud UI (bottom-left, or Settings → About)
before pinning anything to it.* The target must be pinned to this. The
DigitalOcean 1-Click image installs *latest*, which is not the same thing — a
version gap can silently break workflow JSON on import via node `typeVersion`
incompatibilities. Confirm the droplet's actual version before importing.

## Scale (verified)

- **30 workflows**
- **16 stored credentials** — note this is double the "8" quoted by the
  contractor, and the Google-OAuth subset is 8, not 4:

  | Type | Count | Names |
  |---|---|---|
  | `gmailOAuth2` | 6 | Gmail account, Gmail account 2–5, "offers n8n" |
  | `googleContactsOAuth2Api` | 1 | Google Contacts account |
  | `googleDriveOAuth2Api` | 1 | Google Drive account |
  | `airtableApi` / `airtableMcpOAuth2Api` / `airtableTokenApi` | 3 | Airtable account, Airtable account 2, Airtable PAT account |
  | `anthropicApi` | 1 | Anthropic account |
  | `imap` | 1 | IMAP - offers@akay.ie |
  | `httpHeaderAuth` / `httpBearerAuth` | 2 | Header Auth, Bearer Auth (Whapi) |
  | `n8nApi` | 1 | n8n API (akay-team) |

  Some may be dead/unused — worth checking which are actually wired into active
  workflows before re-creating all 16.

## The credential wall (verified — do not plan around this)

**n8n Cloud never releases credential secret values.** The API returns only
`id`, `name`, `type` — no secrets. There is no shell/Docker access on Cloud, so
the usual `n8n export:credentials --decrypted` CLI route does not exist either.

Consequence: **every credential is re-entered by hand on the new instance.** No
tool, person, or script avoids this. The ~8 Google OAuth ones each need a
browser "Allow" click by the account owner.

⚠️ Any migration plan containing `docker exec ... n8n export:credentials` on the
*source* is written for a self-hosted→self-hosted move and does not apply here.
One such plan was circulated on 2026-08-15; Phase 1 of it is impossible.

⚠️ If `--decrypted` is ever used anywhere, it writes every secret in plaintext to
disk. Delete every copy (host + container) afterwards.

## Division of labour

**Via n8n API (Claude can do):**
- Recreate all 30 workflow definitions on the target — nodes, connections,
  branching, `jsCode` bodies, settings
- Re-point each node's credential *reference* to new credential IDs
- Fix known silent-breakage classes (below)
- Test against pinned data; cross-check vs. real Cloud execution history
- Stage the activation order at cutover

**Human-only (no API path):**
- Creating credentials + Google OAuth "Allow" clicks (owner only)
- Repointing the Whapi webhook (third-party account)
- Droplet / Docker / TLS / DNS
- Swapping this session's MCP connector to the new host

## Known silent-breakage risks

1. **Error-workflow references are by internal ID, not name.** Every workflow
   carries `settings.errorWorkflow: "OnCFbngmILTKsdkw"` (ERROR HANDLER — Akay
   Alerts). If IDs change on import, error alerting stops without any visible
   failure. Verify post-import.
2. **Schedule trigger timezones.** 11+ schedule triggers (WhatsApp ingestion
   every 5 min, hourly product linking, daily digests at 21:00/22:00
   Europe/Dublin, daily backup). A dropped timezone shifts all of them silently.
3. **Webhooks must be repointed at the external service.** Known inbound:
   - `WhatsApp Filter Layer` (`DO2ltjkISp2YDNnc`) — path
     `/webhook/3997c8d8-8da7-4555-b818-46380332e320`, fed by **Whapi**. Whapi
     must be updated to `https://n8n.akay.ie/webhook/...` or every inbound
     WhatsApp message is dropped.
4. **"Active" is not "working".** n8n will happily show a workflow as active
   while it has no credential attached, and every run just fails. Verify via
   real execution results, not the on/off toggle.
5. **Sub-workflow calls by ID.** `Daily Backup — Akay` (`Jwc1Em8Qh4qUUZLl`)
   calls a per-table sub-workflow by ID. Same failure mode as #1.

## Cutover shape

1. Build target pinned to 2.33.4, HTTPS on `n8n.akay.ie`, backups + one restore test
2. Create all credentials by hand (owner clicks Google consent)
3. Rebuild workflows via API, **all triggers off**
4. Verify each against Cloud behaviour
5. Repoint Whapi webhook in a quiet window
6. Activate in small groups, checking Airtable after each so nothing double-processes
7. **Keep n8n Cloud live ~2 weeks** as the rollback path

## Open items

- Confirm target n8n version (must be 2.33.4)
- Confirm who else holds admin on the Cloud instance — "Offer Dispatch — Akay"
  was edited 2026-08-14 09:33 by someone other than Claude or (apparently) Anil
- Decide which of the 16 credentials are actually still in use
- New instance API key → into the MCP config (`N8N_HOST`, `N8N_API_KEY`);
  generate it on the *target*, Settings → n8n API
