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

## Offer ingestion: labelling `Process_Akay` is automatic, but not instant

Applying `Process_Akay` to an email **does** get it ingested without anyone asking
Claude. Do not build a manual path for this, and do not assume it is broken just
because nothing happened in the first minute.

How it works: n8n's Gmail Trigger only fires on **newly arriving** mail, so a
newly *labelled* old email never looks new to it. `Catch-up Sweep — Process_Akay
Stranded Mail` (`NlzK9DMrkNmfcZoY`) bridges that — every 15 minutes it finds
`Process_Akay` mail with no Done/Needs-Review label and **resends it** so the
triggers see a fresh arrival.

- **Expect up to 15 minutes** for a hand-labelled email. New mail is picked up
  within a minute.
- **There is exactly one retry.** The resent copy carries `Akay/Resubmitted` and
  the sweep will not resend it again; if ingestion fails on the copy it gets
  `Akay/Needs-Review`, which the sweep excludes forever, plus one alert to
  ak@akay.ie. So *any* ingestion failure permanently strands that email — which is
  the real reason offers end up needing a human. See
  `.claude/skills/offer-dispatch/n8n/INCIDENT-2026-08-18-pdf-ingestion.md` for the
  chain traced end to end.

When an offer "didn't get picked up", check the ingestion workflow's executions
first. The queue mechanism is almost certainly fine; the ingestion run failed.

## Gmail credentials: n8n auto-assigns the wrong one

Six `gmailOAuth2` credentials exist on this instance ("Gmail account" 1–5 and
"offers n8n"). **The mailbox everything runs against is `offers n8n`
(`qunIwKuc11bYHBVr`).** n8n auto-assigns "Gmail account" (`1C9YXLyY85aeKPpf`),
which is a *different* mailbox — always set the credential explicitly on a new
Gmail node and never accept the auto-assignment.

This is not cosmetic. A node on the wrong mailbox does not fail at save time:

- On a **write** it 404s — Gmail returns `notFound`, not a permission error, for a
  thread outside the authenticated mailbox. That was the `Mark Needs Review` bug:
  a valid thread and a valid label, failing for days.
- On a **read** it silently returns nothing, which is worse. The stranded-mail
  digest was auto-assigned the wrong credential and would have reported an empty
  backlog forever.

**To identify a credential, probe it.** The API will not reveal which credential a
node uses, but you can point a read-only node at a query whose true answer you
already know, run it under each candidate, and compare. That is how the above was
settled: the same Gmail query returned 4 threads under `offers n8n` and 0 under
"Gmail account", seconds apart.

## n8n has drafts. Saving is not shipping.

This n8n instance uses **draft / published versions**. `update_workflow` writes to
the **draft**. The live workflow keeps running the published version until someone
calls `publish_workflow`. A saved fix that was never published is invisible: the
editor shows your change, the production runs do not have it.

Always finish an n8n edit with:

```
publish_workflow(workflowId)
then get_workflow_details and assert versionId === activeVersionId
```

This is not hypothetical. On 2026-08-18 a check found the labelling fix for
`PDF/Image Offer Ingestion` sitting unpublished since 2026-08-14 — production had
been failing that whole time on a bug that was already fixed in the editor — and
the entire dispatch repair from earlier the same day was also still unpublished
and therefore not live. `Excel Offer Ingestion — Akay` still has an unpublished
draft nobody has reviewed.

So when reading a workflow to reason about a failure, read the **published**
version (`get_workflow_version` with `activeVersionId`), not
`get_workflow_details`, which returns the draft. They diverge.

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
