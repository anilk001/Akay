# Dispatch workflow patch — audit of 2026-08-18

Seven changes to **`Offer Dispatch — Akay`** (`dAYMAj6mZD3hTV4T`). Each one is a
defect found with evidence from live executions and Airtable records; the
evidence is quoted so nobody has to re-derive it.

**Status: NOT YET APPLIED.** These were prepared and tested but the session that
wrote them was not permitted to write to n8n. Apply steps 1–5 below.

Every change is revertible: `update_workflow` writes a named version, and
`get_workflow_history` / `restore_workflow_version` roll it back.

---

## The seven defects

### 1. The scheduled dispatch could never pass the backup gate — BLOCKER

`Backup Check` requires a `Verified` Backup Registry row dated **today in
Europe/Dublin**. `Daily Backup — Akay` writes that row at **05:00–05:05 UTC**
(executions 20313, 19472, 18862, 18197 all start 05:00:04 and finish ~05:05).

The `Schedule` node was set to 09:00 with no workflow timezone, so it inherited
the instance timezone — **Asia/Shanghai** (visible in execution 17009's trigger
payload: `"Timezone":"Asia/Shanghai (UTC+08:00)"`). 09:00 Shanghai is **01:00
UTC**, four hours *before* the backup exists. In Dublin that is 02:00 of the same
date, so `today` had already rolled over and the newest Verified backup was
always dated *yesterday*.

Consequence: every scheduled run halted at gate 2. Queueing an offer and waiting
did nothing — and because of defect 7 nobody was told. Every send that actually
happened was hand-triggered (17519, 19860, 12119…).

**Fix:** pin the workflow timezone to `Europe/Dublin` and fire at 08:00 local
(07:00 UTC), after the backup lands. Nothing else in this workflow depends on the
instance timezone: `Backup Check` hardcodes Europe/Dublin, `Reconcile` uses UTC
ISO strings, and the approval wait is relative.

### 2. One rejected address aborted the whole send — BLOCKER

`Send via Resend` had no `onError` and no retry, so a single 4xx from Resend
stopped the workflow: **zero** `Offers Sent Log` rows written, no record of who
did receive it, and the offer left `Live` with its queue flag cleared. The
careful `Dispatch Status = 'Failed'` branch in `Reconcile` was unreachable code.

Airtable's own governance doc says this already — System Instructions → *Email
Campaigns via n8n + Resend — Canonical Method* §5: "RESEND NODE — … batching 2
per 1100ms, **onError continueRegularOutput, retryOnFail 3x**". The dispatch
workflow was the one send path that did not comply.

**Fix:** `onError: continueRegularOutput`, `retryOnFail: true`, `maxTries: 3`,
`waitBetweenTries: 1000`.

### 3. Prices were sent with no basis — BLOCKER (commercial)

`Compose Email` printed `Price Display`, a bare figure. On 2026-08-14 that put
this in front of **377 EU/UK spirits buyers**:

```
Glenfiddich 12 YO
Pack: 700ml
Price: EUR 18.25
```

Offer `rec06iT7L7tXxbq6f` has `Price Type = Per Bottle`, and the field
`Price Per Unit & Case` on the very same record already reads
**`EUR 18.25/bottle`**. `Price Display`'s own field description says "Per-case
price", which is wrong for the five unit-priced `Price Type` values — compare
`recKPkBXjoK6er2Da`, where `Price Display` is `EUR 18.90` but the case is
`EUR 113.40`.

