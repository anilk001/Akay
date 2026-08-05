---
name: structured-reasoning
description: Work through hard problems as an explicit, revisable chain of numbered thoughts before committing to an answer. Use for multi-step architecture decisions, tricky debugging, trade-off analysis, planning a change with several moving parts, or any problem where the first idea is probably not the final one. Replicates the discipline of the sequential-thinking MCP tool as a repeatable method.
---

# Structured reasoning

A method for problems where jumping straight to an answer tends to be wrong.
It makes the reasoning explicit, keeps it revisable, and separates thinking
from concluding. Use it when the problem has several interacting parts, more
than one plausible approach, or a high cost of being wrong.

## When to use it

- Architecture / design decisions with trade-offs.
- Debugging where the cause isn't obvious and guesses have been wrong.
- Planning a change that touches several files or systems.
- Any moment you notice yourself about to commit to the *first* idea.

Skip it for lookups, one-line edits, and things you already know.

## The method

1. **Frame the goal.** State in one line what a correct final answer must
   satisfy — the constraints and the definition of done. Everything below is
   judged against this.

2. **Think in numbered steps.** Write `Thought 1`, `Thought 2`, … Each step is
   one move: an observation, a deduction, a candidate approach, or a question.
   Keep each honest and small. Don't smuggle three leaps into one step.

3. **Estimate, then let it grow.** Guess how many steps you'll need, but treat
   that as a starting budget, not a cap. Add steps if the problem turns out
   deeper than it looked.

4. **Revise openly.** When a later step undercuts an earlier one, say so:
   *"Thought 5 revises Thought 2 — the cache is keyed per-request, so the race
   I assumed can't happen."* Don't quietly edit the past; show the correction.

5. **Branch when the path forks.** If two approaches are both live, label them
   (Branch A / Branch B), carry each far enough to judge it, then say which you
   dropped and why. Don't leave a fork silently abandoned.

6. **Question your own conclusion.** Before finishing, add one adversarial step:
   *"What would make this wrong?"* Try to refute the answer. If it survives, you
   can trust it more; if it doesn't, keep going.

7. **Only then, conclude.** State the answer and the one or two thoughts it
   actually rests on. The chain was the work; the conclusion is the summary.

## What good looks like

- Each thought is falsifiable, not vague ("the query is O(n²) because it
  re-scans `offers` inside the map" — not "this might be slow").
- Wrong turns stay visible as revisions, so the reasoning can be audited.
- The final answer names its load-bearing assumptions, so a reader knows what
  to check if it later proves wrong.

## Note on the MCP version

There is also a `sequential-thinking` MCP server (`npx -y
@modelcontextprotocol/server-sequential-thinking`) wired up in this repo's
`.mcp.json`. When its tool is loaded it provides the same loop as a callable
tool. This skill is the method itself — usable with or without that tool
loaded, and the fallback whenever the tool isn't available in the session.
