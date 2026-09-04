# WhatsApp Offer Broadcast — Akay

n8n workflow `BeGfFpgxmI7hdCTI` (`WhatsApp Offer Broadcast — Akay`). Created and
published 2026-09-04.

> **BLOCKED 2026-09-04 — Whapi token is stale.** Every Whapi API call from n8n
> (this workflow AND the nightly Contact Sync's `Whapi Contacts` fetch, silently
> failing since at least 2026-09-02) returns `404 {"error":"Channel not found"}`,
> while inbound webhooks from channel `SPDRMN-ED3CX` still arrive — so the
> channel is alive but the token stored in the n8n **"Bearer Auth account"**
> credential no longer matches it (rotated in the Whapi dashboard, new value
> never saved to n8n). Fix: copy the current channel token from the Whapi
> dashboard into the "Bearer Auth account" credential. The next scheduled run
> then delivers the PILOT cards to Anil's own WhatsApp automatically; every run
> until then emails a failure summary to ak@akay.ie. The 2026-09-04 pilot run
> proved everything else end-to-end: 14 segment cards planned, composed and
> pushed to Whapi — only the sends 404'd on the token.

Broadcasts branded **image offer cards** to the WhatsApp client lists via
[Whapi Cloud](https://whapi.cloud), in the style of the competitor ads (clean
card: product, spec, price, stock, terms, CTA). The WhatsApp counterpart of the
Resend email dispatch flows — same Offers table as the single source of truth,
different transport.

## Schedule

Mon & Thu 10:30 Europe/Dublin. Errors route to the central
`ERROR HANDLER — Akay Alerts` workflow. A summary email goes to `ak@akay.ie`
after every run that sends anything; a run with nothing to send stays silent.

## How a run works

1. **Fetch Offers** — Airtable Offers where `Send Eligible = Yes` (the same
   four-condition dispatch gate as email: Live, not expired, not Do Not
   Broadcast, approved).
2. **Fetch WA Contacts** — Contacts with `On WhatsApp`, a `WhatsApp Chat ID`
   and at least one `WhatsApp Segment` (the field that mirrors the manual
   broadcast lists, auto-tagged 2026-09-02).
3. **Plan Broadcast** (Code) — for each **client** segment, in
   most-specific-first priority order, scores the eligible offers and picks the
   top one plus up to 3 "Also live" caption lines. See
   [`plan-broadcast.js`](plan-broadcast.js) for the full rules. Highlights:
   - **Supplier segments are never broadcast to** (`Spirits suppliers`,
     `EU spirits suppliers`, `Beer suppliers`, `FMCG Supplier`) — they are the
     people we buy from.
   - **One message per contact per run.** A contact carrying several segments
     gets only the most specific segment's card.
   - **45-day offer×segment cooldown**, read from `Offers.WA Broadcast Log`
     (lines of `Segment Name|YYYY-MM-DD`, written by this workflow, pruned at
     120 days).
   - Offer `Target Countries` / `Excluded Countries` are applied against the
     contact `Country` with the same asymmetry as email dispatch: an
     include-list excludes blank-country contacts, the exclude-list never does.
   - Group chat IDs (`@g.us`) are skipped — individuals only.
   - Hard cap `MAX_SENDS_PER_RUN = 450` (instance execution timeout is 2400 s
     and sends are paced at 3 s).
4. **Card composition** — no external design service. The Edit Image node
   builds a 1080×1080 card from scratch: cream `#F7F5F0` ground, red `#B4231F`
   accent bar, dark-green `#13201A` footer band, the live site logo composited
   from `https://offers.akay.ie/akay-bird.png`, then the offer text (badge,
   product, spec, price in red, stock in green, terms, CTA footer).
5. **Send loop** — one Whapi `POST /messages/image` per recipient (base64
   media + caption), paced 3 s apart, `continueRegularOutput` so one bad
   number cannot kill the run.
6. **Build Results** — matches every send result back to its recipient,
   updates `Offers.WA Broadcast Log` (only for segments with ≥1 delivered
   send, never in pilot), and emails the per-segment summary via Resend.

## PILOT mode — currently ON

`PILOT = true` at the top of the *Plan Broadcast* node. While on:

- every planned card is sent **only to Anil's own WhatsApp**
  (`353872382368@s.whatsapp.net`), one per segment, with the real audience
  size stated in the caption;
- **nothing** is written to `WA Broadcast Log`.

To go live: open the workflow, edit *Plan Broadcast*, set `PILOT = false`,
save and publish. Everything else is already wired.

## Segment → offer mapping

| Segment | Offer categories | Extra filter |
|---|---|---|
| Cognac clients | Spirits | name matches cognac/brandy/known houses |
| Clients dubai spirits, Israel spirits, Spirits Clients Far East, EU Spirits Clients, Spirits clients | Spirits, Champagne | — |
| Duty Free | Spirits, Champagne, Beer, Confectionery | — |
| Confectionery outside eu | Confectionery | — |
| Israel FMCG, FMCG Saudi, FMCG EU, FMCG NON EU | Grocery, Confectionery, Toiletries, Soft Drinks, Other FMCG | — |
| Russia Clients | any | — |
| Beers | Beer | — |

Scoring: freshness (≤3 d +30 … >60 d −10), Featured +40, Is Cheapest +25,
Cheaper By 5%+ +15, stock known +5.

## Airtable field added

`Offers.WA Broadcast Log` (`fldvyN27IGOxXU94V`, multiline text) — the
offer×segment dedupe log described above. Written only by this workflow.

## Files

| File | Node | State |
|---|---|---|
| `plan-broadcast.js` | Plan Broadcast | full source, published 2026-09-04 |
| `build-results.js` | Build Results | full source, published 2026-09-04 |

As everywhere in `n8n/`: **this directory is a mirror, not the running
system** — editing here changes nothing until pasted into the node and the
workflow is published.
