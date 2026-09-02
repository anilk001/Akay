# Decisions — why the project is shaped this way

Short records so nobody relitigates a settled choice, and so a choice can be
revisited deliberately when its reason no longer holds. Add one when you make a
decision that a future reader would otherwise question. Format: context, decision,
consequences. Date is when the decision was made or first recorded.

## D1. Static site generated from Airtable at build time (2026-07)
- **Context**: replacing a Softr page. Need own domain, full design control, no
  server to run, and the data already lives in Airtable.
- **Decision**: Astro static output; fetch at build; Netlify serves plain HTML.
- **Consequences**: zero runtime cost and no attack surface, but the site is only as
  fresh as the last build. Hence D3.

## D2. Fetch an explicit allowlist of public-safe fields (2026-07)
- **Context**: the Offers table also holds supplier identity and buy prices.
- **Decision**: `FIELDS` allowlist; nothing else is requested from Airtable, so
  nothing else can leak into HTML.
- **Consequences**: adding a field to a card is a two-step, reviewable change.

## D3. Freshness via a 5-minute GitHub Action that commits the snapshot (2026-08)
- **Context**: Netlify's build cannot hold the Airtable token safely enough for
  comfort and a Netlify build hook needs an Airtable automation to call it.
- **Decision**: Action re-fetches, commits `offers-snapshot.json` only when changed,
  and that commit triggers Netlify. Netlify itself has no token.
- **Consequences**: the snapshot is production data; history is dominated by bot
  commits; every PR conflicts on the snapshot. Accepted. If event-driven refresh is
  ever needed, wire an Airtable automation to a Netlify build hook.

## D4. Build never fails for lack of data (2026-07)
- **Decision**: no token, network error, or 0 live rows → build from the committed
  snapshot with a greppable warning.
- **Consequences**: quiet staleness is possible (see TROUBLESHOOTING). Mitigated by
  retrying 429/5xx (D6) and by logging the source on `<html data-source>`.

## D5. No test framework, no linter, one dependency (2026-07)
- **Context**: ~1,500 lines of code, one developer plus AI sessions.
- **Decision**: the build is the test. n8n logic gets plain-`node` test files.
  Verification steps are written down in WORKFLOW.md instead of automated.
- **Consequences**: every contributor must actually run the checks. Revisit if a
  regression escapes twice.

## D6. Retry only 429, 5xx and network errors (2026-08-30, commit `09484f9`)
- **Decision**: 4 tries, exponential from 500ms with jitter, honour `Retry-After`.
  401/403/422 are attempted once because repeating a config fault delays the report.

## D7. WhatsApp via `wa.me` deep links, one builder (2026-08-27, commit `4eb804d`)
- **Decision**: no WhatsApp Business API. `src/lib/whatsapp.mjs` owns the number and
  the message; every button routes through `enquiryLink()`.
- **Consequences**: moving to a Business API number later is a one-line change.

## D8. n8n node code is mirrored in the repo, but n8n is the runtime (2026-08-30)
- **Decision**: keep copies of Code-node JavaScript under `n8n/` with tests, so the
  parsing logic gets the same review trail as the site.
- **Consequences**: a repo change is not a production change. Publish checklist in
  WORKFLOW.md is mandatory; the 2026-07-29 → 08-27 unpublished-draft incident is why.

## D9. Keep `\uXXXX` escapes in regex character classes (2026-08-30)
- **Decision**: even though n8n stores the literal characters, the repo keeps escapes.
  Raw zero-width characters are invisible and some editors strip them.

## D10. Default branch keeps its migration-era name (2026-09)
- **Context**: `claude/softr-webflow-migration-50kj20` is what Netlify and the refresh
  Action point at.
- **Decision**: leave it until there is a quiet moment to change GitHub, Netlify and
  `refresh.yml` together. Documented in WORKFLOW.md so nobody is confused by it.

## D11. Project memory lives in `CLAUDE.md`, `docs/` and `.claude/rules/` (2026-09-02)
- **Context**: the same classes of error (price basis, blank clauses, unpublished n8n
  drafts, docs drift) recurred across sessions because nothing carried the lesson
  forward.
- **Decision**: `CLAUDE.md` is the short always-loaded memory; `docs/` holds detail;
  `.claude/rules/*.md` hold path-scoped rules that load when matching files are
  edited; `TROUBLESHOOTING.md` is the ledger every non-trivial bug is added to.
- **Consequences**: keeping these current is part of "done" for any fix.
