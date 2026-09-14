# Instant Quote Intake — quote.akay.ie

n8n workflow `pXGfSBEn5ZdOT4nt` · webhook **`POST https://akay-team.app.n8n.cloud/webhook/instant-quote`**

Every buying list uploaded to the Trade Desk ends up as one **Enquiries** record
in Airtable — the buyer's own file and the priced copy attached to it, linked to
the **Client** — and ak@akay.ie gets the priced file by email.

Before this existed, an Instant Quote left no trace: the buyer downloaded their
prices and the desk never knew the enquiry happened.

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

  "lines": [                         // optional, for the readable summary
    { "description": "Jameson 70cl", "matched": "Jameson 6x70cl", "qty": 50, "price": "17.95 EUR/btl" }
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
| `../tests/instant-quote-intake.test.js` | Runs that file against real payload shapes (`npm test`) |

Airtable ids the workflow writes to: base `appaDSdZkAE9PGkjT`, Enquiries
`tblgZUj1JeGyHXmcx` (`Inquiry File` = `fld8MfwuuY7DDB4d0`, `Quoted File` =
`flddhG2BquXE5wuEA`), Clients `tblcWMfGioSXtZZzl`.
