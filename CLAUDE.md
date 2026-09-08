# Akay — rules for Claude sessions in this repo

This repo is the akay.ie offers catalogue (Astro + Netlify). The data lives in
the Airtable base `Akay Offers` (`appaDSdZkAE9PGkjT`). Anil owns Akay Irl Ltd.

## Before writing ANYTHING to the Airtable base

Read the `System Instructions` table (`tblhZFeYPGbiBSMX1`) first, in full:

- **ACTIVE RULES** record — authoritative operating rules.
- **MANUAL OFFER INGESTION — Cross-Account Upsert Playbook** — the exact
  field write map for Offers, the NEVER-WRITE list, and the human-led gates.

Those records win over any precedent you find in existing offer records.
Older offers may carry ticks or values that pre-date the current rules;
copying an existing record's fields is NOT a substitute for reading the rules.

## Human-led fields — never set these (Anil, 2026-08-13; repeated 2026-09-08)

- **Listing Approved** (`Offers.flddRGgVMAoI6Q2gX`) — Anil or Annika tick this
  by hand. It is what puts an offer on the public site. Leave it UNTICKED on
  every offer you create or update, in every ingestion path (manual, price-list
  intake, Gmail, n8n). Never tick it as a convenience, in bulk, or because the
  offer looks approved. Do not retro-untick offers that a human already ticked.
- **Send Eligible** is a formula; it cannot be written.

Recurrence log: 2026-09-08 — 556 Albion Connection (L'Oréal / Maybelline)
offers were created with Listing Approved ticked by copying the CeraVe
precedent from 2026-08-31. Anil left them ticked but restated the rule.

## Other write rules that bite

- Never overwrite a price in place (Buy Price, Sell Price, Margin %); a
  correction is a superseding record.
- New suppliers: Trust Score Medium, never High automatically.
- Only public-safe fields are pulled into the site (`src/data/airtable.mjs`).
  Supplier identity, buy prices and margins never reach the browser.

## Skills

`.claude/skills/price-list-intake` and `.claude/skills/offer-data-validator`
cover loading a supplier price list. `.claude/skills/offers-catalogue` covers
the site build and deploy pipeline.
