---
name: snapshot-safe-tests
description: Write or repair tests under tests/ so they cannot be broken by a routine catalogue refresh. Use before adding a test that reads src/data/offers-snapshot.json, when a test under tests/ fails after a "chore: refresh catalogue snapshot" commit, or when the refresh workflow is red at the npm test gate. Covers the fixture pattern, what the snapshot may and may not be used for, and the review checklist.
---

# Snapshot-safe tests

## Why this matters more here than in most repos

`src/data/offers-snapshot.json` is rewritten from Airtable every few minutes,
and the refresh workflow runs `npm test` **against the new snapshot before it
will commit it**. A test that depends on catalogue content therefore has two
failure modes, and neither is "a red check":

- It fails on a PR branch after the bot moved the base (2026-09-16 13:27).
- It fails inside the refresh job, which then refuses to commit, every five
  minutes, until the test is changed — the site silently stops updating
  (2026-09-17 00:05, five hours, over one SKU that expired at midnight).

Offers sell out, expire at 00:00 UTC, get unpublished, get renamed, and new
rows outrank old ones. Any of those must leave `npm test` green.

## The rule

**No assertion may depend on a particular offer, brand, count, stat value or
ranking being present in the live snapshot.**

Anything about *behaviour* — ranking, typo tolerance, unit parsing, wording,
bucketing, escaping — runs over a **committed fixture** that cannot change
under the test. The live snapshot is used only for:

1. **Budgets**: index build time, query latency, file size.
2. **Self-derived checks**: pick an input *from* the data and assert a
   property the code guarantees for *any* row — "searching an offer's own
   brand + name finds that offer", "every `unitAmount` is a finite number",
   "no key outside `PUBLIC_KEYS`".
3. **Comparisons against the snapshot itself**: `statsForSnapshot(x,
   undefined)` must equal what the file carries, whatever that is.

## The fixture pattern

`tests/fixtures/search-catalogue.json` is a dozen real rows frozen in the
repo, carrying only the keys the test's `fields()` reads. To add a row:

```bash
node -e '
const j=require("./src/data/offers-snapshot.json");
const keep=["id","name","variants","brand","category","spec","tier","terms","unitType","warehouse","note"];
const row=j.offers.find(o=>/Jameson 40/.test(o.name));
console.log(JSON.stringify(Object.fromEntries(keep.map(k=>[k,row[k]])),null,1))'
```

Paste the result into the fixture. Keep the fixture small (tens of rows) and
representative (at least two rows that compete for the same query, at least
one near-miss — a 330ml next to a 440ml). Say in the test comment *why* each
competing row is there.

Fixtures are plain data, not snapshots: hand-editing them is fine and the
`protect-files` hook does not apply.

## Writing a case

```js
// GOOD — brand and size are the contract; either 440ml Guinness may win.
const [first] = top('guiness 44cl');
assert.equal(first.brand, 'Guinness');
assert.equal(first.spec, '24 x 440ml');

// GOOD — the expectation comes from the data.
const probe = offers.find((o) => o.brand && o.name.split(/\s+/).length >= 2);
assert.ok(search(live, `${probe.brand} ${probe.name}`).some((r) => offers[r.idx].id === probe.id));

// BAD — names a SKU that will sell out.
assert.equal(top('guinness draft')[0].name, 'Guinness Draught');   // over the snapshot

// BAD — a literal that is only true today.
assert.deepEqual(snapshotStats(), {});
assert.equal(offers.length, 11724);
```

The third example is fine **over the fixture** — that is what the fixture is
for.

## Review checklist — ask of every assertion

- Would this still pass if that offer sold out tonight? Expired at 00:00?
  Was unpublished? Was renamed by a supplier?
- Would it pass if a *second* similar offer were loaded tomorrow and ranked
  first?
- Would it pass if the catalogue doubled, halved, or had zero rows in this
  category?
- Would it pass if `Site Stats` had its `Publish` box unticked, or a new stat
  added?
- Does it read `offers-snapshot.json` for anything other than a budget, a
  self-derived check, or a comparison against the file itself?

If any answer is "no", move the case onto the fixture.

## When the refresh job is already red

1. Confirm with the `pipeline-health` skill (step timings; ~20–35 s failure
   = the test gate).
2. Reproduce on a *copy* of the snapshot edited into the live shape (that
   skill shows how). Never hand-edit the real snapshot.
3. Fix the test, run `npm test`, push to the site branch. The next poke
   (≤ 5 min) commits the waiting catalogue and closes the `refresh-failing`
   issue.
4. Do not "fix" it by changing Airtable, and do not skip or loosen the
   assertion to a tautology — move it onto the fixture.

`npm test` is the gate that stands in for CI on refresh commits, and the
`run-site-tests` hook runs it after any edit under `tests/` or `src/lib/`.
