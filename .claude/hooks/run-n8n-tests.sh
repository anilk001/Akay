#!/bin/bash
# PostToolUse hook: run the WhatsApp classifier tests after any edit under n8n/.
#
# The buy-side guard and quantity splitter are regex-driven; a small tweak can
# silently misclassify supplier offers, so every edit gets an immediate check.
# Exit 2 feeds the failing output back to Claude so it fixes the regression.
set -uo pipefail

file_path=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).tool_input?.file_path??"")}catch{console.log("")}})')

case "$file_path" in
  *"/n8n/"*|n8n/*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}"

fail=0
for t in n8n/tests/*.test.js; do
  [ -e "$t" ] || continue
  if ! out=$(node "$t" 2>&1); then
    echo "n8n test failed: $t" >&2
    echo "$out" >&2
    fail=1
  fi
done

exit $((fail ? 2 : 0))
