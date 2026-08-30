---
name: offer-dispatch
description: Send an Akay sales offer from Live offers to targeted clients — the end-to-end dispatch procedure, its gates, and the failure catalogue. Use when asked to prepare and send offers to clients, to queue an offer for dispatch, to check why a dispatch did not go out or went out wrong, or before touching the "Offer Dispatch — Akay" n8n workflow.
---

# Offer dispatch (Akay)

Sending an offer is **not** "write an email and send it". It is a queue-and-gate
pipeline: Airtable holds the offer and the audience, the n8n workflow
`Offer Dispatch — Akay` (id `dAYMAj6mZD3hTV4T`) applies the gates and sends one
email per recipient through Resend, and a human approves in between.

Every recurring problem with this process has come from re-deriving the
procedure each time. Follow the order below. Do not improvise a new send path —
the one-off workflows in n8n (`Spirits T2 Loendersloot…`, `AKAY — Campaign /
Offer Send`) exist because someone did, and each one skipped a different gate.

## Where to run a dispatch

**Claude Code, in this repo, a fresh session per dispatch.** Not a claude.ai chat.

Steps 4 and 5 of the procedure — the preflight check and the email preview — are
scripts in this directory. They need a shell, Node and Python, so they only run
where the repo is checked out. A claude.ai chat can read Airtable and trigger the
workflow, which means it can queue a send it cannot check first. That is the exact
gap this skill exists to close, so don't dispatch from there.

One session per dispatch, started fresh: a run sends one dispatch group, and a
fresh session loads `CLAUDE.md` and this skill cleanly instead of carrying stale
assumptions from earlier work.

Use claude.ai chat freely for the things that need no tooling — "did the Coffee-Mate
offer go out?", "who's in the Indv spirits segment?", reading the Offers Sent Log.
The Airtable `System Instructions` record *OFFER DISPATCH TO CLIENTS — Canonical
Method* carries the rules for those sessions.

**Note on Claude Code on the web:** the local `airtable-mcp-server` in `.mcp.json`
reaches `api.airtable.com`, which the remote environment's egress policy may block
(`Host not in allowlist`). Either add that host to the environment's allowlist, or
use the hosted Airtable connector, which works either way. The Claude Code CLI on
your own machine has no such restriction.

## The five gates, in the order they run

| # | Gate | Where | Fails when |
|---|---|---|---|
| 1 | `Send Eligible` = Yes | Airtable formula, re-checked in `Gate Check` | Status ≠ Live, Is Expired ≠ No, Do Not Broadcast ticked, Offer Approval Status ≠ Approved |
| 2 | Verified backup **dated today** | `Backup Check` (Europe/Dublin date) | `Daily Backup — Akay` has not landed a Verified Backup Registry row for today |
| 3 | ≥1 eligible recipient | `Build Recipients` | targeting matches nobody, or bundle members disagree on the audience fields |
| 4 | Composition + leak guard | `Compose Email` → `Composed?` | a required public field is empty, or a supplier name / buy price / internal address appears in a public field |
| 5 | Human approval | `Await Approval` → ak@akay.ie | not clicked (3-day limit, then the run halts) |

Gate 4 runs **before** gate 5 as of 2026-08-18, so the approval mail contains the
exact rendered email. Read it before approving — that mail is the last point at
which a bad offer can be stopped.

`Listing Approved` is **not** one of these. It gates offers.akay.ie only, never
dispatch. Do not tick it to make a send work.

## Procedure

1. **Pick the offers.** They must be `Send Eligible = Yes`. Check with the
   Airtable MCP against the `Offers` table (`tbljBgWrnIMZzkSAr`).

2. **One dispatch group per run.** A run sends exactly ONE group: either a
   single offer, or every offer sharing one `Bundle ID`. Queueing two unrelated
   offers does not send two emails — it sends the first and silently leaves the
   rest queued for the next run. Multi-line offers therefore need the same
   `Bundle ID` on every line, plus a `Bundle Title` for the subject.