This exact defect was found and fixed twice before, in the `whatsapp link`
formula ("a buyer clicking the Macallan link was told EUR 50.30 was the case
price when the case is EUR 301.80") and in `Price Per Unit & Case` itself
(2026-08-06, "understating the unit price by a factor of 3 to 24"). The outbound
email was the last channel still carrying it.

**Fix:** print `Price Per Unit & Case`; when empty, derive the basis from
`Price Type`; only a blank `Price Type` yields a bare figure, which is still
better than a false basis.

### 4. MOQ and validity were held in Airtable and omitted from the mail

Both offers above carry `MOQ` and `Auto Expiry Date` — the Coffee-Mate line has
`MOQ = "1 x 40FT (3,240 cartons)"` and expiry `2026-09-16` — and neither reached
the buyer. So traders wrote them into `Public Note` by hand, which caused
defect 5.

**Fix:** print `Minimum order` per line and one `Validity` line for the group.

### 5. The 2026-08-17 send printed the whole offer twice

The 2026-08-14 change made `Public Note` supersede `Public Terms`. It suppressed
the *terms* but not the *product block*, so when a trader had written the full
offer into the note — as they had for Coffee-Mate, precisely because of defect 4
— 181 clients received both renderings, with slightly different numbers
(`USD 4.03 per unit` by hand vs `USD 4.02/unit` derived).

**Fix:** drop note lines that restate an already-printed price or fact; print
`Public Terms` separately only when the surviving note does not carry it. The
`offer-dispatch` preflight also warns so the note gets trimmed at source.

### 6. A whole-number Buy Price made an offer un-sendable

The leak guard tested the bare `String(buy)`. With `Buy Price = 1` the pattern
matched the "1" in `MOQ = "1 pallet/line"` and halted the entire dispatch with
`LEAK GUARD TRIPPED … buy price 1` — about a price that never leaked. Reproduced
against live offer `rec0s3Wgoky82Hgwt` (FAIRY LEMON 350ML, Buy Price 1).

**Fix:** test `buy.toFixed(2)` always, the raw string only when it has decimals,
and a bare integer only when a currency introduces it. A genuine leak still
trips — see the two leak tests in `test-nodes.cjs`.

### 7. Halts were silent, and group selection was arbitrary

`Halt — Report Reason` is a `NoOp`. Gate failure, missing backup, empty audience,
declined approval — all ended the run with no notification anywhere, which is why
"we queued it and nothing happened" kept recurring.

Separately, `Build Recipients` and `Compose Email` each took `gateAll[0]`,
i.e. whichever record Airtable returned first. One run sends ONE group, so with
several offers queued the group that went out was arbitrary and an unlucky offer
could be skipped run after run.

**Fix:** pick the group with the oldest `Offer Date`; have `Compose Email` read
that choice from `Build Recipients` instead of re-deriving it; report the groups
left queued; and make the halt path throw so the already-attached ERROR HANDLER
workflow (`OnCFbngmILTKsdkw`, `errorWorkflow` in this workflow's settings)
emails ak@akay.ie. Throwing reuses working plumbing instead of adding a Gmail
node — there are six `gmailOAuth2` credentials on the instance and the MCP API
does not reveal which one `Await Approval` uses.

---

## How to apply

Verify the node code first — this is the only test that exists, since the live
workflow cannot be exercised without emailing real clients:

```bash
cd .claude/skills/offer-dispatch/n8n && node test-nodes.cjs   # expect 14/14
```

**Step 1 — settings, schedule and Resend error handling.**

```json
{
  "workflowId": "dAYMAj6mZD3hTV4T",
  "versionName": "Fix backup-gate timing + Resend error handling",
  "operations": [
    { "type": "setWorkflowSettings", "settings": { "timezone": "Europe/Dublin" } },
    { "type": "setNodeParameter", "nodeName": "Schedule",
      "path": "/rule/interval/0/triggerAtHour", "value": 8 },
    { "type": "setNodeSettings", "nodeName": "Send via Resend",
      "settings": { "onError": "continueRegularOutput", "retryOnFail": true,
                    "maxTries": 3, "waitBetweenTries": 1000 } }
  ]
}
```

**Step 2 — replace the two Code nodes.** Paste `build-recipients.js` and
`compose-email.js` whole, via `updateNodeParameters` with
`parameters: {"jsCode": "<file contents>"}`. Keep both nodes on **Run Once for
All Items**.

**Step 3 — make halts audible.** Add a Code node after
`Write Clear Flag on Halt`:

```js
// Fail Loudly on Halt — a halt is a failed dispatch attempt, so surface it as
// one. The attached ERROR HANDLER workflow emails ak@akay.ie with this message.
// The queue flag has already been cleared by the two nodes upstream, so the
// offer is not left stuck; it does need re-queueing once the cause is fixed.
const upstream = $('Halt — Report Reason').all().map((i) => i.json);
const reason = upstream.map((u) => u.haltReason).filter(Boolean)[0] || 'no reason recorded';
throw new Error(`Offer dispatch HALTED and sent nothing: ${reason}`);
```

then `addConnection` from `Write Clear Flag on Halt` to it.

**Step 4 — show the approver what will actually be sent** (optional, structural;
agree it with Anil first). Today `Await Approval` runs *before* `Compose Email`
and shows only the product name and price, so nobody reads the email before the
clients do — every content defect above reached buyers through an approved send.
Rewiring `Recipients OK?`(false) → `Compose Email` → a new `Composed?` IF →
`Await Approval` → `Approved?` → `Build Sends` puts the rendered body in the
approval mail and surfaces composition halts before a human is asked to wait.

**Step 5 — verify.** Preflight and preview a real offer, then dispatch one small
group and confirm `Reconcile._summary` reads `Dispatch complete — N/N sent`
before anyone is told it went out.

---

## Known issues NOT fixed here

- **A partial send is never retried.** `Reconcile`'s summary says the offer
  "stays in Ready to Send and can be retried", but the halt path clears
  `Queued for Dispatch`, so nothing retries it and there is no dedupe against
  `Offers Sent Log` to make a retry safe. Needs a design decision.
- **No success notification.** Blocked on knowing which of the six
  `gmailOAuth2` credentials to use.
- **n8n plan execution quota.** 2026-08-14 lost both the 05:00 backup (17177)
  and the 01:00 dispatch (17009) to `Execution limit reached`. No workflow change
  can fix that.
- **`executionTimeout` is 1800s** while `Await Approval` waits up to 3 days.
  Long waits have survived (19860 waited 6h22m), but execution 9216 was canceled
  at 29m52s and 10236 at exactly 3 days; worth confirming the interaction.
- **`Find Sendable Offers` still carries a stray `id: "recmYc4k0uBZDwhWs"`**
  parameter, ignored by the `search` operation — a leftover from the
  hardcoded-record era. Harmless, but delete it.
