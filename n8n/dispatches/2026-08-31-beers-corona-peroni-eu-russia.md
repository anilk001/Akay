# Beers offer dispatch — Corona Extra & Peroni Nastro Azzurro (EU & Russia)

**Date:** 2026-08-31
**Campaign key:** `beers-corona-peroni-eu-ru-2026-08-31`
**Workflow:** `Corona Extra & Peroni — EU & Russia Offer Send (one-shot)` (n8n `POnqJmKJLiLi4LYp`)
**From:** `Akay Irl Ltd <offers@akay.ie>` — one email per recipient via Resend, never BCC.

## Why a one-shot workflow rather than `Offer Dispatch — Akay`

Anil asked for the text to go out **as is**, with no template. The production
dispatch workflow composes the mail from Airtable fields (greeting, product
blocks, closing terms, footer), so it cannot send a verbatim body. This clones
the same-day `Nescafe Gold 190g — Offer Send (one-shot)` pattern, which exists
for exactly that case: same Resend credential, same per-recipient send, same
client filters, no BCC, and one Offers Sent Log row per recipient.

## Subject

```
Corona Extra & Peroni Nastro Azzurro — from EUR 12.90 / case
```

Not supplied by Anil; composed in the style of the Nescafe one-shot
(`Nescafe Gold 190g — 5.15 EUR CIF, Ready Stock`).

## Body — sent verbatim

```
We can offer 

1728 Cs Corona Extra 4 × 6 × 355ml Bottles at Euro 15.10  - ex Loendersloot - Mexico Origin - T2 

1728 Corona Extra 4 × 6 × 330ml Bottles at Euro 14.90 ex Loendersloot - T2 goods

1872 Peroni Nastro Azzurro glass bottles 24 x 33cl 5.1% at EUR 12,90 / case
Ex bond Italy
MOQ : 1 FTL 1872 cs
You can check lot of offers also at offers.akay.ie  - no sign up or passwords needed. Best Regards Anil Khetan ak@akay.ie, WhatsApp  +353 87 238 2368
```

**One edit to the text as supplied:** `0ffers.akay.ie` (zero) → `offers.akay.ie`.
Same correction the Nescafe one-shot made hours earlier the same day, which also
carries a guard that throws if the typo survives into the body. A zero-prefixed
host does not resolve, so leaving it would have handed 288 buyers a dead link —
the one line in the mail whose whole purpose is to be clicked.

## Audience — 288 recipients

Clients carrying the **`Indv beers`** capsule tag whose Country is an EU member
state or Russia. Country is an **INCLUDE** list here, so a blank Country is
correctly not a member (unlike an exclusion list, where a blank must never be
treated as a match).

Filters applied, in order — same rules as the production `Build Recipients`:

| Step | Removed |
|---|---|
| Clients scanned | 6,133 |
| `No Mailing` tag | 128 |
| `Do Not Contact` | 4 |
| Status ≠ Active | 342 |
| Missing/invalid email | 654 |
| Not tagged `Indv beers` | 3,747 |
| Country not EU or Russia | 959 |
| Excludes T2 or Bonded | 0 |
| Duplicate email (lowercased) | 11 |
| **Recipients** | **288** |

Split after dedupe: **241 EU · 47 Russia**.
Countries reached: Austria, Belgium, Bulgaria, Croatia, Cyprus, Czechia,
Estonia, France, Germany, Greece, Hungary, Ireland, Italy, Latvia, Lithuania,
Malta, Netherlands, Poland, Romania, Russian Federation, Slovakia, Slovenia,
Spain.

`Build Recipients` **hard-asserts** the count is exactly 288 and aborts the run
on drift, so the workflow can never quietly mail a different audience than the
one signed off here.

## Airtable offer lines

Three lines created in `Offers`, **supplier deliberately blank** (none was
stated), bundled under `Bundle ID = BEERS-EU-RU-2026-08-31`:

