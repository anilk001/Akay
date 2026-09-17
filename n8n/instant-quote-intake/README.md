# Instant Quote Intake — quote.akay.ie

n8n workflow `pXGfSBEn5ZdOT4nt` · webhook **`POST https://akay-team.app.n8n.cloud/webhook/instant-quote`**

Every buying list uploaded to the Trade Desk ends up as one **Enquiries** record
in Airtable — the buyer's own file and the priced copy attached to it, linked to
the **Client** — ak@akay.ie gets the priced file by email, and **every line we
could not price becomes a `Wanted` row**.

Before this existed, an Instant Quote left no trace: the buyer downloaded their
prices and the desk never knew the enquiry happened.

The unpriced lines are the valuable half. A line that matched earned us a quote;
a line that did not is a customer telling us what to stock, with their name on
it. Routing them into `Wanted` puts them in front of the existing **Wanted
Matcher — Akay** workflow, so when the stock arrives the buyer who asked is
already attached to it, and into the Monday buying brief
(`../unmatched-demand-digest/`).

## What it does with one upload

1. **Validates** the payload. A missing file is the only fatal error — both
   halves of the job need it. A missing *email* is not: an unattributable
   buying list is still a buying signal, so it is logged with no client link
   rather than thrown away.
2. **Finds the Client** by email (`LOWER({Email})`), and **creates one** if this
   is a first contact — `Status: Pending Review`, `Preferred Channel: Email`,
   with a note saying it came from an Instant Quote upload. Nothing is ever
   overwritten on an existing client record.
3. **Creates the Enquiry**, linked to that Client: `Channel: Instant Quote`,
   `Status: New`, id `IQ-<yyyyLLdd-HHmmss>`, with the line summary, the quoted
   total, the contact details and the raw payload (minus the file blobs) in
   `Enquiry Notes` / `Raw Message`.
4. **Attaches both files** to that record — `Inquiry File` is what the buyer
   sent, `Quoted File` is what they downloaded.
5. **Emails ak@akay.ie** with the priced file attached, `Reply-To` set to the
   buyer, and a link to the Airtable record.
6. **Writes one `Wanted` row per unpriced line**, linked to the same Enquiry and
   Client: `Status: Open`, `Source: Enquiry`, `Claude Review Status: Pending
   Review`, with the brand, size, quantity, bond status and the buyer's own
   target price parsed out of the line. An upload where everything priced writes
   nothing — that is the good case, not an error.

An upload with no priced file still logs and still emails — it just says so.

## What the Trade Desk API must send

One POST, after it has priced the list. Everything is optional except `file`.

```jsonc
{
  "email":    "buyer@example.com",   // links the enquiry to a Client
  "name":     "Jane Buyer",
  "company":  "Buyer Wholesale Ltd", // names the record when present
  "phone":    "+353871234567",
  "country":  "Ireland",
  "note":     "free text the buyer typed",

  "fileName": "their-list.xlsx",     // the buyer's upload, as received
  "fileType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "file":     "<base64>",            // REQUIRED

  "quotedFileName": "their-list-priced.xlsx",
  "quotedFileType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "quotedFile":     "<base64>",      // the file they downloaded

  "lines": [
    // `matched` is what makes a line a quote. A line WITHOUT it is what makes
    // this workflow worth having — see "The unpriced lines" below.
    { "description": "Jameson 70cl", "matched": "Jameson 6x70cl", "qty": 50, "price": "17.95 EUR/btl" },
    // Unpriced. `target` (or `targetPrice`, or `cost`) is the buyer's own
    // figure from their file, and it is what turns "they want this" into
    // "they want this at €22.50" — send it whenever the column exists.
    { "description": "Johnnie Walker Black 12 x 70cl T1", "qty": 20, "target": "22.50 EUR" }
  ],
  "summary": { "lineCount": 2, "matchedCount": 2, "total": 1023.5, "currency": "EUR" },

  "company_website": ""              // honeypot: must stay empty
}
```

