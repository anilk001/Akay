---
paths:
  - "n8n/**"
---

# n8n mirror rules (n8n/)

These files mirror JavaScript inside n8n Code nodes in n8n cloud. **Editing
them changes nothing in production.** Read `n8n/README.md` first.

- Deployment is manual: paste into the node, then **publish** the workflow. An
  unpublished draft runs nothing. Once published, update the State column in
  `n8n/README.md` with the date.
- `extract-wa-offers.js` is a Code-node *function body*. Top-level `return` is
  correct there and `node --check` will fail on it. Syntax-check by wrapping in a
  function.
- Keep the two `\uXXXX` regex escape classes in `clean()` as escapes. The node
  holds literal characters; the regexes are identical. Do not "fix" the
  difference in either direction.
- On money, refuse rather than guess. Ranges, averages and two prices for the
  same goods go to review. Do not add heuristics that pick one.
- `BUY_SIDE` is deliberately narrow. Before widening it, add the real message to
  both lists in `n8n/tests/buy-side-guard.test.js` and confirm sell-side
  messages like "Do you need Pilsner Urquell…" still classify as
  `Supplier Offer`.
- `productKey` is the Product-matching identity. Any change to name cleaning
  (`splitQuantity`, `stripLabel`, `clean`) can create duplicate Products.
  Add the case to `n8n/tests/split-quantity.test.js`.
- Tests are plain `node n8n/tests/<file>.test.js`. Cases are real WhatsApp
  messages; keep them real, do not invent tidy ones.
- The classify patch file is a patch, not full source. If you can export the
  full node, replace the patch with it rather than transcribing by hand.
