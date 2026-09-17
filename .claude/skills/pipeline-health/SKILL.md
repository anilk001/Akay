---
name: pipeline-health
description: Triage the akay.ie publishing pipeline — the catalogue refresh workflow, CI, and the Trade Desk deploy — from a sandbox with no gh CLI. Use when the site looks stale against Airtable, a workflow is red, a refresh "is not running", a deploy did not reach quote.akay.ie, or before changing anything under .github/workflows/. Reads run history and step timings from the public Actions API, reproduces the verify gate locally, and lists the failure modes this pipeline has actually had.
---

# Pipeline health

The site is static. Only one thing can change what akay.ie shows: the
**Scheduled catalogue refresh** workflow committing a new
`src/data/offers-snapshot.json`. So "the site is stale" and "the refresh
workflow is red" are the same incident, and the Actions run history is the
first place to look — before the code.

## 1. Read the run history (no gh needed)

The repo is public, so the Actions API answers unauthenticated. `gh` is not
available in the remote sandbox; use curl + node. Node's own `fetch` ignores
the sandbox proxy, so fetch with curl and parse with node.

```bash
curl -sS "https://api.github.com/repos/anilk001/Akay/actions/runs?per_page=100" \
  -H "Accept: application/vnd.github+json" > /tmp/runs.json
node -e '
const runs=require("/tmp/runs.json").workflow_runs;
const tally={}; for(const r of runs){const k=r.name+" | "+r.event+" | "+r.conclusion; tally[k]=(tally[k]||0)+1}
console.log(tally);
const s=[...runs].sort((a,b)=>a.run_number-b.run_number); let p=null;
for(const r of s){ if(p&&p.conclusion!==r.conclusion) console.log("TRANSITION",p.run_number,p.conclusion,p.created_at,"->",r.run_number,r.conclusion,r.head_sha.slice(0,7)); p=r }'
```

The **transition** line tells you when it broke. Then get per-step timings for
a run on each side of it:

```bash
RUN_ID=...   # from runs.json
curl -sS "https://api.github.com/repos/anilk001/Akay/actions/runs/$RUN_ID/jobs" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s).jobs[0];
console.log(j.steps.map(x=>x.name+"="+x.conclusion+":"+(new Date(x.completed_at)-new Date(x.started_at))/1000+"s").join("\n"))})'
```

Job logs are on Azure blob storage, which the sandbox proxy blocks — do not
spend time on them. Annotations are reachable
(`/check-runs/<job id>/annotations`) but usually only say "exit code 1".

### Reading the refresh step's duration

| "Re-bake snapshot…" step | What happened |
|---|---|
| 15–25 s, success | Catalogue unchanged. Exited at the `git diff`. The common idle run. |
| 4–6 min, success | Catalogue changed; `npm ci && npm test && npm run build` passed; committed and pushed. |
| 4–6 min, cancelled | Was overtaken by the next poke. Check whether its commit landed before the cancel. |
| **20–35 s, failure** | Fetched fine, catalogue **changed**, and the verify gate failed **fast** — that is `npm ci` or `npm test`, not the build (the build alone takes minutes). Almost always a test that depends on catalogue content. |
| < 10 s, failure | `sync-offers` refused: no token, 401/403, or a 429 chain that exhausted its retries. |
| ~5 min, failure | `npm run build` or `check-public-safety.mjs` failed on the new snapshot. Treat a public-safety failure as a real leak attempt: find the field. |

## 2. Confirm the site is stale, and by how much

```bash
node -e 'const j=require("./src/data/offers-snapshot.json");console.log(j.offers.length,"offers,",j.delisted.length,"delisted, generated",j.generated,"stats",JSON.stringify(j.stats))'
```

Compare with live Airtable through the **hosted** Airtable connector
(`mcp__Airtable__list_records_for_table`, base `appaDSdZkAE9PGkjT`, table
`Offers`, filter `Public Listing = "Yes"`, `pageSize: 1` — read
`metadata.totalRecordCount`). The community `mcp__airtable__*` server and
`npm run sync-offers` both need direct egress to api.airtable.com, which the
sandbox does not have, so use the hosted connector for live reads.

A count that differs from the snapshot plus a red refresh = the site is stuck.

## 3. Reproduce the verify gate locally

You cannot bake a live snapshot here, but you can usually reproduce the
failing test by editing a *copy* of the snapshot into the live shape (the
snapshot itself is hook-protected and must never be hand-edited):

