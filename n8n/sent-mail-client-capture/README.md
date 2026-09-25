# Sent Mail → Client Capture — Akay

n8n workflow `EILYbFqzEXVUsM8Z` · every 15 minutes (Europe/Dublin) · **ships in DRY_RUN**

When Anil emails someone new from **ak@akay.ie**, that person should be in
**Clients**, filed under what they buy, without anyone typing them in. Before
this existed, a buyer met by email only reached the base if they later sent an
enquiry, so offers to their category never went to them.

## What one run does

1. **Sent Mail** — Gmail, `in:sent newer_than:2d`, up to 150 messages, full
   bodies (`simple: false`). The 2-day window overlaps every run on purpose: a
   run that fails is caught by the next one. Nothing is written for anyone who
   is already a Client, so re-reading a message costs nothing.
2. **Clients Keys / Contacts Keys / Supplier Emails** — every email the base
   already knows.
3. **Pick New Recipients** (`pick-new-recipients.js`) — keeps each To/Cc/Bcc
   recipient who is not:
   - already a Client, or a Contact linked to one (case-insensitive)
   - on a Supplier's domain (free-mail domains excepted)
   - `@akay.ie`, a no-reply mailbox, or a service domain (Airtable, GitHub …)
   - one of more than 10 recipients on the message — that is a broadcast

   and reads the categories from the subject, attachment names (both 3x) and
   body. Anil's sign-off is cut before scoring so a signature can't tag
   everyone with everything; the client's quoted text below it is kept.
4. **Find Archive Matches** — one `OR()` over just the new addresses in
   *Clients — Capsule Archive*.
5. **Build Client Creates** (`build-client-creates.js`) — archive rows marked
   **Do Not Contact are refused** (an email from Anil does not undo an opt-out,
   and a Clients row would put them back in the offer sends). Other archive rows
   are promoted with their name, phone, country and tags.
6. **Airtable POST new Clients** (10 per request, typecast off), then **Build
   Archive Stamps** / **Airtable PATCH Archive** / **Mirror Promotion To
   Postgres** mark promoted archive rows, as the Enquiry → Client Linker does.

## What a new Client looks like

| Field | Value |
| --- | --- |
| Client Name | the display name on the email, else the address |
| Email | lower-cased |
| Status | `Pending Review` |
| Preferred Channel | `Email` |
| Last Contact Date | the date the mail was sent |
| Country | from a country-code domain only (`.de` → Germany); `.com` sets nothing |
| Interest Categories | Spirits / Beer / Wine / Grocery / Confectionery / Toiletries / Soft Drinks / Other FMCG |
| Capsule Tags | the matching `Indv …` tag — **this is what the offer sends select on** |
| Buying Notes | which email created it and which words chose the categories |

Interest Categories alone would not be enough: the one-off offer sends filter
on Capsule Tags (`Indv spirits`, `Indv beers`, `Indv groceries` …), so the
workflow writes both.

| Category | Capsule Tag |
| --- | --- |
| Spirits | Indv spirits |
| Beer | Indv beers |
| Wine | Indv wines |
| Grocery | Indv groceries |
| Confectionery | Indv Confectionery |
| Toiletries | Indv toiletries |
| Soft Drinks | Indv beverages |
| Other FMCG (perfume, cosmetics) | Indv perfumes & cosmetics |

A category is kept when it scores at least a third of the strongest, so a
45-line spirits list that mentions Guinness once stays spirits-only. **When
nothing matches, no category is written.** The note asks a person to set it.
A blank field takes seconds to fill. A wrong one quietly mis-targets every offer
after it.

`Pending Review` clients are **not** excluded by the offer sends (they skip
only Inactive and Blacklisted), so a new client starts getting their category's
offers straight away. Set them Inactive to stop that.

## Going live

1. Read the dry-run output of **Build Client Creates**. `wouldCreate` is exactly
   what would be posted. Check the categories and that no supplier slipped
   through. If a supplier did, add their email to Suppliers; their whole domain
   is excluded from then on.
2. Set `DRY_RUN = false` in **Build Client Creates**, here and in the node.
3. **Publish** the workflow. A draft in n8n does nothing (see `../README.md`).

## Tuning

The keyword lists, service domains and recipient cap are constants at the top
of `pick-new-recipients.js`. Change them here first, run
`node n8n/tests/sent-mail-client-capture.test.js`, then paste the file into the
node.
