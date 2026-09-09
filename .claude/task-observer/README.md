# Task observer workspace

Persistent state for the vendored `task-observer` skill
(`.claude/skills/task-observer/`). The skill watches a work session, captures
patterns and corrections worth turning into skills, and stages proposed skill
updates for review. It never edits a live skill by itself.

## Layout

```
.claude/task-observer/
  skill-observations/
    observation-log/            one Markdown file per observation
    observation-log/archive/    resolved entries, moved here after review
    last-review-date.txt        `never` until a review actually runs
    cross-cutting-principles.md created on first run (see below)
  skill-updates/                staging root for proposed skill edits
    PENDING.md                  staging manifest, written by the first review
```

`cross-cutting-principles.md` is deliberately absent. The skill's Session Start
Protocol creates it and first asks whether to start empty or seed it from
`references/starter-principles.md`; pre-creating it would answer that question
silently, and the file's authority comes from the adopter's own evidence trail.

## Why the workspace lives inside the repository

The skill normally warns when its workspace resolves to a temporary clone,
because state written to an ephemeral checkout is lost at teardown. That warning
is already answered here and should not trigger a re-anchor:

Claude Code on the web clones this repo into a container that is discarded when
the session ends. Every path outside the checkout — a home directory, a
`~/.claude` workspace — is destroyed with it, so anchoring outside would lose
*more*, not less. The checkout is the durable medium precisely because it is
committed and pushed. The trade-off is that persistence is manual: **commit
observation-log changes like any other file.** An uncommitted observation does
not survive the session that wrote it.

The anchor is also one location per checkout rather than a per-session or
per-cwd guess, which is what the skill's pinning rule actually protects against.
Because the skill is installed at project scope, a project-scoped log is the
matching scope.

## Confidentiality

Observations record methodology, not catalogue data. Golden rule 1 in
`CLAUDE.md` applies here too: no supplier identity, buy prices, margins, or
internal notes in an observation body. Nothing under `.claude/` is published —
Astro builds from `src/` — but the repository is the wrong place for trade data
regardless.

## Activation is only partly installed

The skill documents four activation tiers and says only the fourth is enforced.
Two are in place:

- **Description matching** — active (the skill's own frontmatter).
- **CLAUDE.md instruction** — active (the "Task observer" section).
- **Session-start hook** — **missing.** The install session was refused
  permission to add a script under `.claude/hooks/`.

Both installed tiers are probabilistic: they lose to a strongly matching domain
skill, and they are skipped on short tool-using openers. The missing tier is
what would make the review trigger structural rather than a soft "read a file
and compare a date" step that fails silently — the log keeps growing while
nothing ever reviews it.

The recipe for that last tier, including the two traps worth honouring (count
observations whose `status` reads `open` rather than counting files, and compare
ISO dates by sorting) lives in section **"A session-start hook (Claude Code and
similar harnesses)"** of
`.claude/skills/task-observer/references/environments.md`. Its workspace path
for this project is `$CLAUDE_PROJECT_DIR/.claude/task-observer`.

## Diagnosing a failed activation

If `skill-observations/observation-log/` is still empty after a few sessions of
real tool-using work, activation never happened: check that the CLAUDE.md block
is still present, or add the session-start tier above.
