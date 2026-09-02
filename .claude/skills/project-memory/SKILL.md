---
name: project-memory
description: Persist and recall facts across sessions using the knowledge-graph memory MCP server wired up in this repo. Use when the user says "remember this", asks "what do you know about X" or "what did we decide about X", at the start of substantial work to load prior context, or to correct/retire stale memories. Covers what to store, naming conventions, and what must never be stored.
---

# Project memory

This repo's `.mcp.json` runs `@modelcontextprotocol/server-memory`, a
knowledge-graph store with tools under `mcp__memory__*`. It holds **entities**
(named things with a type), **observations** (facts attached to an entity),
and **relations** (directed links between entities). This skill is the
discipline for using it well — memory that isn't curated becomes noise.

## When to recall

- **Starting substantial work**: `search_nodes` for the topic (e.g. "offers
  catalogue", a supplier name) before re-deriving context. Use `open_nodes`
  to pull the full entries for the hits, `read_graph` only when you genuinely
  need everything.
- **The user asks** "what do you know / what did we decide about X".
- **Before contradicting a past decision**: check whether memory records why
  it was made.

If a search comes up empty, say so and move on — don't treat absence of
memory as absence of fact.

## When to save

- The user says "remember", "note", "for next time", or corrects you on
  something durable.
- A decision with a *why* is made (e.g. "snapshot commits stay in-repo so CI
  builds work offline").
- You learn a stable fact about a supplier, customer, tool, or workflow that
  a future session would otherwise have to rediscover.

Don't save session trivia, in-flight state, or anything already written down
in the repo (CLAUDE.md, skills, code comments own those — memory is for what
has no file).

## Conventions

- **Entity names**: short, canonical, reusable — `AKAY`, `offers-catalogue`,
  a supplier's trading name. Search before creating to avoid near-duplicates
  (`Akay Drinks` vs `AKAY`).
- **Entity types**: keep to a small set — `company`, `person`, `project`,
  `supplier`, `decision`, `preference`, `workflow`.
- **Observations**: one self-contained fact per observation, dated when time
  matters ("2026-09: Netlify rebuilds nightly via refresh.yml"). A future
  session must understand it without this conversation's context.
- **Relations**: active voice — `AKAY` `buys_from` `<supplier>`,
  `offers-catalogue` `deploys_to` `Netlify`.

## Hygiene

Memory is only trustworthy if wrong entries die:

- When the user corrects a stored fact, `delete_observations` on the old one
  and add the replacement — don't leave both.
- When an entity is obsolete (supplier dropped, project retired), delete it
  or record the ending as an observation rather than letting it silently rot.
- Before saving, check the entity's existing observations so you extend
  rather than duplicate.

## Never store

- Secrets: tokens (`AIRTABLE_TOKEN`, PATs), passwords, API keys.
- Commercially sensitive numbers this repo already treats as non-public:
  buy prices, margins, supplier terms. The catalogue's public-safe rule
  applies to memory too.
- Personal data beyond what's needed to identify a business contact.

## Note on availability and persistence

The memory tools exist only when the MCP server is loaded; without them this
skill has no fallback — say memory is unavailable rather than improvising a
substitute. The server stores its graph in a `memory.json` next to the
installed package by default, so on ephemeral machines (Claude Code on the
web) memory may not survive the container. For durable memory, pin the
store location by adding `MEMORY_FILE_PATH` (an absolute path) to the
`memory` server's `env` in `.mcp.json` on the machine that should keep it.