3. **Set the targeting on the offer**, not in a filter you invent:
   - `Target Countries` — comma-separated client **countries**, matched
     case-insensitively against `Clients.Country`. Blank = every country.
   - `Target Capsule Tags` — client needs ANY one. Blank = no tag filter.
   - `Match Interest Category` — tick to require `Clients.Interest Categories`
     to contain the offer's `Category`; blank-interest clients are then excluded.
   - Bundle members must agree on `Target Countries`, `Target Capsule Tags`,
     `Bond/Customs Status`, `Match Interest Category` and `Category`, or gate 3
     halts the run.

4. **Preflight before queueing.** Export the offers (and ideally Clients and
   Backup Registry) as JSON and run:

   ```bash
   python3 preflight_dispatch.py dispatch.json      # from this skill's directory
   ```

   It re-checks every gate plus the content quality checks, and exits non-zero
   on a blocker. Input shape (Airtable records, field **names**):

   ```json
   {"offers": [{"id": "rec…", "fields": {…}}], "clients": [...], "backups": [...]}
   ```

5. **Preview the actual email.** The approver and the client should never be the
   first to read it:

   ```bash
   node compose_preview.cjs dispatch.json
   ```

   This is the same composer the workflow runs, so what it prints is what goes
   out. Fix the Airtable fields until the preview reads like an offer you would
   send by hand.

6. **Queue and trigger.** Tick `Queued for Dispatch` on every line of the group,
   then either run the workflow now (`execute_workflow` on `dAYMAj6mZD3hTV4T`, or
   POST the offer id to the `dispatch-offer` webhook) or leave it for the
   **08:00 Europe/Dublin** schedule. The flag is cleared automatically whether the
   run sends or halts — a halt does **not** leave it queued for a retry, so a
   halted offer must be re-queued by hand. A halt now emails ak@akay.ie with the
   reason, so silence means the run has not finished, not that it failed.

7. **Confirm, then report.** Do not tell anyone it went out until:
   - the execution status is `success`, and
   - `Reconcile._summary` reads `Dispatch complete — N/N sent`, and
   - `Offers Sent Log` has N rows with `Dispatch Status = Sent`.

   A partial send leaves Status = Live and clears the queue flag: nothing
   retries it on its own.

## What the email may contain

Only fields marked SAFE in the Airtable field descriptions. The composer reads
exactly this allowlist:

`Public Product Description`, `Public Spec`, `Price Per Unit & Case` (falling
back to `Price Display` + `Price Type`), `Bond/Customs Status`, `Availability` /
`Stock Display`, `MOQ`, `Lead Time`, `Public Terms`, `Public Note`,
`Auto Expiry Date`.

Never `Offer Name`, `Notes`, `Trader Comment`, `Delivery Info Source`,
`Supplier Name`, `Buy Price` or `Margin %`. The leak guard scans for the first
three of those and halts the whole run on a hit.

**Price must always carry its basis.** `Price Display` is a bare figure and its
own field description ("Per-case price") is wrong for the five unit-priced
`Price Type` values. Use `Price Per Unit & Case`, which states the basis. This
same defect was fixed in the `whatsapp link` formula and in
`Price Per Unit & Case` itself; the dispatch email was the last place it lived
(see `n8n/PATCH.md` §3).

**Public Note is for information the fields do not carry.** Do not paste the
price list, MOQ, terms or validity into it — the product block prints all four.
The composer drops note lines that restate a printed price or fact, and
preflight warns about them, but a hand-written note drifts out of step with the
fields and is the reason the 2026-08-17 Coffee-Mate send printed the whole offer
twice.

## Changing the workflow

The Code nodes are kept in `n8n/` with a regression suite. Never edit them in the
n8n UI — edit the file, run the tests, then paste:

