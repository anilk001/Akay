---
name: email-campaign
description: Send a campaign to AKAY's trade buyers through Resend, with the audience built from the Clients table in Airtable. Use when asked to email an offer, a launch, a price list or a newsletter to clients, to a tag ("Indv spirits", "Indv beers", "T1 Spirits"), to a region, or to "all our clients". Covers how the audience is defined, the two Resend routes and which to pick, the mail-merge greeting rules, the account's real limits, and the pre-send checks.
---

# Sending a campaign

Audience lives in **Airtable**, sending lives in **Resend**. Nothing about a
campaign is stored in this repo except the email itself.

The single most common mistake is picking the wrong Resend route and getting
blocked mid-campaign, so read **Which route** before building anything.

## 1. The audience

Base `appaDSdZkAE9PGkjT`, table **Clients** `tblcWMfGioSXtZZzl`.

### Always apply these four

| Condition | Field |
| --- | --- |
| Email is not empty | `fldrwja49HWX2Hpcp` |
| `Do Not Contact` unticked | `fldNJH70JR7IL79tI` = `false` |
| Status is not **Blacklisted** | `fldf0W3JzTQdnBkrm` ≠ `sel9MZ7BegYGyrT4l` |
| Tags does NOT contain **No Mailing** | `fldY5g8JjdyutW7yM` ≠ `sel1hlPW3A5kVblxV` |

Then add whatever the campaign is about.

### Who to send to: use the Tags capsules

`Tags` (`fldY5g8JjdyutW7yM`) is the field that decides. The **`Indv …`**
capsules are the mailing lists — `Indv spirits` (`sel1R6aHOsreH7lbW`),
`Indv beers`, `Indv wines`, `Indv cognac`, `Indv champagne`, `Indv Cigars`,
`Indv groceries`, `Indv toiletries`, and so on.

**Do not use the `Interest Categories` field** (`fldkRtDpcQPY7XhbL`) for this.
It is a much looser "what do they buy" marker and produces a different, larger
audience. When someone says "Indv Spirits" they mean the capsule.

Beware the near-neighbours in the same field: a lowercase `spirits` capsule
also exists, along with `T1 Spirits`, `Spirits T2 ONLY`, `VIP Spirits`,
`Cash Buyers Spirits`. On 2026-09-17, EU + consent filters gave:

- `Indv spirits` alone → **327**
- lowercase `spirits` alone → 27
- all ten spirits capsules combined → 353

So the `Indv …` capsule carries the audience on its own. Widening rarely earns
its risk of mailing someone the wrong offer.

### Region: use the formula field, never a country list

`fldEFltRodl046nMe` is a formula over the free-text `Country` field. It returns
exactly one of **`EU`**, **`UK`**, **`Switzerland`**, **`Russia`**, **`Other`**.
Filter on it with `=` or `!=`.

It knows all 27 member states and folds "Holland" and "The Netherlands" into
Netherlands. Writing your own country list in code will silently drop those.

**Country is free text and is blank on roughly a third of the table.** A client
in Spain with an empty Country lands in `Other`, not `EU`. That is the single
biggest gap in this data — filling those in is the highest-value cleanup
available, and every one fixed adds a recipient to the next regional send.

There is also a `Region` single-select (`fld01FonXKR5puusx`) with an EU option.
It is **unpopulated on every record sampled**. Prefer it only if it is ever
backfilled, because a human can correct it and the formula cannot.

### Russia

EU sanctions restrict spirits exports to Russia and Akay Irl Ltd is an Irish
company. Russia is therefore **not** included by default in a "rest of world"
send. Flag it, name the count, and let Anil decide — it is a compliance call
for the exporter, not a technical one. He has previously said to include them;
ask anyway, each time, and do not re-litigate once he answers.

## 2. Which route — read this before importing anything

Resend bills **sending** and **contacts** separately, and the account is on a
different tier for each:

| | Tier | Limit |
| --- | --- | --- |
| Sending | **Pro** | 50,000 emails/month, renews on the 27th |
| Contacts / Segments | paid as of 2026-09-17 (was Free: 1,000 / 3) | check before a big import |

Two ways to send, and they consume different things:

**Broadcast + segment** — imports every recipient as a stored contact.
- Managed unsubscribe (`{{{RESEND_UNSUBSCRIBE_URL}}}`) in the footer
- Per-campaign open and click tracking, split by UTM
- Bounced and complained addresses skipped automatically at send
- **Costs contacts quota permanently**

**Batch / transactional** (`send-batch-emails`) — one email per recipient.
- No contacts consumed, no contact limits
- No managed unsubscribe; you would hand-roll one
- No campaign dashboard, only individual log rows

**Default to broadcast for anything that is marketing.** The managed
unsubscribe matters for EU trade mail and for domain reputation, and the click
split is how you learn what worked. Historically the account used the batch
route, which is why the contacts limit was never hit before — if that limit is
tight, say so and get a decision before importing, rather than after.

**Contacts are reusable.** Someone already imported costs no new quota on the
next campaign, so the tier only bites when reaching genuinely new people.