Replies `{ ok: true, enquiryId, recordId }` on 200, `{ ok: false, error }` on 400.

Two limits worth knowing: Airtable refuses an attachment over **5 MB**, so a
file above that is skipped and the enquiry says so rather than pretending a copy
was kept; and base64 is about 4/3 of the raw bytes, so budget accordingly.

The call is server-to-server, so a failure must never block the buyer's
download — fire it after the file has been handed over, and log rather than
raise if it fails.

## The unpriced lines

A line with no `matched` value becomes a `Wanted` row. The parsing happens in
`validate-and-compose.js` — the only place the payload is interpreted — and
everything it reads comes out of the line's own text:

| Wanted column | Where it comes from |
| --- | --- |
| `Brand` | `line.brand`, or the words before the first number: "Johnnie Walker Black 12 x 70cl" → "Johnnie Walker Black" |
| `Product Name` / `Variant` | the line as written, and what is left after the brand |
| `Volume ML` | the first size in the line — `70cl`, `0.7L` and `700ml` all become `700`, which is what lets the digest group them |
| `Category` | inferred from a product word (`vodka` → Spirits). Omitted when nothing gives it away |
| `Qty` / `Qty Unit` | `line.qty`, and the unit from the buyer's own wording (`pallets` → Pallets) |
| `Target Price` / `Currency` | `line.target`, `line.targetPrice` or `line.cost` |
| `Bond/Customs Status` | `T1`, `T2`, `bonded`, `duty paid` in the text |

Two rules keep a bad line from costing the whole upload:

- **Every select value is a real option or nothing.** Airtable rejects the
  *whole batch* on one unknown value, and this repo writes with typecast off on
  purpose, so `extract-wanted-lines.js` deletes an unresolved key rather than
  sending an empty string. A `Wanted` row with no Category takes five seconds to
  fix; a failed batch loses every line in the upload.
- **A guessed brand arrives marked.** `Claude Review Status: Pending Review` is
  the existing column for exactly that, so nothing guessed is presented as fact.

`Wanted.Source` has no "Instant Quote" option today (the choices are Enquiry,
Digest Link, WhatsApp, Email, Manual), so rows are written as `Enquiry` — true,
they arrive through one — and the origin is stamped into `Trader Notes`, which
is what the weekly digest counts. Add the option in Airtable and change
`WANTED_SOURCE` in `extract-wanted-lines.js`; nothing else needs touching.

## Still to do outside this repo

The Trade Desk asks buyers for nothing today, so `email`, `name` and `company`
have nowhere to come from yet. Two changes are needed in the Trade Desk's own
source (which is not in this repo — the API is a `railway up` deploy of
`trade-desk-api`, the client a Vite build):

- **The SPA** must collect the contact details — the open question is whether it
  asks before pricing or at the download, which is a conversion decision, not a
  technical one. This workflow handles either.
- **The API** must make the POST above from its upload handler, where it already
  holds both files.

## Files here

| File | What it is |
| --- | --- |
| `validate-and-compose.js` | Mirror of the workflow's "Validate & Compose" Code node — the only place the payload is interpreted |
| `extract-wanted-lines.js` | Mirror of "Extract Wanted Lines" — fans the unpriced lines out into one item per `Wanted` row. Sits after Create Enquiry; feeds an Airtable create node with fields mapped **explicitly**, never auto-mapped |
| `../tests/instant-quote-intake.test.js` | Runs both files against real payload shapes (`npm test`) |

Airtable ids the workflow writes to: base `appaDSdZkAE9PGkjT`, Enquiries
`tblgZUj1JeGyHXmcx` (`Inquiry File` = `fld8MfwuuY7DDB4d0`, `Quoted File` =
`flddhG2BquXE5wuEA`), Clients `tblcWMfGioSXtZZzl`, Wanted `tblWZnoQHC2E6tYPd`
(schema read 2026-09-17).
