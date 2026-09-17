# Instant Quote launch email

A short text email whose one image is a play-button thumbnail of the Instant
Quote tool. The image links to **https://akay.ie/instant-quote/** — the landing
page where the walkthrough plays on its own, right beside the upload CTA.

| File | What it is |
| --- | --- |
| `email.html` | The HTML part. 600px, tables, inline styles, one image, one button. |
| `email.txt` | The plain-text part. Send both — a text/html-only send is a spam signal, and some buyers still read in plain text. |

Both carry `{{first_name}}` and `{{unsubscribe_url}}`; swap them for whatever
the sending tool uses before the send.

## The three links, and why they differ

| Where | Goes to | Why |
| --- | --- | --- |
| The image and the caption under it | `akay.ie/instant-quote/` | Someone who clicks a play button wants to *watch*, not to upload yet. The page starts the walkthrough on load with the CTA next to it. |
| The red button | `quote.akay.ie/…#excel` | Someone who clicks "Compare my list" is ready. Do not make them watch anything. |
| The signature | `akay.ie` | The catalogue. |

Every link carries `utm_campaign=instant-quote-launch` with a different
`utm_content`, so GA4 shows which of the three did the work. The query string
sits **before** the `#excel` fragment — after it, the Trade Desk reads the whole
thing as an unknown tab and drops the buyer on the chat tab instead.

## The images

Both live in `public/` and are served from akay.ie, so no third-party image
host is in the path:

| Asset | Size | Used by |
| --- | --- | --- |
| `instant-quote-preview.gif` | 600×338, ~100 KB, 5 frames | the email |
| `instant-quote-preview.png` | 1200×676, ~180 KB | the landing page's OG card, and the video poster once a recording exists |

**Frame one of the GIF is the finished, priced file** — Outlook shows frame one
and never animates, so the frame that has to carry the message is the payoff,
not the empty upload. Everything the image says is also in the `alt` text, for
the clients that block images by default.

They are generated, not hand-drawn. `preview-frame.html` is the composition;
`build-preview.mjs` screenshots it at five points with Playwright and encodes
the frames with `gifenc`:

```bash
npm i --no-save playwright gifenc && npx playwright install chromium
node marketing/instant-quote-launch/build-preview.mjs
```

Neither package is a project dependency — the catalogue build and the
five-minute refresh must not pull a browser down. Edit the HTML and re-run
rather than touching the PNG or GIF, and keep the filenames: they are cached
for a day and referenced from sent mail forever.

## Before the send

1. **Numbers.** The email uses floors (`11,000+`, `2,000+`, `over €85 million`)
   rather than the live count, because a send goes out days after it is
   written and the catalogue moves every five minutes. The landing page prints
   the exact figures. Check the floors are still floors on akay.ie.
2. **The spirits figure.** `Over €50 million of branded spirits` is written by
   hand in both the email and `src/pages/instant-quote.astro`. Add a
   `spirits_value_eur` row to the Airtable **Site Stats** table (Publish
   ticked) and the landing page will print that instead on the next refresh —
   one place to change it, like `stock_value_eur`.
3. **Escrow.** The email and the landing page both say escrow is *available*,
   not that every deal is escrowed. Keep that wording unless the terms say
   otherwise.
4. **Consent.** This is marketing email to business contacts in the EU/UK:
   send only to buyers who have bought or enquired, keep the unsubscribe link
   live, and honour it the same day.
5. **Render test.** Outlook (Windows), Gmail web, Gmail on Android, Apple Mail
   on iPhone. Look for: the GIF's first frame in Outlook, the button's colour
   block, and the 532px image not overflowing on a phone.

## Subject lines

The one in the file is the control:

- **Compare your current spirits invoice in 60 seconds** *(control)*
- Your buying list, priced in 60 seconds
- Send us your list — we'll price every line
- What are you paying for Smirnoff 12 × 70cl? *(only to spirits buyers, and
  only if the answer on akay.ie is competitive that week)*

Preheader stays as it is: it is the second half of the promise, not a repeat
of the subject.
