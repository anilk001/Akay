# Revert snapshot — "Compose Email" node, Offer Dispatch — Akay

**This is not a source of truth.** The source of truth for this node is
`.claude/skills/offer-dispatch/n8n/compose-email.js` in the offer-dispatch repo,
which was not attached to the session that made this change. These two files are
kept only so the edit below can be reverted exactly, and back-ported, later.

Workflow: `dAYMAj6mZD3hTV4T` (`Offer Dispatch — Akay`), node **Compose Email**.

| File | What it is |
|---|---|
| `compose-email.pre-2026-09-01.js` | The node's code **before** the 2026-09-01 edit. This is the revert target. |
| `compose-email.2026-09-01-quantity-removed.js` | The code **currently live** in the node as of 2026-09-01. |

## What changed on 2026-09-01

Requested by Anil for the `SPIRITS-SG-2026-09-01` dispatch (128 lines, ex Singapore):

1. **`Quantity:` line removed** from every product block. `Stock Display` is a
   formula that never returns empty — it yields "Enquire for availability" when
   `Stock Cases` is blank — so the line printed on every offer whether or not a
   real quantity was known. `Availability` and `Stock Display` are untouched in
   Airtable; only the mail stopped printing them.
2. **Shared lead time hoisted.** When every member of a dispatch group carries
   the same non-empty `Lead Time`, it is printed once directly under the intro
   line and suppressed from each product block. With mixed or missing lead times
   the previous per-product behaviour is unchanged.

## Also changed 2026-09-01: `Style as HTML` onError

Separate from the code edits above, the **`Style as HTML`** node was switched
from the default stop-on-error to `onError: continueRegularOutput`.

It had been stopping the entire dispatch when the model call failed — which is
exactly what `Verify HTML` says must never happen:

> ANY failure drops the HTML and the dispatch continues text-only. A styling
> fault must never stop a send that has already passed gate, backup and leak
> checks.

`Verify HTML` already handles an `r.error` input by calling `fail()`, returning
`html: null` and an `htmlStatus` describing the fallback, and `Build Sends`
already omits the `html` key cleanly and always sends a complete plain-text
body. The setting was simply never configured to let that path run.

Triggered by execution 29332 dying on Anthropic credit exhaustion and blocking
the `SPIRITS-SG-2026-09-01` dispatch. **This one is not slated for revert** —
it restores the documented intent. Note the side effect: while the Anthropic
credential has no credit, every dispatch now goes out as plain text rather than
failing loudly, so a silent loss of HTML styling is the new failure mode. Watch
`htmlStatus` in the approval mail.

## Pending revert

**Anil asked for change (1) — and only (1) — to be reverted after the
`SPIRITS-SG-2026-09-01` send completes.** Change (2) was not asked to be
reverted; it is data-driven and only fires when a group's lead times agree.

To revert just the quantity line, restore these two lines in the
`productBlocks` map, in place of the four-line comment that replaced them:

```js
    const avail = v.AVAILABILITY || v.STOCK_DISPLAY;
    if (avail) lines.push(`Quantity: ${avail}`);
```

Do not wholesale-restore `compose-email.pre-2026-09-01.js` unless change (2) is
also meant to go — that file predates both edits.

## Testing note

`test-nodes.cjs` from the offer-dispatch repo could **not** be run against this
edit, because that repo was not available. The change was verified only by a
local harness covering three cases: all members sharing a lead time, mixed lead
times, and no lead time at all. Re-run the real suite when back-porting.