## 3. The mail merge

`{{{FIRST_NAME|there}}}` in both the HTML and the text part, and
`{{{RESEND_UNSUBSCRIBE_URL}}}` in the footer.

**The Clients name field mixes people and businesses,** so only use a first
name when it is plainly a person's. On the 2026-09-17 send, 212 of 323 EU
records got a name and 399 of 920 rest-of-world did. That ratio is correct, not
a bug: *"Hi there," is never wrong, and "Hi Verkauf," is.*

Drop the greeting when the first token is:

- a department in any language on the list — Verkauf, Sprzedaz, Ventas,
  Vendite, Inkoop, Comercial, Comenzi, Kundeservice, Achat, Groep, sales, info,
  admin, office, purchasing, operations
- a legal form or trade word **anywhere** in the name — Ltd, Srl, BV, GmbH, AO,
  OOO, JSC, Group, Trading, Distribution, Import, Export, Stores, International
- a place name — "Cyprus Limassol Ship Store Ltd"
- the company's own domain — `Meridian <meridian@meridian.dk>`, or a domain
  the token is a prefix of — `Vantor <e.hermsen@vantorgroup.nl>`
- a title or particle — Engr, Mr, Sté, De
- longer than 11 characters, or containing a digit

On a list that is mostly personal mailboxes with no separate contact name
(typical outside the EU), add one more rule: **a one-word name that also
appears in the email's local part is a handle, not a greeting** —
`Jgarcia <jgarcia@example.com>`, `Mzqtrade <mzqtrade@example.com>`,
`Cognac <cognac@example.com>`. A name with a surname beside it is untouched,
so `Anna Novak <anna.novak@example.com>` keeps "Anna".

**Always print the final list of greeting names and read it** before importing.
Heuristics tuned on one list do not transfer to the next; every send so far has
needed a hand-reviewed blocklist on top. This is a five-minute check that stops
a thousand people being greeted as "Globaldrinksco".

## 4. Build and send

1. Query Airtable with the filters above. Large results are written to a file —
   process with `jq`/python, do not paste into context.
2. Build `email,first_name,country`, de-duplicated on a lowercased email.
3. `create-segment` — name it `<audience> — <campaign> <YYYY-MM-DD>`.
4. `create-contact-import` with `segmentIds`, `onConflict: "upsert"`, and
   `columnMap: { email, firstName: "first_name", properties: { country } }`.
   The `country` contact property already exists.
5. `get-contact-import` until `completed`. **Check `failed` is 0** and the
   total matches.
6. `create-broadcast` — from `Anil Khetan <offers@akay.ie>`, reply-to
   `offers@akay.ie`. Domain `akay.ie` is verified, eu-west-1, click tracking on.
7. Send one test to `anil@akay.ie` with `send-email`, merge fields filled in.
8. `send-broadcast`.
9. `list-broadcasts` to confirm it moves `queued` → `sent`.

## 5. Writing the email itself

`marketing/instant-quote-launch/` is the worked example — read its README
before writing a new one. The rules that carried:

- **Send both parts.** HTML-only is a spam signal and some buyers read plain text.
- 600px table layout, inline styles, one image, one button. It should read like
  a message from a person, not a newsletter.
- **Outlook shows frame one of a GIF and never animates it**, so frame one must
  carry the payoff, not the setup.
- Everything the image says goes in the `alt` text too — images are off by
  default for many recipients.
- Put UTM query strings **before** any `#fragment`. `quote.akay.ie/?utm…#excel`
  works; `#excel?utm…` makes the Trade Desk drop the buyer on the wrong tab.
- Give each link a different `utm_content` so GA4 shows which one did the work.
- Host images on `akay.ie`, not a third party.

## 6. Never commit the recipient list

A built audience is hundreds of named trade buyers with their email addresses.
This repo builds a public static site; that list has no business in its history,
where it survives every later deletion. Keep it in the scratchpad, hand it over
with `SendUserFile`, and commit only the query that rebuilds it.

The same goes for a hand-reviewed blocklist of mailbox handles — those are
customer mailboxes too. Document the rules, not the values.

## 7. After the send

- Opens and clicks appear per broadcast in the Resend dashboard, split by the
  UTM you set.
- Resend's suppression list is currently the **only** record of who bounced or
  complained. Airtable's `Suppression Reason`, `Suppression Date` and
  `Soft Bounce Count` fields exist and are unpopulated. Feeding Resend's
  bounces and unsubscribes back into them would make Airtable the source of
  truth for consent, which is where it belongs.
- Every segment created counts against the segments limit. Delete the ones you
  will not reuse.

## Reference — what went out on 2026-09-17

Instant Quote launch, tag `Indv spirits`, 1,299 recipients in two broadcasts:
**323 EU** (26 member states) and **976 rest of world** (69 countries,
including Russia at Anil's instruction). Subject *"Compare your current spirits
invoice in 60 seconds"*. 1,386 clients carry the tag with an email — the gap is
the blank-Country problem in §1.
