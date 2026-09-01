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
