# Sending the launch email through Resend

Audience: **Indv Spirits, EU only** — 323 deduped addresses across 26 EU member
states. The list is NOT in this repo (see "Why the list is not committed"); it is
rebuilt from Airtable with the query below whenever it is needed.

## 1. The audience, exactly

Airtable base `appaDSdZkAE9PGkjT`, table **Clients** (`tblcWMfGioSXtZZzl`), all of:

| Condition | Field |
| --- | --- |
| Tags contains **Indv spirits** | `fldY5g8JjdyutW7yM` = `sel1R6aHOsreH7lbW` |
| Tags does NOT contain **No Mailing** | `fldY5g8JjdyutW7yM` ≠ `sel1hlPW3A5kVblxV` |
| Email is not empty | `fldrwja49HWX2Hpcp` |
| Region = **EU** | `fldEFltRodl046nMe` (the formula field that normalises free-text Country) |
| **Do Not Contact** unticked | `fldNJH70JR7IL79tI` = false |
| Status is not **Blacklisted** | `fldf0W3JzTQdnBkrm` ≠ `sel9MZ7BegYGyrT4l` |

That is 327 records → **323 after de-duplicating on email**.

Region comes from the base's own formula field, not from a hand-written country
list, so a client whose Country is later corrected moves in or out of this
audience on its own. It counts all 27 member states; Ireland (4) is in, and the
UK, Switzerland, Russia and everywhere else are out. The formula treats
"Holland" and "The Netherlands" as Netherlands, so those rows are not lost.

Country tally: Netherlands 51, Spain 47, Germany 28, Italy 25, Latvia 20,
France 17, Poland 17, Cyprus 13, Greece 13, Belgium 10, Czechia 10, Romania 8,
Sweden 8, Bulgaria 7, Denmark 7, Lithuania 7, Malta 5, Slovakia 5, Croatia 4,
Hungary 4, Ireland 4, Austria 3, Estonia 3, Luxembourg 3, Portugal 2,
Slovenia 2. Finland has no tagged spirits contact.

### The 1,386 vs 323 gap

1,386 clients carry the **Indv spirits** tag and an email address. The EU filter
is what takes it to 327 — the rest are China, Hong Kong, Singapore, Australia,
the UAE, the UK, Israel and India, plus a large block whose Country is blank.
**Country is free text and is missing on roughly a third of the table**, so a
client in Spain with an empty Country field is not in this send. Filling those
in is the single highest-value cleanup available on this table; every one fixed
adds a recipient to the next EU send for free.

## 2. Build the CSV

Export the query above from Airtable with **Client Name**, **Email** and
**Country**, then reduce it to three columns — `email,first_name,country` —
de-duplicated on a lowercased email, applying the first-name rules in §3.

The generator is kept out of this repo along with the list it produces: its
hand-reviewed exclusions are themselves a list of customer mailboxes. Ask Claude
to regenerate both; §1 and §3 are enough to reproduce it from scratch.

## 3. The merge

`email.resend.html` / `email.resend.txt` are the `email.html` / `email.txt`
files with Resend's own placeholders swapped in:

- `{{{FIRST_NAME|there}}}` — the greeting, falling back to "Hi there,"
- `{{{RESEND_UNSUBSCRIBE_URL}}}` — the managed unsubscribe link in the footer

**212 of the 323 get a real first name; 111 get "there".** That is deliberate.
The Airtable name field holds a mix of people and businesses, so a first name is
only used when it is plainly a person's: a token that is a department in any of
the languages on this list (Verkauf, Sprzedaz, Ventas, Inkoop, Comercial,
Kundeservice…), a legal form or trade word anywhere in the name (Ltd, Srl, BV,
GmbH, Trading, Distribution, Import), a place name (Cyprus Limassol Ship Store),
the company's own domain (Lago <lago@lago.dk>), or a mailbox handle
(Igarcia <igarcia@nuttra.com>) all fall back to "there". "Hi Verkauf," on a cold
B2B email costs more than "Hi there," saves.

## 4. Send it

Resend, domain **akay.ie** (verified, eu-west-1, click tracking on):

1. `create-segment` → "Indv Spirits — EU — Instant Quote launch 2026-09-17"
2. `create-contact-import` with `audience.csv`, that segment id,
   `columnMap: { email, firstName: "first_name", properties: { country } }`,
   `onConflict: "upsert"`
3. `get-contact-import` until `completed`; confirm the count is 323
4. `create-broadcast`
   - from: `Anil Khetan <offers@akay.ie>`
   - replyTo: `offers@akay.ie`
   - subject: `Compare your current spirits invoice in 60 seconds`
   - preview: `Upload the buying list you already keep — download it back with our price, and your saving, on every line.`
   - html / text: the two `email.resend.*` files
5. Send one test to `anil@akay.ie` first and open it on a phone
6. `send-broadcast`

Resend drops suppressed addresses (bounces, complaints, manual) at send time, so
the delivered count lands a little under 323 on its own — nothing to filter by
hand.

## Why the list is not committed

`audience.csv` is 323 named trade buyers with their email addresses. This repo
builds a public static site; a customer list has no business in its history,
where it survives every later deletion. It stays in the sending workflow.

## Before the next send

- **`Region` (single select) is empty on every record sampled.** The formula
  field covers for it today. If `Region` is ever backfilled, prefer it — it is
  editable, so a client can be placed in EU by hand when their Country is
  ambiguous.
- Airtable's consent fields — `Do Not Contact`, `Suppression Reason`,
  `Suppression Date`, `Soft Bounce Count` — exist but are unpopulated. Resend's
  own suppression list is currently the only record of who has bounced or
  complained. Feeding Resend's bounces and unsubscribes back into these fields
  would make Airtable the source of truth for consent, which is where it belongs.
