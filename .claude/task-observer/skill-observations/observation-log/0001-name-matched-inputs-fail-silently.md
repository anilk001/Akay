---
id: 1
title: A checker whose inputs resolve by name match reports PASS when the inputs are missing
status: open
type: open-source
skill: [offer-data-validator, price-list-intake]
proposes_skill: []
siblings_checked: "akay offer-data family: price-list-intake, offer-data-validator — both embed the same first-substring-match pick() helper over caller-supplied column names, so the defect and the fix apply to both; both added. No skill-families.md registry exists yet, so the family was derived from the shared helper and the shared offer-CSV contract."
area: validate_offers.py pick()/validate(); intake_pricelist.py pick()
date: 2026-09-09
session_context: Converting a supplier price list into the Akay import CSV and validating it before import
parked_until:
resolved:
resolution:
reference:
---

**Issue:** The validator resolves each input column by returning the first
header whose name *contains* a search string. When no header matches, it
returns None and every check guarded by that input is skipped — silently. Run
against a freshly generated import CSV it printed `Summary: 0 problems` and
exited 0, while its two most important checks (case-vs-unit price coherence,
and currency validity) had never executed, because the file used different
column names. A clean report and an unrun check are byte-identical on stdout.

A second, subtler failure appeared after adding the expected columns: the
price check still did not run, because a *different* column whose name also
contained the search substring sorted earlier and shadowed the intended one.
The resolver returned a real value, so nothing looked wrong; it was simply the
wrong column, and parsing it produced None further downstream.

Both were found only by deliberately corrupting rows and confirming the
checker complained. Without that negative control the run would have been
reported as a clean validation.

**Suggested improvement:** In `validate_offers.py`, make unresolved inputs
loud rather than silent: collect the columns each check needs, and emit a
`[SKIP] check N: no column matching <names>` line plus a non-zero exit (or an
explicit `checks run: N/6` line in the summary) whenever a check could not
execute. Never let "no problems found" and "no checks ran" print the same
text. Change `pick()` to prefer an exact, normalised header match before
falling back to substring containment, and to report when more than one header
matches so shadowing surfaces instead of silently picking one. Add the same
`checks run` line to the SKILL.md output-format section so the report format
carries the distinction. In the SKILL.md "How to run" section, require a
negative control — corrupt one row, confirm the checker fires — before a clean
result is treated as a pass.

**Principle:** A check that cannot find its input must fail loudly, never
return "nothing wrong". Any instrument that resolves its inputs by name
matching has two failure modes that both present as a pass — the name matched
nothing, and the name matched the wrong thing — so its green result carries no
information until a negative control has shown it can go red on the same input
shape. Treat "prove it fires" as part of running the instrument, not as
optional diligence.
