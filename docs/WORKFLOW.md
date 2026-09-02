# Workflow — branches, commits, PRs, conflicts, verification

## Branch model

| Branch | Role |
|---|---|
| `claude/softr-webflow-migration-50kj20` | **The default branch. It is production.** Netlify deploys every push. The refresh bot commits here every 5 minutes. The name is historical; treat it as `main`. |
| `claude/<topic>-<6-char-id>` | Feature branches. One topic each. Opened from and merged back into the default branch via PR. |

Renaming the default branch would require changing it in three places at once:
GitHub default branch, both `ref:`/`push` lines in `.github/workflows/refresh.yml`,
and Netlify's production branch. Do not do it casually.

## Day-to-day loop

```bash
git fetch origin claude/softr-webflow-migration-50kj20
git checkout -b claude/my-topic-abc123 origin/claude/softr-webflow-migration-50kj20
# ... edit ...
npm run build                                # must end with [build] Complete!
git add -A && git commit                      # see commit format below
git push -u origin claude/my-topic-abc123
```

Open a PR into the default branch. Fill in the template checklist in
`.github/pull_request_template.md` honestly. Merge with a merge commit (history has
always used merge commits; the bot's snapshot commits make rebasing painful).

## Commit message format

```
type(scope): imperative summary under 72 chars

What was observed (the symptom, with a real example if there is one).
What changed and why this shape rather than another.
How it was verified (command run, counts, before/after).
```

- `type` ∈ `fix`, `feat`, `chore`, `docs`, `refactor`. `scope` is the area:
  `airtable`, `whatsapp`, `seo`, `catalogue`, `n8n`, `mcp`, `validator`, `ci`.
- The bot uses exactly `chore: refresh catalogue snapshot from Airtable`. Never use
  that subject for a human commit; tooling filters on it.
- For `n8n/` changes, the body must say whether the node has been **published** in
  n8n. Unpublished is the default assumption.

## The snapshot conflict (you will hit this)

Symptom: merging or rebasing onto the default branch reports a conflict in
`src/data/offers-snapshot.json`, usually thousands of lines.

Cause: the bot committed a newer snapshot after you branched.

Fix: always take the default branch's copy. It is fresher and will be overwritten
again in five minutes anyway.

```bash
# when merging the default branch INTO your feature branch:
git merge origin/claude/softr-webflow-migration-50kj20
git checkout --theirs src/data/offers-snapshot.json
git add src/data/offers-snapshot.json && git commit

# when rebasing your feature branch ONTO the default branch (roles flip):
git rebase origin/claude/softr-webflow-migration-50kj20
git checkout --ours src/data/offers-snapshot.json
git add src/data/offers-snapshot.json && git rebase --continue
```

Never resolve this file by hand and never commit a snapshot you edited. If your
change alters `normalize()` in a way that changes snapshot content, don't regenerate
the snapshot in the PR — `renormalizeSnapshotOffer()` re-applies the current rules
on read, and the bot will regenerate the file after merge.

## Verification: what "tested" means in this repo

There is no test runner for the site. These are the checks. Run the ones that match
what you touched, and put the results in the commit body.

**Always**
```bash
npm run build 2>&1 | tail -5        # expect "[build] N page(s) built" and "[build] Complete!"
```

**Touched `airtable.mjs`, `whatsapp.mjs`, or any page that prints a price**
```bash
# No blank clause in any WhatsApp message. Expect 0.
grep -rho 'wa.me/[^"]*' dist | python3 -c "import sys,urllib.parse as u; s=[u.unquote(l) for l in sys.stdin]; print(sum('()' in x or x.rstrip('.').endswith(('EUR','GBP','USD')) for x in s))"

# Every per-unit priced offer is NOT labelled per case. Expect 0.
python3 - <<'PY'
import json,re
d=json.load(open('src/data/offers-snapshot.json'))
bad=[o['name'] for o in d['offers'] if o.get('priceBasis') and not re.search('case|pack',o['priceBasis'])]
print(len(bad),'per-unit offers exist; check they render without a "/case" label in dist/offers/*')
PY

# Snapshot fallback still works: unset the token and build. Expect "using snapshot".
env -u AIRTABLE_TOKEN npm run build 2>&1 | grep '\[airtable\]'
```

**Touched `n8n/`**
```bash
node n8n/tests/split-quantity.test.js && node n8n/tests/buy-side-guard.test.js
# Do NOT use `node --check` on extract-wa-offers.js — top-level return is legal in an n8n Code node.
```

**Touched `.claude/skills/*/*.py`**
```bash
python3 .claude/skills/offer-data-validator/validate_offers.py <sample.csv>
```

**Touched `refresh.yml`, `netlify.toml`, `.env.example`, `README.md`**
Re-read all four together. They describe the same pipeline and have drifted before
(the `.env.example` once said Cloudflare Pages while the site was on Netlify).

## n8n publish checklist

n8n workflows live in n8n cloud. This repo only mirrors the node code. A node edited
in n8n and left as a draft is invisible: in 2026 that cost a month of unclassified
WhatsApp messages (~5,000). So, every time:

1. Edit the file in `n8n/` first, run the tests, commit with "not yet published".
2. Paste the code into the node in n8n.
3. **Publish** the workflow. Copy the `activeVersionId`.
4. Run one real message through it and confirm the output row.
5. Update the state column in `n8n/README.md` with the date and version id, commit
   as `docs(n8n): record <node> as published`.

## Remote (Claude Code on the web) session notes

- No Airtable token: builds use the snapshot; `sync-offers` refuses to run. Correct.
- The GitHub MCP host is blocked by the network policy. Use `git` for all remote
  operations. If asked to open a PR and the MCP is down, push the branch and give
  the compare URL instead.
- Always work on the branch the task names. Never push to the default branch
  directly; only the refresh bot and merges do that.
