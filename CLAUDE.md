# Akay — working notes for Claude

Two separate things live behind this repo, and they are easy to confuse:

1. **`offers.akay.ie`** — the public Astro catalogue in `src/`. Reads Airtable at
   build time. Gated by the human **`Listing Approved`** tick.
2. **Outbound offer dispatch** — the n8n workflow `Offer Dispatch — Akay`
   (`dAYMAj6mZD3hTV4T`) that emails offers to clients through Resend. Gated by a
   separate human **approval click**.

They share the Airtable base (`appaDSdZkAE9PGkjT`) and nothing else. A change that
fixes one does **not** fix the other — that mistake is exactly how the same
price-basis bug survived in the dispatch email after being fixed twice on the
site. When you fix something about how an offer is *presented*, ask which of the
two channels you just fixed, and whether the other needs the same change.

## Before sending offers to clients

**Read `.claude/skills/offer-dispatch/SKILL.md` first, every time.** It is the
procedure, the five gates in the order they run, and a failure catalogue keyed by
symptom. Sending offers is a queue-and-gate pipeline, not "write an email".

A dispatch belongs in **Claude Code, in this repo, one fresh session per
dispatch** — the preflight check and the email preview are scripts here and need a
shell. A claude.ai chat can queue a send it has no way to check first, so it is
the wrong place to dispatch from; it is fine for questions that need no tooling.

Non-negotiables, learned the expensive way:

- **Preflight before queueing.** `python3 preflight_dispatch.py dispatch.json`.
  It re-runs every gate and refuses on a blocker. Queueing without it is how a
  dispatch comes to halt silently hours later.
- **Preview the email before a human is asked to approve it.**
  `node compose_preview.cjs dispatch.json` renders exactly what will be sent.
- **A price must always state its basis.** Use `Price Per Unit & Case`, never a
  bare `Price Display` — its own field description ("Per-case price") is wrong for
  five of the seven `Price Type` values.
- **One run sends ONE dispatch group.** Multi-line offers need a shared
  `Bundle ID`. Queueing several unrelated offers sends the oldest and defers the
  rest.
- **Never edit the workflow's Code nodes in the n8n UI.** They are versioned in
  `.claude/skills/offer-dispatch/n8n/`. Edit the file, run
  `node test-nodes.cjs` (14 tests over two real dispatches), paste, then read the
  node back and diff it. There is no way to test the live workflow without
  emailing real clients, so that suite is the only gate.
- **Don't tell anyone an offer went out** until the execution succeeded,
  `Reconcile._summary` reads `Dispatch complete — N/N sent`, and `Offers Sent Log`
  has the matching rows.

## Airtable field descriptions are the specification

Most fields in the `Akay Offers` base carry a description saying what they are
for, whether they are public-safe, and often why they were changed and when. They
are load-bearing documentation — read the description before using a field, and
update it when you change what a field means. `System Instructions`
(`tblhZFeYPGbiBSMX1`) holds the canonical cross-cutting methods, including
*Email Campaigns via n8n + Resend* and *Offer Dispatch*.

Supplier identity, buy prices, margins and internal notes are **never** public.
`Offer Name`, `Notes`, `Trader Comment` and `Delivery Info Source` all contain
supplier names — none may reach the site or a client email.

## The site

See `.claude/skills/offers-catalogue/SKILL.md`. Verification is the build:

```bash
npm install
npm run build      # "[build] Complete!" means the catalogue renders
```

There is no test or lint suite for the site. A build log line
`[airtable] … — using snapshot` means the offline fallback ran; that is expected
without a token, not an error.

## Other skills here

- `offer-data-validator` — row-level price/pack/name errors in an offer export.
- `price-list-intake` — supplier price list → importable Offers CSV.
