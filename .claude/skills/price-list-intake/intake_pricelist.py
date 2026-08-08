#!/usr/bin/env python3
"""Supplier price list -> Akay Offers import CSV. See SKILL.md."""
import sys, csv, re, io, os

OUT_COLS = ["Brand","Product Name","Variant","Volume ML","PCS/Case","Unit Type",
            "Buy Price","Currency","Price Type","Stock Cases","MOQ","Incoterm",
            "Warehouse","BBD","Notes","Supplier Name"]
CURR = {"€":"EUR","£":"GBP","$":"USD","EUR":"EUR","GBP":"GBP","USD":"USD"}

def parse_pack(text):
    m = re.search(r"(\d+)\s*[x/×]\s*(\d+(?:[.,]\d+)?)\s*(ml|cl|l|gr|g|kg)?", str(text), re.I)
    if not m: return None, None, None
    n = int(m.group(1)); size = float(m.group(2).replace(",", ".")); unit = (m.group(3) or "ml").lower()
    ml = size * (10 if unit == "cl" else 1000 if unit in ("l",) else 1)
    return n, (ml if unit in ("ml","cl","l") else None), unit

def parse_price(text):
    s = str(text).strip()
    cur = next((CURR[k] for k in CURR if k in s.upper() or k in s), None)
    m = re.search(r"(\d+(?:[.,]\d+)?)", s.replace(" ", ""))
    return (float(m.group(1).replace(",", ".")) if m else None), cur

def guess_unit_type(name, ml):
    n = str(name).lower()
    if "can" in n or (ml and ml <= 568 and any(w in n for w in ("beer","energy","cola","monster","lager"))): return "Can"
    if ml and ml >= 330 and any(w in n for w in ("cl","vodka","gin","whisk","rum","wine","70","75")): return "Bottle"
    return "Piece"

def split_variants(name):
    m = re.split(r"\s+[-—]\s+", str(name), maxsplit=1)
    if len(m) == 2 and m[1].count(",") >= 2: return m[0].strip(), m[1].strip()
    if str(name).count(",") >= 3:
        head, tail = str(name).split(",", 1)
        return head.strip(), tail.strip()
    return str(name).strip(), ""

def pick(row, *keys):
    for want in keys:
        for k in row:
            if k and want in k.lower(): return row[k]
    return ""

def convert(path, supplier=""):
    if path.lower().endswith(".xlsx"):
        from openpyxl import load_workbook
        ws = load_workbook(path, data_only=True).active
        raw = list(ws.values)
        headers = [str(h or "") for h in raw[0]]
        rows = [dict(zip(headers, r)) for r in raw[1:] if any(r)]
    else:
        rows = list(csv.DictReader(open(path, newline="", encoding="utf-8-sig")))
    out, skipped = [], []
    for i, r in enumerate(rows, start=2):
        name_raw = pick(r, "product", "description", "item", "name")
        price_raw = pick(r, "price", "cost", "eur", "usd", "gbp")
        if not name_raw or not price_raw:
            skipped.append((i, "no name or price")); continue
        price, cur = parse_price(price_raw)
        if not price:
            skipped.append((i, f"unparsable price: {price_raw!r}")); continue
        pack_src = pick(r, "pack", "size", "format", "packing") or name_raw
        n, ml, _ = parse_pack(pack_src)
        name, variant = split_variants(name_raw)
        qty_raw = pick(r, "qty", "quantity", "stock", "cases", "avail")
        qty, note = "", ""
        if qty_raw:
            qm = re.search(r"(\d+(?:[.,]\d+)?)", str(qty_raw).replace(",", ""))
            if not qm:
                note = f"qty unparsable: {qty_raw!r}"
            else:
                q = float(qm.group(1))
                if q == int(q): qty = int(q)
                elif n: qty = int(q // n); note = f"qty {qty_raw} looked like units; /{n}"
                else: qty = int(q)
        ptype_raw = str(pick(r, "price type", "per")).lower()
        if "case" in ptype_raw: ptype = "Per Case"
        elif any(w in ptype_raw for w in ("unit","piece","bottle","can")): ptype = "Per Piece"
        elif n and price and price < 5 and n > 1: ptype = "Per Piece"; note += " | price-type guessed Per Piece (low price)"
        elif n: ptype = "Per Case"; note += " | price-type guessed Per Case"
        else: ptype = ""
        brand = pick(r, "brand") or name.split()[0]
        out.append({"Brand": brand, "Product Name": name, "Variant": variant,
            "Volume ML": int(ml) if ml else "", "PCS/Case": n or "",
            "Unit Type": guess_unit_type(name, ml), "Buy Price": price,
            "Currency": cur or "", "Price Type": ptype, "Stock Cases": qty,
            "MOQ": pick(r, "moq"), "Incoterm": pick(r, "incoterm", "terms"),
            "Warehouse": pick(r, "warehouse", "location"), "BBD": pick(r, "bbd", "expiry", "best before"),
            "Notes": note.strip(" |"), "Supplier Name": supplier})
    dst = os.path.splitext(path)[0] + "-akay-import.csv"
    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS); w.writeheader(); w.writerows(out)
    print(f"OK: {len(out)} rows -> {dst}")
    flagged = [o for o in out if o["Notes"]]
    if flagged: print(f"FLAGGED (review before import): {len(flagged)}")
    for o in flagged[:10]: print(f"  - {o['Product Name']}: {o['Notes']}")
    if skipped:
        print(f"SKIPPED {len(skipped)} (fix and re-run - nothing drops silently):")
        for i, why in skipped[:10]: print(f"  - row {i}: {why}")
    return dst

if __name__ == "__main__":
    sup = ""
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--supplier" in sys.argv: sup = sys.argv[sys.argv.index("--supplier")+1]
    convert(args[0], sup)
