#!/bin/bash
# PostToolUse hook: run the site test suite after an edit to anything it
# covers — tests/, src/lib/, src/data/airtable.mjs, scripts/.
#
# The catalogue refresh workflow runs this same suite before it will commit a
# new snapshot, so a test that fails is not "a red check" — it is a site that
# stops updating (2026-09-17: five hours stale over one over-specified
# assertion). Catching it at edit time is the cheapest place.
#
# Exit 2 feeds the failing output back to Claude so it fixes the regression.
set -uo pipefail

file_path=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).tool_input?.file_path??"")}catch{console.log("")}})')

case "$file_path" in
  *"/tests/"*|tests/*|*"/src/lib/"*|src/lib/*|*"/src/data/airtable.mjs"|src/data/airtable.mjs|*"/scripts/"*|scripts/*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}"
[ -d node_modules ] || exit 0   # nothing installed yet; the build step will say so

fail=0
for t in tests/*.test.js; do
  [ -e "$t" ] || continue
  if ! out=$(node "$t" 2>&1); then
    echo "site test failed: $t" >&2
    echo "$out" | tail -n 30 >&2
    fail=1
  fi
done

exit $((fail ? 2 : 0))