```bash
cd n8n && node test-nodes.cjs      # 14 tests over the two real 2026-08 dispatches
```

**Then publish, and verify you published.** `update_workflow` writes to the
*draft*; production keeps running the published version until `publish_workflow`
is called. Assert `versionId === activeVersionId` afterwards. On 2026-08-18 the
whole dispatch repair sat unpublished and therefore not live until this was
checked — and the same trap had hidden a PDF-ingestion fix for four days. When
reading a workflow to explain a failure, read the **published** version via
`get_workflow_version(activeVersionId)`; `get_workflow_details` returns the draft.

There is no other way to test a change: exercising the live workflow means
emailing real clients. `n8n/PATCH.md` records what changed and why, with the
execution ids and record ids behind each finding.

## Failure catalogue

Items marked **[fixed]** were repaired in the live workflow on 2026-08-18; the
evidence and the exact changes are in `n8n/PATCH.md`. They are listed here
because the symptom is what you will recognise if something like it recurs.

| Symptom | Cause | Fix |
|---|---|---|
| Queued, nothing sent, no email to anyone | The run halted. `Halt — Report Reason` is a silent NoOp | Read the execution's `haltReason` in n8n. **[fixed]** makes a halt throw so the ERROR HANDLER emails ak@akay.ie |
| Every scheduled run halts; only hand-triggered sends work | The schedule fires 01:00 UTC, four hours before `Daily Backup` writes today's Verified row at ~05:05 UTC, so gate 2 always fails | **[fixed]** pins the timezone and moves it to 08:00 Dublin. Meanwhile: trigger by hand after the backup, and check it landed **Verified**, not Flagged |
| `LEAK GUARD TRIPPED … buy price 1` on a clean offer | The guard tests the bare integer Buy Price and matches the "1" in "1 pallet/line" | **[fixed]**. Meanwhile: change the MOQ wording, or set a Buy Price with decimals |
| One bad address kills the whole send, no log rows at all | `Send via Resend` has no `onError`/retry, against System Instructions §5 | **[fixed]** adds `continueRegularOutput` + 3 retries so failures log as `Dispatch Status = Failed` |
| Only one of several queued offers went out | One run = one dispatch group, and the group chosen was whatever Airtable returned first | Give multi-line offers a shared `Bundle ID`; otherwise queue one group per run. **[fixed]** makes the choice oldest-first and names what was deferred |
| Client asks whether the price was per bottle or per case | The mail printed bare `Price Display` | **[fixed]** switches to `Price Per Unit & Case`. Set `Price Type` on the offer either way |
| No MOQ or validity in the mail, so the trader hand-writes them into `Public Note` and the offer prints twice | The template omitted both | **[fixed]** prints them and de-duplicates the note |
| Offer quoted at cost | `Margin %` blank ⇒ `Sell Price` = `Buy Price`. Sent to 377 buyers on 2026-08-14 | Preflight warns. Set `Margin %` unless it is already embedded in Buy Price |
| `Execution limit reached` at the trigger | n8n Cloud plan execution quota exhausted (2026-08-14 lost both the backup and the dispatch) | No workflow change can fix this — check the plan; re-trigger by hand |
| Dispatch waited hours | Gate 5 is a human click | Expected. Observed latency 1–6 h; plan sends around it |
| Partial send, and nothing ever retries it | The halt path clears the queue flag, and there is no dedupe against `Offers Sent Log` to make a retry safe | Unresolved by design — see "Known issues" in `n8n/PATCH.md`. Re-queue by hand and expect duplicate delivery to whoever already got it |

## Related

- `offer-data-validator` — row-level price/pack/name data errors.
- `price-list-intake` — turning a supplier list into importable offers.
- `offers-catalogue` — the public site, a **different** pipeline with a
  different gate (`Listing Approved`).
- Airtable `System Instructions` → *Email Campaigns via n8n + Resend — Canonical
  Method* is the standard every send path must meet.
