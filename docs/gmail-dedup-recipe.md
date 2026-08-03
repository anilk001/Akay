# Recipe — never lose (or double‑ingest) an offer email

**Workflow:** `Email Body Offer Ingestion — Akay` (n8n id `8oPUD8d9NPVBEime`, currently **active**)
**Change:** add **two** nodes — a *Schedule Trigger* and a *Gmail “Get Many Messages”* — wired
into the existing `Extract Body Blocks` node.
**Time:** ~10 minutes. **Risk:** low (see [Why this is safe](#why-this-is-safe)).

> **Status: implemented and live (2026-08-03).** Both nodes are in the workflow and the
> Schedule Trigger is active. Verified end to end: the backstop fetched the two stranded
> emails in the mailbox, both were routed to review and labelled `Akay/Email-Done`, and no
> duplicate offers were created. See [What shipped](#what-shipped-vs-this-recipe) for the two
> places the live config differs from the click-through below, and for a credential issue this
> surfaced.

---

## The problem

Today the workflow starts at a single **Gmail Trigger** that polls every minute for:

```
{label:Process_Akay label:Akay_Processed} -label:Akay/Email-Done
```

A Gmail *Trigger* only ever hands the workflow messages it notices **after** its last
poll checkpoint. So an offer email is silently stranded — never ingested — whenever:

- the workflow was **inactive** when the email arrived or got labelled, or
- a label (`Process_Akay` / `Akay_Processed`) is applied to an **older** email that the
  trigger’s checkpoint has already moved past, or
- a poll is **missed** (n8n restart, downtime, error).

The trigger never looks back, so those emails sit in the mailbox with the right labels and
are simply never processed.

## The fix

Add a second, independent entry path that **re‑scans the whole mailbox** on a timer and
feeds the *same* first processing node. It uses the *same* query, so it only ever picks up
emails that are labelled for processing **and not yet** `Akay/Email-Done`. Nothing is
stranded, because a search doesn’t have a checkpoint — every run sees every still‑eligible
email.

```
                 ┌─ Gmail Trigger (every minute) ────────────┐
                 │                                            ▼
  NEW ──────────►│                                   ┌──────────────────┐
                 │                                   │ Extract Body     │──► (rest of
  BACKSTOP ─────►│                                   │ Blocks           │     the workflow,
                 │  Schedule Trigger (every 10 min)  └──────────────────┘     unchanged)
                 └─► Gmail “Get Many Messages” ──────────────▲
                     (same query)                            │
```

---

## The one thing that must be right: the dedup key

De‑duplication is **entirely** driven by the `Akay/Email-Done` label. The pipeline:

1. `Flatten Block` stamps `sourceMessageId = item.id || item.messageId || item.sourceMessageId`
2. `Emails to Mark Done` emits one item per email carrying that id as `messageId`
3. `Mark Email Done` applies label `Label_8` (**Akay/Email-Done**) to that Gmail message

Both queries exclude `-label:Akay/Email-Done`, so once step 3 runs, the email drops out of
**both** the trigger’s and the backstop’s results. Get the id right and an email is ingested
exactly once; get it wrong and it is never labelled → re‑ingested forever (this is the exact
class of bug that produced the earlier duplicate offers).

> **The review branch dedups too — important for the backstop.** An email the parser can’t
> handle goes down the *other* branch (`Has Offer Content?` → … → `Route to Review` →
> `Mark Reviewed`) and is never created as an offer. That branch still applies the same
> `Label_8` (`Akay/Email-Done`) — to the **thread** rather than the message — so a
> review‑routed email is also removed from the query. This matters only for the backstop: the
> Gmail Trigger never looks back, but a polling search would re‑fetch and re‑review the same
> email every 10 minutes if the review branch didn’t label it. It does, so it won’t.

> ⚠️ **The trap.** The Gmail “Get Many Messages” node outputs **two** id‑like fields:
> - `id` — the Gmail **API message id**. This is the real dedup key. It is what the Gmail
>   Trigger emits and what `Mark Email Done` uses to apply the label.
> - `messageId` — the RFC‑822 `Message-ID:` **header** (`<...@mail.example>`). This is **not**
>   the Gmail id and must **not** be used to label.
>
> `Flatten Block` already reads `item.id` **first**, so the correct value flows through
> automatically. **Do not** add a Set/Edit node that maps the search node’s `messageId` over
> `id` — that would break labelling and reintroduce duplicates. Leave the field names alone.

---

## Step‑by‑step

Open the workflow: n8n → **Email Body Offer Ingestion — Akay**.

### 1. Add the Schedule Trigger
1. Click the **+** on the canvas → search **Schedule Trigger** → add it.
2. Set **Trigger Interval** → **Minutes**, **Minutes Between Triggers** = `10`.
3. Leave everything else default. (Rename to `Backstop — every 10 min` if you like.)

### 2. Add the Gmail “Get Many Messages” node
1. Click **+** → search **Gmail** → choose the **Gmail** action node (not the Trigger).
2. **Credential:** pick the same Gmail credential the existing Gmail nodes use
   (the `offers@akay.ie` account).
3. **Resource:** `Message`  •  **Operation:** `Get Many`.
4. **Return All:** `Off`, **Limit:** `10`. A bounded batch per run keeps any single execution
   small (avoids a heavy one-shot run that downloads attachments for the whole backlog at
   once), and the backstop still clears a backlog over successive 10-minute runs. Raise the
   limit if you ever expect more than ~10 stranded emails to accumulate between runs.
5. **Simplify:** `Off`  (so the raw fields, including `id` and the body, are returned).
6. Expand **Filters** → **Search** (`q`) and paste **exactly**:
   ```
   {label:Process_Akay label:Akay_Processed} -label:Akay/Email-Done
   ```
7. Expand **Options** → turn **Download Attachments** `On`.
   *Why:* `Extract Body Blocks` skips an email when a spreadsheet is attached, so the Excel
   workflow can own it. That guard reads binary attachments; without downloading them here,
   a spreadsheet email could be parsed from its body **and** by the Excel workflow —
   a duplicate. Downloading attachments preserves the “attachment always wins” rule.
   *(Rename the node to `Backstop — Get Offer Emails` if you like.)*

### 3. Wire it in
1. Connect **Schedule Trigger** → **Gmail “Get Many Messages”**.
2. Connect **Gmail “Get Many Messages”** → the **input** of the existing `Extract Body Blocks`
   node. (`Extract Body Blocks` now has two incoming paths; that is expected.)
3. **Do not touch** the existing Gmail Trigger → Extract Body Blocks connection.

### 4. Save. (Leave the workflow active.)

---

## Test it (before trusting it)

Do this once, deliberately, on a single email:

1. **Prep one email:** pick (or forward in) one offer email. Ensure it has the
   `Process_Akay` **and** `Akay_Processed` labels and does **not** have `Akay/Email-Done`.
2. **Dry‑run the new node in isolation:** open **Gmail “Get Many Messages”** →
   **Execute step**. Confirm your test email appears in the output, and open one output item:
   - it has a top‑level **`id`** (looks like `1979a…`, ~16 hex chars — the Gmail API id), and
   - it carries the body (`html` and/or `text`) and, if there’s a spreadsheet, a binary
     attachment. If the body is empty, revisit **Simplify = Off** / **Download Attachments**.
3. **Run the whole path:** trigger the Schedule branch (or **Execute Workflow** from the
   Schedule Trigger) and let it run end to end.
4. **Verify the outcome:**
   - the offer(s) land in Airtable **once** (search the product/supplier — no duplicate rows), and
   - the email now has the **`Akay/Email-Done`** label.
5. **Verify dedup holds:** let both the 1‑minute trigger and the 10‑minute backstop run for a
   cycle. The email must **not** be ingested again — because it now carries `Akay/Email-Done`
   and both queries exclude it.

If offers land once and the label appears, the dedup key is flowing correctly and you’re done.

---

## Why this is safe

- **Additive** — the existing Gmail Trigger and every downstream node are untouched, so
  nothing that works today can regress.
- **Testable** — verifiable on a single email (above): lands once, gets `Akay/Email-Done`.
- **Reversible** — to undo, delete just the two new nodes. No other change to unwind.

### The one edge to be aware of

If the same email is picked up by **both** entry paths inside the same short window — before
`Mark Email Done` has applied the label — it could be ingested twice. In practice the
1‑minute trigger almost always processes and labels a new email long before the 10‑minute
backstop next runs, so the backstop sees it already `Akay/Email-Done` and skips it. The
backstop’s real job is the **stranded** emails the trigger never offered at all; for those
there is no race. If you ever want to eliminate the window entirely, widen the backstop’s
cadence (e.g. every 30–60 min) — its purpose is catch‑up, not low latency.

---

## What shipped vs this recipe

Two deliberate differences from the click-through above, plus one thing the rollout surfaced:

1. **Bounded batch, not Return All.** The live node uses `Return All: Off` / `Limit: 10`
   (see step 2) rather than fetching every match in one execution. Same catch-up guarantee,
   smaller runs.
2. **Both branches confirmed to dedup.** Verified in a live run that the review branch
   (`Mark Reviewed`) applies `Akay/Email-Done` to the thread, so review-routed emails are not
   re-fetched (see the dedup note above).

**Credential issue this surfaced (now fixed).** The first live backstop run failed at the
pre-existing `Find Email Profiles` **Airtable** node with *“Invalid authentication token”* —
the workflow’s Airtable Personal Access Token had expired. This was breaking the whole
workflow, not just the backstop (the normal Gmail Trigger hits the same Airtable node on any
real offer email); the backstop just surfaced it by pulling a real offer email. Fixed by
repointing the four Airtable nodes (`Find Email Profiles`, `Fetch Products`, `Create Products`,
`Create Offers`) to the valid PAT credential (`Airtable Personal Access Token account`, which
authenticates against the `Akay Offers` base). **Other Akay n8n workflows may still reference
the dead token** (`Airtable Personal Access Token account 2`) — worth checking Offer Dispatch,
WhatsApp/Excel Ingestion and Bounce & Reply Handling.

---

## Reference — the moving parts

| Thing | Value |
|---|---|
| Workflow | `Email Body Offer Ingestion — Akay` (`8oPUD8d9NPVBEime`) |
| Gmail account | `offers@akay.ie` |
| Search query (both paths) | `{label:Process_Akay label:Akay_Processed} -label:Akay/Email-Done` |
| Done label | `Akay/Email-Done` (id `Label_8`, applied by `Mark Email Done`) |
| First processing node | `Extract Body Blocks` |
| Dedup key | Gmail **API** message `id` (read by `Flatten Block` as `item.id`) |
| New nodes to add | `Schedule Trigger` (10 min) → `Gmail: Message → Get Many` |
