# Decision log

Newest first. Each entry: what was decided, why, and what it replaced or
ruled out. Add an entry when a choice would surprise someone reading the code
cold.

## 2026-09-02 — Add project memory (this docs set)

Context lived in commit bodies, `n8n/README.md` and skill files. Consolidated
into `CLAUDE.md`, `docs/`, path-scoped rules and a PR checklist so a fresh
session starts with the invariants instead of rediscovering them. No source
code changed; build still 3983 pages.

## 2026-08-30 — Retry 429/5xx on the Airtable fetch, never 401/403/422

Airtable allows 5 requests/second per base, shared by the build, the
every-5-minutes refresh Action and n8n ingestion. A single 429 threw out of
`fetchLive()` and the site silently served stale prices with no failed job to
notice. Retry with `Retry-After` or jittered exponential backoff, four tries.
Configuration faults are not retried because repeating them only delays the
report.

## 2026-08-30 — Mirror n8n Code-node source in the repo

The parsing and classification logic inside n8n nodes had no review trail.
`n8n/` now holds the source with tests. The mirror is explicitly *not* the
running system; deployment is paste-and-publish. Recorded because an unpublished
draft once left ~5,000 WhatsApp messages unclassified between 2026-07-29 and
2026-08-27.

## 2026-08-30 — Buy-side guard is deliberately narrow

The classifier decides on price presence. A guard now excludes unmistakable
buy phrasing ("I'd like a quote", "what's your best price"). "Do you have", "do
you need" and bare "looking for" are excluded from the guard because they appear
in real sell messages. A missed offer costs more than a review line.

## 2026-08-27 — One WhatsApp module for all nine call sites

Enquiry links were built inline in two pages and hard-coded in four more, with
optional fields interpolated unguarded. `src/lib/whatsapp.mjs` owns the number
and the builder; clauses are omitted when empty. A future move to a Business API
number becomes a one-line change.

## 2026-08-14 — Structured data derives unit from the parsed basis

`eligibleQuantity.unitText` was hard-coded `case`. Now case/pack → case,
unit/btl/can/piece/jar → unit, unknown → omit the claim. Asserting nothing
beats asserting something false to a search engine.

## 2026-08-14 — Request form copy stops claiming success

The category request form posts with `mode: 'no-cors'`, so the response is
opaque. Rather than add a server to read it, the confirmation text was made
honest: request sent, check spam, email offers@akay.ie if nothing arrives.

## 2026-08-09 — One page per offer, per category, plus guides and llms.txt

SEO and AI-search build-out. Slugs from name + spec, deduped with `-2`, `-3`,
truncated to 90 chars for filesystem limits. JSON-LD on every page type.
`robots.txt` allows all AI crawlers. Page count went from 1 to 189 then, and to
3983 as the catalogue grew.

## 2026-08-08 — Amount and basis from the same price part

49 of 173 offers printed a per-unit figure under "/ case". The headline amount
and its basis now come from the same `·`-separated part of
`Price Per Unit & Case`. The same correction is applied when reading the
snapshot, so a fallback build cannot resurrect the mix-up.

## 2026-08-08 — Sort by a derived per-unit figure

Case-only offers sorted by case price against unit prices. `unitAmount` divides
by pack size found in the price string, the spec, or `PCS/Case` (added to the
public allowlist since it is only units-per-case). Offers with no pack size
anywhere keep the case figure as an honest fallback rather than a guess.

## 2026-08-08 — Variant lists split out of product names

A 365-character name broke the grid. Split at a dash only when the tail has two
or more commas and the head is at least 8 characters, so real single-dash names
survive. The `Variant` field wins when present.

## 2026-08-08 — Whole cases only

Fractional `Stock Cases` means units were typed as cases. The site rounds; the
validator skill flags the row for correction in Airtable.

## 2026-08-08 — Drop the unused featured-offers query

A second Airtable query for featured offers existed and was never imported.
Featured cards render from the main query via the `Featured` flag. One source
of truth.

## 2026-08-08 — Lazy-render cards with `content-visibility: auto`

The brief was "fix the page load of all products". The catalogue was 173 cards
that day but had been 1,400+ and would grow back. Off-screen cards cost nothing
to render. Search and filter verified unchanged on top of it.

## 2026-08-05 — Refresh by committing the snapshot, not by Netlify build hook

Netlify's build holds no Airtable token, so a build hook would re-emit the same
snapshot. The GitHub Action fetches live (runners have open egress), commits
only when the catalogue changed, and that commit triggers Netlify. Idle checks
cost no build minutes. Runs every 5 minutes, GitHub's minimum. An Airtable
automation hitting a build hook was considered and remains the option for
guaranteed ~90 s updates if the token is ever given to Netlify.

## 2026-08-05 — Deploy branch is `claude/softr-webflow-migration-50kj20`

The migration branch became production and was never renamed. It is the remote
HEAD, what Netlify builds and what the refresh bot commits to. Renaming would
require updating the Action, Netlify and every open PR base; not worth it yet.

## 2026-08-05 — Claude Code project setup

SessionStart hook installs deps on remote sessions only. `.mcp.json` declares
sequential-thinking, memory, github and airtable servers. Skills for the
catalogue, offer validation, price-list intake and structured reasoning.
Superpowers and ui-ux-pro-max plugins enabled in `.claude/settings.json`.

## 2026-08 (initial) — Static Astro site reading Airtable at build time

Replaced a Softr page. Same Airtable base, full design control, own domain
`offers.akay.ie`, Netlify hosting, GoDaddy DNS. Static so there is no server
to run and no token in the browser. Only public-safe fields are requested, so
supplier identity and buy prices cannot leak. The committed snapshot keeps the
build green with no token or network.