| Record | Line | Price | Bond | Ex |
|---|---|---|---|---|
| `rec0aA2iUgDiksRrt` | Corona Extra 4 × 6 × 355ml, 1,728 cs | EUR 15.10/case | T2 | Loendersloot |
| `recK9YMbWkJTl7ZbH` | Corona Extra 4 × 6 × 330ml, 1,728 cs | EUR 14.90/case | T2 | Loendersloot |
| `reckyDZvr8dOo0tI0` | Peroni Nastro Azzurro 24 × 33cl 5.1%, 1,872 cs | EUR 12.90/case | Bonded | Ex bond Italy |

No supplier buy price was given, so `Buy Price` holds the client-facing figure
Anil supplied and `Margin %` is left blank (any uplift is already embedded).
This is recorded on each line in Notes and Trader Comment so nobody later reads
`Buy Price` as a supplier cost. `Listing Approved` is **not** ticked — that gate
is human-only, so these lines are send-eligible but not published to
offers.akay.ie.

## Safety properties

- One email per recipient; `Build Sends` throws if any payload carries cc/bcc or
  more than one `to`.
- Per-recipient Resend `Idempotency-Key` (`campaign:email`), so re-running the
  workflow cannot deliver a second copy.
- `List-Unsubscribe: <mailto:offers@akay.ie?subject=unsubscribe>` on every send.
- `Send via Resend` uses `onError: continueRegularOutput`, so one bad address
  cannot abort the run and lose the log rows for everyone else.
- `Reconcile` refuses to write anything if the send count and response count
  disagree — misaligned indices would attribute log rows to the wrong clients.
- Pilot run (execution 28737) sent only to ak@akay.ie and wrote no log rows.

## Outcome

| | |
|---|---|
| Pilot run | n8n execution `28737` — 1 email to ak@akay.ie, no log rows. Passed. |
| Full run | n8n execution `28739`, started 12:03:45 UTC |
| Resend calls completed | 12:06:58 UTC |
| **Sent** | **288 / 288** |
| Failed | 0 |
| Offers Sent Log rows | 288 (all `Sent`, each carrying its Resend message id) |
| Offer Status | all three lines set to `Broadcasted` |

## Incident — logging stopped at row 24, sends unaffected

`Write Sent Log` wrote 23 rows (12:06:59 → 12:07:13) and then the run errored:

```
NodeApiError 422 — Record ID rec4WbBP6H8xCR5Pr does not exist
```

`rec4WbBP6H8xCR5Pr` is the Clients row for **Baikai** (baikai@mtevins.fr), which
existed when `Fetch Clients` read the table minutes earlier and was gone by the
time the log row referencing it was written — the signature of a hard bounce
handled by the bounce workflows mid-run (Hard Rule 1 deletes the Client on a
hard bounce). A second row, **Victor Toxopeus** (`recfEU00Joq87b0vw`,
v.toxopeus@salvors.nl), had gone the same way and surfaced on the backfill.

Airtable rejects the whole request on one bad linked-record ID, and the node's
default `onError: stopWorkflow` ended the run — so **265 log rows were lost
while every one of the 288 emails had already been sent.** The 265 were
backfilled by hand from the execution's own `Reconcile` output, so every row
carries its real Resend message id. The two rows whose Client no longer exists
were written without the `Client` link, with the reason recorded in Notes.

### Two fixes worth making before the next one-shot send

1. **`Write Sent Log` should be `onError: continueRegularOutput`** — the same
   setting `Send via Resend` already carries, and for the same reason: one bad
   row must not throw away the log for everyone else. This is a strictly worse
   failure than the one it mirrors, because by the time logging runs the emails
   are already gone and there is nothing to retry.
2. **`Reconcile` should verify each `Client` ID still exists** (or drop the link
   and say so in Notes) before handing rows to Airtable. The Clients table is
   mutated by the bounce workflows *while a dispatch is in flight*, so a record
   ID read at the start of a run is not guaranteed valid at the end of it.
