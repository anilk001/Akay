#!/usr/bin/env python3
"""Push an Akay import CSV into the Airtable Offers table.

Checks the live table schema first and refuses to write unless every column it
is asked to send exists in the base - a typo in a field name would otherwise be
silently dropped by the API and the offer would land half-empty.

  export AIRTABLE_TOKEN=pat...            # needs data.records:write + schema.bases:read
  python3 push_to_airtable.py <import.csv>            # dry run: shows what would be sent
  python3 push_to_airtable.py <import.csv> --commit   # actually creates the records

Options: --base, --table, --limit N (first N rows, for a trial import),
--skip-columns "A,B" (working columns you do not want in Airtable).
"""
import argparse, csv, json, os, sys, time, urllib.request, urllib.error

API = "https://api.airtable.com/v0"
# Working columns from the intake step. They are useful in the CSV but are not
# offer data, so they stay out of Airtable unless asked for.
DEFAULT_SKIP = ["Source List", "Source Row"]
NUMERIC = {"Volume ML", "PCS/Case", "Buy Price", "Buy Price Unit", "Margin %",
           "Sell Price Per Case", "Sell Price Per Unit", "Stock Cases", "MOQ"}
BOOLEAN = {"Featured"}


def request(url, token, method="GET", payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:400]
            if e.code == 429 and attempt < 4:        # documented rate limit: 5 req/s
                time.sleep(2 ** attempt * 1.5)
                continue
            raise SystemExit(f"Airtable {e.code} on {method} {url}\n{body}")
        except urllib.error.URLError as e:
            raise SystemExit(f"Cannot reach Airtable ({e.reason}). If this session is "
                             "sandboxed, api.airtable.com has to be allowed first.")


def typed(field, value):
    if value == "":
        return None
    if field in NUMERIC:
        try:
            return float(value) if "." in value else int(value)
        except ValueError:
            return value
    if field in BOOLEAN:
        return value.strip().lower() in ("yes", "true", "1")
    return value


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--base", default=os.environ.get("AIRTABLE_BASE_ID", "appaDSdZkAE9PGkjT"))
    ap.add_argument("--table", default=os.environ.get("AIRTABLE_OFFERS_TABLE", "Offers"))
    ap.add_argument("--commit", action="store_true", help="write for real (default is a dry run)")
    ap.add_argument("--limit", type=int, help="only the first N rows - use for a trial import")
    ap.add_argument("--skip-columns", default=",".join(DEFAULT_SKIP))
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.csv_path, newline="", encoding="utf-8-sig")))
    if args.limit:
        rows = rows[:args.limit]
    skip = {c.strip() for c in args.skip_columns.split(",") if c.strip()}
    columns = [c for c in (rows[0].keys() if rows else []) if c not in skip]
    print(f"{len(rows)} rows, {len(columns)} columns from {args.csv_path}")

    token = os.environ.get("AIRTABLE_TOKEN") or os.environ.get("Airtable_Pat")
    if not token:
        print("\nNo AIRTABLE_TOKEN set - showing the first record only, nothing sent.")
        print(json.dumps({"fields": {c: typed(c, rows[0][c]) for c in columns
                                     if rows[0][c] != ""}}, indent=2))
        return 0

    # 1. the base has to have every field, or the write loses data silently
    schema = request(f"{API}/meta/bases/{args.base}/tables", token)
    table = next((t for t in schema["tables"]
                  if args.table in (t["name"], t["id"])), None)
    if not table:
        raise SystemExit(f"No table {args.table!r} in base {args.base}")
    existing = {f["name"] for f in table["fields"]}
    missing = [c for c in columns if c not in existing]
    if missing:
        print("\nThese CSV columns do not exist in the Offers table:")
        for m in missing:
            print(f"  - {m}")
        print("\nAdd them to the table (or pass them to --skip-columns), then re-run.")
        print("Nothing was written.")
        return 1
    print(f"schema ok - all {len(columns)} columns exist in {table['name']}")

    # 2. write in batches of 10, the API maximum
    if not args.commit:
        print("\nDry run - re-run with --commit to create these records.")
        return 0
    created = 0
    for i in range(0, len(rows), 10):
        batch = [{"fields": {c: typed(c, r[c]) for c in columns if r[c] != ""}}
                 for r in rows[i:i + 10]]
        res = request(f"{API}/{args.base}/{args.table}", token, "POST",
                      {"records": batch, "typecast": True})
        created += len(res["records"])
        print(f"  created {created}/{len(rows)}", end="\r", flush=True)
        time.sleep(0.25)                              # stay under 5 requests/second
    print(f"\nDone: {created} records created in {table['name']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
