#!/usr/bin/env python3
"""Push parsed offer rows into the Akay Offers table over the Airtable REST API.

Idempotent by design: it first reads every Offer Name already present for the
source sheets it is about to load, then creates only the rows that are
missing. Re-running after a partial load (or after a failure mid-batch) tops
up the remainder instead of duplicating what is already there.

Needs AIRTABLE_TOKEN with data.records:write (and data.records:read, to do
the top-up check) on base appaDSdZkAE9PGkjT. Read from the environment or
from a .env file beside the repo root. The token is never printed.

Usage:
    python3 push_offers_to_airtable.py <records.json> [--dry-run]

<records.json> is the file written by intake_surya_graha.py, whose entries
are already shaped as {"fields": {fieldId: value}}.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_ID = "appaDSdZkAE9PGkjT"
TABLE_ID = "tbljBgWrnIMZzkSAr"
F_OFFER_NAME = "fldGWVeOeRVx4QCZY"
F_SOURCE_SHEET = "fld5sV2190DuRhnjx"
API = "https://api.airtable.com/v0"
CREATE_CHUNK = 10          # Airtable's own cap for a create request
PAUSE = 0.25               # stay under the 5 req/sec limit


def load_token():
    tok = os.environ.get("AIRTABLE_TOKEN", "").strip()
    if tok:
        return tok
    for path in (".env", os.path.join(os.path.dirname(__file__), "../../../.env")):
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    m = re.match(r"\s*AIRTABLE_TOKEN\s*=\s*(.+)", line)
                    if m:
                        return m.group(1).strip().strip('"').strip("'")
        except OSError:
            continue
    sys.exit("AIRTABLE_TOKEN not set (environment or .env). Needs "
             "data.records:write on the Akay Offers base.")


def request(token, method, url, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:400]
            # 429 is rate limiting, 5xx is transient: back off and retry.
            if e.code in (429, 500, 502, 503) and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"Airtable {e.code} on {method} {url.split('?')[0]}: {body}")
        except urllib.error.URLError as e:
            if attempt < 4:
                time.sleep(2 ** attempt)
                continue
            sys.exit(f"network error talking to Airtable: {e}")


def existing_offer_names(token, sheets):
    """Offer Names already stored for the given Source Sheet values."""
    if not sheets:
        return set()
    clauses = ",".join(
        "{%s}='%s'" % ("Source Sheet", s.replace("'", "\\'")) for s in sorted(sheets)
    )
    formula = f"OR({clauses})"
    names, offset = set(), None
    while True:
        params = {
            "filterByFormula": formula,
            "pageSize": "100",
            "fields[]": "Offer Name",
        }
        if offset:
            params["offset"] = offset
        url = f"{API}/{BASE_ID}/{TABLE_ID}?" + urllib.parse.urlencode(params, doseq=True)
        page = request(token, "GET", url)
        for rec in page.get("records", []):
            got = rec.get("fields", {}).get("Offer Name")
            if got:
                names.add(got)
        offset = page.get("offset")
        if not offset:
            return names


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    if not args:
        sys.exit(__doc__)
    records = json.load(open(args[0], encoding="utf-8"))
    token = load_token()

    sheets = {r["fields"].get(F_SOURCE_SHEET) for r in records}
    sheets.discard(None)
    already = existing_offer_names(token, sheets)
    todo = [r for r in records if r["fields"].get(F_OFFER_NAME) not in already]

    print(f"parsed rows        : {len(records)}")
    print(f"already in Airtable: {len(already)}")
    print(f"to create          : {len(todo)}")
    if dry_run:
        for r in todo[:5]:
            print("  would create:", r["fields"][F_OFFER_NAME][:90])
        return 0
    if not todo:
        print("nothing to do - Airtable already matches the parsed rows")
        return 0

    created = 0
    url = f"{API}/{BASE_ID}/{TABLE_ID}"
    for i in range(0, len(todo), CREATE_CHUNK):
        chunk = todo[i:i + CREATE_CHUNK]
        resp = request(token, "POST", url, {"records": chunk, "typecast": False})
        created += len(resp.get("records", []))
        print(f"  created {created}/{len(todo)}", flush=True)
        time.sleep(PAUSE)
    print(f"done: {created} offers created")
    return 0


if __name__ == "__main__":
    sys.exit(main())
