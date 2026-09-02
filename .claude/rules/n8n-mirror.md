---
paths:
  - "n8n/**"
---

# Rules for the n8n mirror (`n8n/`)

This directory is a **mirror**, not the running system. The workflows run in n8n
cloud. Read `n8n/README.md` before editing.

- A change here is live only after it is pasted into the node **and the workflow is
  published**. The commit body must state the publish status. Default: not published.
- After publishing, update the state column in `n8n/README.md` with the date and the
  `activeVersionId`, in a `docs(n8n): ...` commit.
- Run both tests before committing:
  `node n8n/tests/split-quantity.test.js && node n8n/tests/buy-side-guard.test.js`.
  Test cases are real WhatsApp messages; add a real one when you fix a real defect.
- Do **not** use `node --check` on `extract-wa-offers.js`. Top-level `return` is legal
  in an n8n Code node and the check will fail for that reason alone.
- Keep `\uXXXX` escapes in regex character classes. n8n stores the literal characters;
  the two forms are equivalent and the repo form is the readable one.
- The classifier guard is deliberately narrow: a missed supplier offer costs more than
  a review line. Don't widen the buy-side patterns without a real false positive.
- `productKey` is the Product-matching identity. Anything that leaks into the product
  name (quantities, terms) creates duplicate Product records over time. Strip with the
  shared `QTY`/`TERMS` vocabulary, never with a bare-number regex.
