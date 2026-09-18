# Spirits & Champagne offer dispatch — September 2026

A one-off mailmerge to 1,322 spirits buyers over the Resend batch API. One
email per recipient, never BCC. No n8n. Built to the brief of 2026-09-18.

**This script writes nothing to Airtable.** Bounces and unsubscribes stay with
the existing n8n workflow that ticks `Do Not Contact`, sets `Status` Inactive
and stamps `Suppression Reason`.

| File | What it is |
| --- | --- |
| `dispatch.mjs` | The script. Node 18+, no dependencies. |
| `dispatch.test.js` | Filter, batching and copy tests. Run before every send. |
| `email.txt` | The body copy. Ships holding the paste marker — see below. |
| `recipients.csv` | **Not in git.** Anil provides it; it is 1,322 people's addresses. |
| `progress.json` | **Not in git.** Written after every batch; this is what makes a re-run safe. |

## Run order

```bash
export RESEND_API_KEY=...            # never write it to a file
cd marketing/spirits-champagne-sep2026
cp ~/Downloads/recipients.csv .      # or pass --csv <path>

node dispatch.test.js                # 27 checks, no network
node dispatch.mjs --dry-run          # 1. reconcile. Anil reviews.
node dispatch.mjs --test             # 2. one email to ak@akay.ie. Anil reviews.
node dispatch.mjs --send             # 3. the full run, resumable.
node dispatch.mjs --report           # 4. the summary. --with-status polls Resend.
```

`--send` refuses to start unless `progress.json` records a test send **and**
the copy still hashes to what that test went out with. Changing `email.txt`
after Anil approves the test invalidates the approval, so the script makes you
re-run `--test`.

It must run somewhere with egress to `api.resend.com` — a Claude Code sandbox
does not have it.

## The copy

`email.txt` holds `<<<PASTE FINAL COPY>>>`. Replace the whole file with the
final body, and nothing else: `dispatch.mjs` adds the flat `Hello,` greeting and
the `Reply STOP…` opt-out itself, so they are byte-identical on every email.

`firstName` is read from the CSV and deliberately never used — a large share of
that column holds inbox handles and generic salutations.

The HTML part is derived from `email.txt`: paragraphs on blank lines, bare URLs
linked, no images, no tracking pixel. Drop an `email.html` beside it to send
hand-written HTML verbatim instead.

Preflight **checks** the brief's constraints rather than changing them:

| | |
| --- | --- |
| Paste marker still present | error |
| Link to anywhere but `quote.akay.ie` / `akay.ie` / `track.akay.ie` | error |
| Link to `akay.ie` rather than `quote.akay.ie` | warning |
| Unreplaced `{{token}}`, or a per-recipient name | error |
| Anything that looks like a tracking pixel | error |
| A name on the `REVIEW_TERMS` list (today: `Loendersloot`) | warning |

Add supplier names to `REVIEW_TERMS` in `dispatch.mjs` and the dry run will
point at them.

## Filters and the hard gate

Applied in the brief's order, counted at each step:

1. **Suppression guard** — `Do Not Contact` ticked, `Status` not Active, or a
   non-blank `Suppression Reason`. The export should already exclude these, so
   **any hit stops the run**: the CSV is wrong. A missing or malformed email
   address stops it for the same reason.
2. **Country exclusion** — Ireland, USA, Brazil. Matched on an exact set after
   normalising away case, punctuation, spacing and accents, so `U.S.A.`,
   `Republic of Ireland` and `Éire` all hit while **Northern Ireland** (United
   Kingdom, a different market) correctly does not.
3. **Dedupe by email** — lowercased and trimmed, first occurrence kept.
4. **Drop `@akay.ie`** — internal.

Then two gates, both hard, both exit non-zero:

- `fetched − suppressed − excludedCountry − duplicates − internalDropped` must
  equal `eligible`
- `eligible` must be exactly **1,322**

> The brief's §4 table has no line for step 4, so its stated arithmetic only
> closes when no internal address is in the export. The script carries the term
> and says so loudly when it is non-zero. `excludedCountry` and `duplicates`
> landing somewhere other than 28 and 31 warn but do not stop — 1,322 is the
> number that matters.

## Batching and why a re-run is safe

The eligible list is sorted by lowercased email with a plain byte comparison
(never `localeCompare`, which varies by machine), then sliced into batches of
100. Same CSV in, same batches out, on any machine.

Each batch posts with `Idempotency-Key: spirits-champagne-sep2026-batchNN`.

Two things make a kill-and-re-run safe, and you want both:

- **`progress.json`**, written through a temp file after every batch, so a kill
  mid-write cannot truncate it. On start the script verifies the CSV's sha256
  against the recorded `inputHash` — if the file changed, batch NN no longer
  means the same recipients, and it stops and asks. It then rebuilds the exact
  batches the earlier run formed, re-checks each sent batch still covers the
  same addresses, and prints what it is skipping and why.
- **The idempotency key**, which stops Resend re-sending a batch it already
  accepted. Note its window is finite (Resend caches these for about a day), so
  it is the belt and `progress.json` is the braces — a resume days later is
  covered by the progress file alone.

### The degrade to 50

Per the brief, two timeouts or 5xx on one batch drops the **remainder** to 50
per call. The failing batch itself keeps retrying at 100 with its own key and
unchanged payload — that is exactly what the idempotency key protects, and
re-forming a batch mid-flight is how you double-send.

The re-formed 50s get their own key namespace, `…-b50-batchNN`, so one
idempotency key never points at two different payloads. `progress.json` records
`degradedAt` and the report notes it.

## After the send

`--report` writes `report.md` from `progress.json`: batches, counts, attempts,
failures, elapsed, final batch size. Add `--with-status` to poll every accepted
id for its `last_event` and tally real bounce and complaint counts — paced at
2/s, so roughly 11 minutes for a full run.

**Bounce watch: under 2% is healthy. Over 5%, stop and tell Anil** — kill the
run, and the next `--send` resumes from the last completed batch.

## Tests

`dispatch.test.js` is deliberately **not** wired into `npm test`. That suite
gates the five-minute catalogue refresh, and a one-off campaign script has no
business blocking a snapshot commit. Run it by hand:

```bash
node marketing/spirits-champagne-sep2026/dispatch.test.js
```

It covers the CSV parser (quotes, embedded commas, CRLF, BOM), every country
variant and the near-misses that must survive, the four filters and their
reconciliation, first-occurrence dedupe, sort stability, both hard gates, batch
planning and key namespacing, the tail re-plan after a degrade losing nobody,
one-message-per-recipient payloads, and the copy checks.