```bash
S=$SCRATCHPAD/sim && rm -rf $S && mkdir -p $S/src/data $S/src/lib $S/tests/fixtures
cp src/lib/*.mjs $S/src/lib/ && cp tests/fixtures/* $S/tests/fixtures/ && cp tests/*.test.js $S/tests/
node -e 'const j=require("./src/data/offers-snapshot.json");
  j.offers=j.offers.filter(o=>o.id!=="recXXXX");   // e.g. drop the row that expired
  require("fs").writeFileSync(process.argv[1]+"/src/data/offers-snapshot.json",JSON.stringify(j))' $S
node $S/tests/search-engine.test.js
```

Use the hosted connector to find *what* changed: query the rows a failing
test names (by `Public Product Description`) and read `Public Listing`,
`Status`, `Auto Expiry Date`. An offer whose expiry date was yesterday and
whose listing is now "No" is the usual answer.

## 4. Fix the right thing

- **A test names a live SKU, brand, count or stat** → the test is wrong, not
  the data. Move the case onto `tests/fixtures/` (see the
  `snapshot-safe-tests` skill). Never "fix" it by editing Airtable.
- **`check-public-safety.mjs` failed** → a non-public field name reached
  `dist/`. Find it in `FIELDS`/templates. Do not relax the checker.
- **429 chain** → look for what else is hitting the base (n8n runs, a
  second poke source). The fetch already retries; the fix is upstream.
- **Push rejected** → the site branch moved during verify. The job rebases
  and retries once; a conflict on the snapshot means the next poke redoes it.

After pushing a fix to the site branch, watch the next poke (5 min): the
"Re-bake" step should go back to ~20 s green or ~5 min green with a commit.
The workflow opens one issue labelled `refresh-failing` while red and closes
it on the next green run — check it got closed.

## 5. Before changing a workflow file

Every one of these has bitten this repo. Check each before pushing:

1. **Pushes made with `GITHUB_TOKEN` never trigger workflows.** The refresh
   bot's commits do not run `ci.yml`. Any check the bot's output needs has to
   run inside the bot's own job, before the commit.
2. **`run:` with no `shell:` is `bash -e` WITHOUT pipefail.** `npm test | tee`
   reports tee's exit code. Put `set -euo pipefail` at the top or set
   `shell: bash`.
3. **`schedule:` is best-effort.** A `*/5` cron on a free runner fired every
   4–6 hours here. Anything that must happen on time is a
   `repository_dispatch` from n8n.
4. **`cancel-in-progress: true` can cancel the run that was about to
   commit.** A poke every 5 min against a 5-min verify step is a race. Queue
   (`cancel-in-progress: false`); GitHub keeps only one run pending per group.
5. **Secrets are invisible to fork PRs.** Skip, warn, or draft — do not fail
   the contributor's check over a secret they cannot see.
6. **A CLI reads the nearest config.** Netlify CLI run from the repo root
   picked up the catalogue's `netlify.toml` and tried to build Astro in a job
   with no dependencies (`astro: not found`). `cd` into the folder whose
   config you mean, and pass `--no-build` for pre-built bundles.
7. **Prove a deploy, don't trust it.** Fetch the live page and look for the
   content-hashed asset name from the committed bundle.
8. **Bumping actions:** `actions/checkout@v5` and `actions/setup-node@v5`
   need the Node 24 runner (ubuntu-latest has it). Older majors log a
   deprecation warning on every run.
9. Validate before pushing: `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/X.yml'))"`,
   and run the bash body locally with a stub for any external CLI.

## What has actually failed, and when

| Date | Symptom | Cause | Fix |
|---|---|---|---|
| 2026-09-14 | Trade Desk deploy: `astro: not found` | Netlify CLI run from repo root read the catalogue's config and built by default | `cd quote`, `--no-build` |
| 2026-09-16 12:13–17:30 | akay.ie showed 7,809 offers vs 11,598 live | `*/5` cron fired every 4–6 h | n8n poke via `repository_dispatch` |
| 2026-09-16 13:27 | Site branch red for hours, nobody told | Refresh commits (GITHUB_TOKEN) never ran CI; a new "Guinness 440ml" row outranked the SKU a test pinned | Verify inside the refresh job; assert brand+size not SKU |
| 2026-09-16 | CI red after first real stat baked | Test asserted `{}` for the stats fallback, which only held while the snapshot had no stats | Compare against the snapshot itself |
| 2026-09-17 00:05–05:00 | Refresh failed 56 runs in a row; site stale 5 h | "Guinness Draught" expired at midnight and left the listing; a test asserted it by name | Acceptance cases moved to `tests/fixtures/`; failure now opens an issue |
| 2026-09-17 00:00 | A commit + deploy every midnight with no change | `generated` was stamped with today's date unconditionally | Keep the previous stamp when content is identical |
