#!/usr/bin/env python3
"""Akay offer rows validator - see SKILL.md for the rule list."""
import sys, csv, io, re

TOL = 0.02
CURRENCIES = {"EUR", "GBP", "USD"}

def parse_pack(s):
    m = re.match(r"\s*(\d+)\s*[xX]\s*([\d.,]*)\s*(ml|cl|l|gr|g|kg)?", str(s or ""))
    if not m:
        return None, None
    n = int(m.group(1))
    size = m.group(2).replace(",", ".")
    return n, (float(size) if size else None)

def fnum(v):
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(",", "").replace(" ", ""))
    except ValueError:
        return None

def pick(row, *names):
    for n in names:
        for k in row:
            if k and n in k.lower().replace("_", " "):
                return row[k]
    return None

def validate(rows):
    problems = []
    for i, row in enumerate(rows, start=2):  # 2 = first data row in a sheet
        brand = (pick(row, "brand") or "").strip()
        name = (pick(row, "product name", "product", "name") or "").strip()
        pack_raw = pick(row, "pack", "size", "format") or ""
        case_p = fnum(pick(row, "price per case", "case price", "price/case", "price case"))
        unit_p = fnum(pick(row, "price per unit", "unit price", "price/unit", "price unit"))
        qty = fnum(pick(row, "cases", "stock", "quantity", "qty"))
        curr = (pick(row, "currency", "curr") or "").strip().upper()
        label = f"{brand or '?'} - {(name[:40] + '...') if len(name) > 40 else (name or '?')}"
        n, size = parse_pack(pack_raw)

        if case_p and unit_p and n and n > 1:
            if abs(case_p - unit_p) < 1e-9:
                problems.append(("PRICE", i, label,
                    f"case price equals unit price ({case_p}) with pack {n}x",
                    f"case should be ~{round(unit_p * n, 2)}"))
            elif abs(case_p - unit_p * n) / max(case_p, 1e-9) > TOL:
                problems.append(("PRICE", i, label,
                    f"case {case_p} != unit {unit_p} x {n} (= {round(unit_p*n,2)})",
                    "check which figure is wrong"))
        if qty is not None and abs(qty - round(qty)) > 1e-9:
            problems.append(("STOCK", i, label,
                f"fractional cases: {qty}", "units entered as cases? divide by pack"))
        if name.count(",") >= 3 or len(re.findall(r"\s[-—]\s", name)) >= 1 and name.count(",") >= 2:
            problems.append(("NAME", i, label,
                "variant list inside product name", "split rows or use a Variants field"))
        if brand and name and len(brand.split()) == 1 and name.lower().startswith(brand.lower() + " ") and brand.lower() in {"the", "el", "la", "le"}:
            problems.append(("BRAND", i, label,
                f"brand looks truncated: '{brand}'", "set the full brand name"))
        if pack_raw and n and size is None:
            problems.append(("PACK", i, label,
                f"pack spec incomplete: '{str(pack_raw).strip()}'", "add unit volume/weight"))
        if (case_p or unit_p) and curr and curr not in CURRENCIES:
            problems.append(("CURR", i, label,
                f"currency '{curr}' not in EUR/GBP/USD", "fix currency"))
        if (case_p or unit_p) and not curr:
            problems.append(("CURR", i, label, "price without currency", "set currency"))

    order = {"PRICE": 0, "STOCK": 1, "NAME": 2, "BRAND": 3, "PACK": 4, "CURR": 5}
    problems.sort(key=lambda p: (order[p[0]], p[1]))
    for sev, rownum, label, issue, fix in problems:
        print(f"[{sev}] row {rownum} ({label}): {issue} -> {fix}")
    counts = {}
    for p in problems:
        counts[p[0]] = counts.get(p[0], 0) + 1
    total = sum(counts.values())
    print(f"\nSummary: {total} problems | " + " | ".join(f"{k}: {v}" for k, v in sorted(counts.items(), key=lambda kv: order[kv[0]])))
    return 1 if counts.get("PRICE") else 0

def load(path=None):
    if path and path.lower().endswith(".xlsx"):
        from openpyxl import load_workbook
        ws = load_workbook(path, data_only=True).active
        rows = list(ws.values)
        headers = [str(h or "") for h in rows[0]]
        return [dict(zip(headers, r)) for r in rows[1:]]
    data = open(path, newline="", encoding="utf-8-sig").read() if path else sys.stdin.read()
    return list(csv.DictReader(io.StringIO(data)))

if __name__ == "__main__":
    sys.exit(validate(load(sys.argv[1] if len(sys.argv) > 1 else None)))
