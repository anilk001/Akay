#!/usr/bin/env python3
"""PT. Surya Graha Pasaraya price lists -> Akay Offers import rows.

The generic intake_pricelist.py assumes one header row at the top of the
sheet and one product per row. Neither Surya Graha workbook is shaped that
way, so this parser handles the two real layouts:

  LOREAL_GARNIER_1.xlsx / "Daftar Harga"
      Header on row 1, data from row 7, with brand/range section rows
      interleaved (no barcode, price blank or 0). Brand comes from the
      SIGN column, not the BRAND column (which holds the product range).

  ELLIPS_1.xlsx / "HPC"
      Header on row 9, one block per product with continuation rows that
      carry only a pack/format + price. PRODUCTS and VARIANT forward-fill
      down those continuation rows. The column labelled "volume" holds a
      format word ("Jar", "Blister") as often as a real volume, and the
      numeric units-per-case sits in the UNLABELLED column beside it.

Prices in both files are per case, in USD - established from the price
cells' number format ([$$-409]) and cross-checked against pack size, not
guessed. Rows that cannot be priced are reported, never dropped.

Usage: python3 intake_surya_graha.py <loreal.xlsx> <ellips.xlsx> [--outdir DIR]
Writes surya-graha-akay-import.csv + surya-graha-skipped.csv.
"""
import sys, os, csv, re, json
from openpyxl import load_workbook

SUPPLIER = "PT. Surya Graha Pasaraya"
OFFER_DATE = "2026-08-26"
MARGIN = 0.05
AUTO_EXPIRY_DAYS = 30
CURRENCY = "USD"
PRICE_TYPE = "Per Case"
INCOTERM = "FOB"
WAREHOUSE = "Jakarta"
CATEGORY = "Toiletries"

OUT_COLS = ["Offer Name", "Brand", "Product Name", "Variant", "Volume ML",
            "PCS/Case", "Unit Type", "Buy Price", "Currency", "Price Type",
            "Category", "Incoterm", "Warehouse", "EAN Unit", "Margin %",
            "Auto Expiry Days", "Offer Date", "Source Sheet",
            "Claude Review Status", "Notes", "Review Flags"]

# SIGN code -> real brand. The BRAND column holds the product range
# ("SKIN NATURALS FACE"), which is not a brand and not a variant.
SIGN_BRAND = {
    "GAR": "Garnier",
    "OAP": "L'Oreal Paris",
    "MRE": "L'Oreal Paris",   # Magic Retouch range
    "MYB": "Maybelline",
}

# Supplier packaging word -> Offers.Unit Type. Tube and Sachet were added to
# the field on 2026-08-26 (Anil) because they are the two commonest forms in
# this catalogue - 199 tube lines and 114 sachet lines - and folding them into
# "Piece" threw away the part a buyer actually asks about. The remaining
# oddments (ampoule, pen, pump, bag) stay as Piece and blister/hanger/renceng
# as Pack; the exact supplier word is preserved in Notes either way.
UNIT_MAP = {
    "BOTTLE": "Bottle", "BOTOL": "Bottle",
    "CAN": "Can",
    "JAR": "Jar",
    "TUBE": "Tube",
    "SACHET": "Sachet",
    "BOX": "Pack", "BOKS": "Pack", "PACK": "Pack", "BUNDLE": "Pack",
    "BLISTER": "Pack", "HANGER": "Pack", "RENCENG": "Pack",
    "PCS": "Piece", "AMPOULE": "Piece",
    "PEN": "Piece", "PUMP": "Piece", "BAG": "Piece",
}


def clean(v):
    return "" if v is None else str(v).strip()


def sheet_name(path):
    """Basename without the upload hash prefix the harness prepends."""
    return re.sub(r"^[0-9a-f]{8}-", "", os.path.basename(path))


def parse_volume_ml(text):
    """Volume in ml from a product description. Returns (ml, flag).

    Conservative on purpose: anything it cannot read unambiguously comes
    back blank with a flag rather than a number that might be wrong.
    Public Spec already guards its separators against a blank volume.
    """
    s = clean(text)
    if not s:
        return None, ""

    # Bundles and value sets ("BDL", "BOGOF", "VS ...", "FREE", "GRATIS") hold
    # two DIFFERENT products, so their two volumes must not be added together -
    # a 280ml bottle plus a 170ml bottle is not a 450ml unit.
    if re.search(r"\b(BDL|BOGOF|VS)\b|\bFREE\b|\bGRATIS\b", s, re.I):
        vols = re.findall(r"(\d+(?:[.,]\d+)?)\s*ML", s, re.I)
        if len(vols) > 1:
            return None, (f"bundle/value set of separate items ({', '.join(vols)} ml) "
                          f"- Volume ML left blank rather than summed")

    # "1.5 ML x 12" / "1.5ML x 12" -> a multipack: total content volume.
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*ML\s*[xX]\s*(\d+)", s, re.I)
    if m:
        total = float(m.group(1).replace(",", ".")) * int(m.group(2))
        return round(total, 2), f"volume {total:g}ml derived from multipack '{m.group(0)}'"

    # "300+100ml" -> base + bonus, sold as one unit.
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*\+\s*(\d+(?:[.,]\d+)?)\s*ML", s, re.I)
    if m:
        total = float(m.group(1).replace(",", ".")) + float(m.group(2).replace(",", "."))
        return round(total, 2), f"volume {total:g}ml = base+bonus '{m.group(0)}'"

    # Plain "400ML", "100.0MLT" (T = tube), "9 ML".
    hits = re.findall(r"(\d+(?:[.,]\d+)?)\s*ML\b T?|(\d+(?:[.,]\d+)?)\s*MLT?\b", s, re.I)
    vals = []
    for a, b in hits:
        raw = a or b
        if raw:
            vals.append(float(raw.replace(",", ".")))
    if len(vals) == 1:
        return round(vals[0], 2), ""
    if len(vals) > 1:
        return None, f"volume ambiguous - {len(vals)} ml figures in name ({vals})"

    # Grams / weight-based lines legitimately have no ml.
    if re.search(r"\d\s*(GR|G|KG)\b", s, re.I):
        return None, ""
    return None, ""


def unit_type(word, flags):
    w = clean(word).upper()
    if not w:
        flags.append("packaging unit not stated by supplier")
        return ""
    mapped = UNIT_MAP.get(w)
    if not mapped:
        flags.append(f"packaging '{w}' has no Unit Type option - set to Other")
        return "Other"
    return mapped


def strip_brand_prefix(name, sign):
    """Drop the supplier's redundant brand code from the head of the name.

    "GAR BRIGHT COMP BODY LIGHT EXTRA 400ML EB" -> "BRIGHT COMP BODY ...".
    Public Product Description prepends the real Brand, so leaving the code
    in produces "Garnier GAR BRIGHT ...".
    """
    n = re.sub(r"\s+", " ", clean(name))
    for token in (clean(sign).upper(), "GAR", "MYB", "OAP", "MRE", "LOREAL", "L'OREAL"):
        if token and n.upper().startswith(token + " "):
            return n[len(token):].strip()
    return n


def offer_name(brand, name, pcs, ml, code):
    pack = ""
    if pcs and ml:
        pack = f" {int(pcs)}x{ml:g}ml"
    elif pcs:
        pack = f" {int(pcs)}pk"
    tail = f" [{code}]" if code else ""
    return f"{brand} {name}{pack}{tail} - {SUPPLIER} {OFFER_DATE}".strip()


def parse_loreal(path):
    """LOREAL/GARNIER/MAYBELLINE sheet -> (rows, skipped)."""
    ws = load_workbook(path, data_only=True)["Daftar Harga"]
    src = f"{sheet_name(path)} - Daftar Harga"
    rows, skipped = [], []
    section = ""

    for i, r in enumerate(ws.iter_rows(min_col=1, max_col=10, values_only=True), start=1):
        if i == 1 or not any(x is not None for x in r):
            continue
        sign, rng, kategori, barcode, code, name, pcs, unit, price, remarks = r
        name_s = clean(name)
        barcode_s = clean(barcode)
        if barcode_s == "-":        # the sheet uses "-" as a blank placeholder
            barcode_s = ""

        # Section / banner rows: a name but no barcode. They label the block
        # that follows, so keep the label and move on.
        if not barcode_s:
            if name_s and name_s != "-":
                section = name_s
            continue
        if name_s in ("", "-"):
            skipped.append((i, src, "row has a barcode but no product name", repr(r)))
            continue

        try:
            price_f = float(price) if price is not None else 0.0
        except (TypeError, ValueError):
            price_f = 0.0
        if price_f <= 0:
            skipped.append((i, src, f"no FOB price (cell = {price!r}) - not priceable",
                            f"{name_s} | {barcode_s}"))
            continue

        flags = []
        brand = SIGN_BRAND.get(clean(sign).upper())
        if not brand:
            brand = "L'Oreal Paris"
            flags.append(f"brand code {clean(sign)!r} unrecognised - defaulted to L'Oreal Paris")

        try:
            pcs_i = int(float(pcs)) if pcs is not None else None
        except (TypeError, ValueError):
            pcs_i = None
        if not pcs_i:
            flags.append("units per case not stated - price kept as Per Case, PCS/Case blank")

        ml, vflag = parse_volume_ml(name_s)
        if vflag:
            flags.append(vflag)
        ut = unit_type(unit, flags)
        clean_name = strip_brand_prefix(name_s, sign)

        pcs_txt = f"{pcs_i}" if pcs_i else clean(pcs)
        bits = [f"{SUPPLIER}, Indonesia. FOB Jakarta, USD/case (currency read from "
                f"the price cell's [$$-409] format, cross-checked vs pack size).",
                f"Src: {src} r{i}; {clean(rng)}; {clean(kategori)}; SKU {clean(code)}; "
                f"raw '{name_s}'; {pcs_txt} {clean(unit)}/case @ USD {price_f:.4f}."]
        if remarks:
            bits.append(f"Supplier remark: {clean(remarks)}.")
        if flags:
            bits.append(f"Review: {'; '.join(flags)}.")
        bits.append("Trust Score Unknown -> held at Awaiting Approval.")
        bits.append(f"Claude Code ingest {OFFER_DATE}: +5% margin, 30d auto-expiry.")
        note = bits

        rows.append({
            "Offer Name": offer_name(brand, clean_name, pcs_i, ml, clean(code)),
            "Brand": brand,
            "Product Name": clean_name,
            "Variant": "",
            "Volume ML": ml if ml else "",
            "PCS/Case": pcs_i or "",
            "Unit Type": ut,
            "Buy Price": round(price_f, 2),
            "Currency": CURRENCY,
            "Price Type": PRICE_TYPE,
            "Category": CATEGORY,
            "Incoterm": INCOTERM,
            "Warehouse": WAREHOUSE,
            "EAN Unit": barcode_s,
            "Margin %": MARGIN,
            "Auto Expiry Days": AUTO_EXPIRY_DAYS,
            "Offer Date": OFFER_DATE,
            "Source Sheet": src,
            "Claude Review Status": "Pending Review" if flags else "Not Required",
            "Notes": " ".join(note),
            "Review Flags": " | ".join(flags),
        })
    return rows, skipped


def parse_ellips(path):
    """ELLIPS sheet -> (rows, skipped). Handles forward-filled blocks."""
    ws = load_workbook(path, data_only=True)["HPC"]
    src = f"{sheet_name(path)} - HPC"
    rows, skipped = [], []
    cur_name = cur_variant = ""
    started = False

    for i, r in enumerate(ws.iter_rows(min_col=2, max_col=9, values_only=True), start=1):
        if not any(x is not None for x in r):
            continue
        no, product, variant, vol, pcs, pcs_text, packaging, price = r

        if clean(no).upper() == "NO":       # the header row
            started = True
            continue
        if not started:
            continue
        # Brand banner row ("ELLIPS" alone in the NO column).
        if clean(no) and price is None and product is None:
            continue

        if clean(product):
            cur_name = clean(product)
            cur_variant = clean(variant)     # a new block resets the variant
        elif clean(variant):
            cur_variant = clean(variant)     # continuation row with its own variant
        if not cur_name:
            skipped.append((i, src, "price row before any product name", repr(r)))
            continue

        try:
            price_f = float(price) if price is not None else 0.0
        except (TypeError, ValueError):
            price_f = 0.0
        if price_f <= 0:
            skipped.append((i, src, f"no FOB price (cell = {price!r}) - not priceable",
                            f"{cur_name} | {clean(vol)}"))
            continue

        flags = []
        try:
            pcs_i = int(float(pcs)) if pcs is not None else None
        except (TypeError, ValueError):
            pcs_i = None
        if not pcs_i:
            flags.append("units per case not stated - price kept as Per Case, PCS/Case blank")

        # The "volume" column holds a format word as often as a volume.
        ml, vflag = parse_volume_ml(vol)
        if vflag:
            flags.append(vflag)
        ut = unit_type(packaging, flags)

        # "12 Renceng (144 Sachet)" - the case holds 12 strips of 12 sachets.
        pcs_text_s = re.sub(r"\s+", " ", clean(pcs_text))
        if pcs_text_s and re.search(r"\(", pcs_text_s):
            flags.append(f"pack stated as '{pcs_text_s}' - PCS/Case set to the "
                         f"outer count ({pcs_i}), inner count kept in Notes")

        name_clean = re.sub(r"\s+", " ", cur_name).strip()
        brand = "Ellips"
        display = strip_brand_prefix(name_clean, "ELLIPS")

        bits = [f"{SUPPLIER}, Indonesia. FOB Jakarta, USD/case (currency read from "
                f"the price cell's [$$-409] format, cross-checked vs pack size).",
                f"Src: {src} r{i}; raw '{name_clean} | {cur_variant} | {clean(vol)} | "
                f"{pcs_text_s or clean(pcs)} | {clean(packaging)}' @ USD {price_f:.4f}."]
        if flags:
            bits.append(f"Review: {'; '.join(flags)}.")
        bits.append("Trust Score Unknown -> held at Awaiting Approval.")
        bits.append(f"Claude Code ingest {OFFER_DATE}: +5% margin, 30d auto-expiry.")
        note = bits

        rows.append({
            "Offer Name": offer_name(brand, f"{display} {cur_variant}".strip(), pcs_i, ml, ""),
            "Brand": brand,
            "Product Name": display,
            "Variant": cur_variant,
            "Volume ML": ml if ml else "",
            "PCS/Case": pcs_i or "",
            "Unit Type": ut,
            "Buy Price": round(price_f, 2),
            "Currency": CURRENCY,
            "Price Type": PRICE_TYPE,
            "Category": CATEGORY,
            "Incoterm": INCOTERM,
            "Warehouse": WAREHOUSE,
            "EAN Unit": "",
            "Margin %": MARGIN,
            "Auto Expiry Days": AUTO_EXPIRY_DAYS,
            "Offer Date": OFFER_DATE,
            "Source Sheet": src,
            "Claude Review Status": "Pending Review" if flags else "Not Required",
            "Notes": " ".join(note),
            "Review Flags": " | ".join(flags),
        })
    return rows, skipped


# --- Airtable payload -------------------------------------------------------
# Offers table tbljBgWrnIMZzkSAr in base appaDSdZkAE9PGkjT. Writes go through
# field IDs, not names, so a renamed column cannot silently retarget a write.
BASE_ID = "appaDSdZkAE9PGkjT"
OFFERS_TABLE = "tbljBgWrnIMZzkSAr"
SUPPLIER_REC = "recgASY79WNBnEtmh"
F = {
    "Offer Name": "fldGWVeOeRVx4QCZY", "Status": "fld89AoUTM1bmodUh",
    "Offer Date": "fldLYBvB0fqPieIzy", "Category": "fldTtKrLE1V8cy9vP",
    "Product Name": "fldMzFSfn2N2Zs4pc", "Brand": "fldYth0xP4Y2E0PX3",
    "Variant": "fldovL744uQCbudc1", "Volume ML": "fldYdSdwuuDvgyvl8",
    "PCS/Case": "fldgSRnqU8p8MSXz6", "Unit Type": "fldfyt0we8c6PyL4Q",
    "Buy Price": "fldAMyazuwdF0er4Z", "Currency": "fldtwN4KVNYKNjQAS",
    "Price Type": "fldzvpIrAsxy2MCZi", "Margin %": "fldZgkcipwuy0A2jt",
    "Warehouse": "fld3BGW7IiR8BSqo4", "Incoterm": "fld7rAOcrqvTO32vL",
    "EAN Unit": "fldaVy0kx4lBYBhDC", "Source Sheet": "fld5sV2190DuRhnjx",
    "Notes": "fldSWiPrQaKv56upV", "Auto Expiry Days": "fldFWjcuxbd8ZCW8l",
    "Supplier": "fldi2bu6fbr3BQSE3",
    "Offer Approval Status": "fldosc71syHTiAM4w",
    "Claude Review Status": "fldHkQCJFijh9RNgH",
}
# Deliberately NOT written: Listing Approved (flddRGgVMAoI6Q2gX) is a
# human-only website gate - Anil or Annika tick it. Nothing automated may.


def write_airtable_batches(rows, outdir, size=25):
    """Emit create_records_for_table payloads, 50 records per file."""
    batches = []
    for row in rows:
        f = {
            F["Offer Name"]: row["Offer Name"],
            F["Status"]: "Live",
            F["Offer Date"]: OFFER_DATE,
            F["Category"]: row["Category"],
            F["Brand"]: row["Brand"],
            F["Product Name"]: row["Product Name"],
            F["Buy Price"]: row["Buy Price"],
            F["Currency"]: row["Currency"],
            F["Price Type"]: row["Price Type"],
            F["Margin %"]: MARGIN,
            F["Auto Expiry Days"]: AUTO_EXPIRY_DAYS,
            F["Incoterm"]: INCOTERM,
            F["Warehouse"]: WAREHOUSE,
            F["Source Sheet"]: row["Source Sheet"],
            F["Notes"]: row["Notes"],
            F["Supplier"]: [SUPPLIER_REC],
            # Supplier Trust Score is Unknown, so the offer is held rather
            # than auto-approved - same rule the ingestion pipelines apply.
            F["Offer Approval Status"]: "Awaiting Approval",
            F["Claude Review Status"]: row["Claude Review Status"],
        }
        if row["Variant"]:
            f[F["Variant"]] = row["Variant"]
        if row["Volume ML"]:
            f[F["Volume ML"]] = float(row["Volume ML"])
        if row["PCS/Case"]:
            f[F["PCS/Case"]] = int(row["PCS/Case"])
        if row["Unit Type"]:
            f[F["Unit Type"]] = row["Unit Type"]
        if row["EAN Unit"]:
            f[F["EAN Unit"]] = row["EAN Unit"]
        batches.append({"fields": f})

    paths = []
    for i in range(0, len(batches), size):
        chunk = batches[i:i + size]
        p = os.path.join(outdir, f"airtable-batch-{i // size + 1:02d}.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(chunk, fh, ensure_ascii=False)
        paths.append(p)
    print(f"airtable payloads: {len(paths)} batches of <= {size} -> {outdir}")
    return paths


def main():
    argv = sys.argv[1:]
    outdir = "."
    if "--outdir" in argv:
        idx = argv.index("--outdir")
        outdir = argv[idx + 1]
        del argv[idx:idx + 2]
    args = [a for a in argv if not a.startswith("--")]
    rows, skipped = [], []
    for p in args:
        base = os.path.basename(p).upper()
        got, skip = (parse_ellips(p) if "ELLIPS" in base else parse_loreal(p))
        print(f"{os.path.basename(p)}: {len(got)} priceable, {len(skip)} skipped")
        rows += got
        skipped += skip

    # The supplier's sheet repeats a handful of lines verbatim. Collapse an
    # exact duplicate (same SKU, name, pack and price) so it does not become
    # two identical offers; anything that differs is a real second config.
    unique, dupes = [], 0
    fingerprints = set()
    for row in rows:
        fp = (row["EAN Unit"], row["Product Name"], row["Variant"],
              row["PCS/Case"], row["Buy Price"])
        if fp in fingerprints:
            dupes += 1
            continue
        fingerprints.add(fp)
        unique.append(row)
    rows = unique
    print(f"collapsed {dupes} duplicate line(s) repeated verbatim in the source")

    # Offer Name is the primary field; keep it unique so nothing collides.
    seen = {}
    for row in rows:
        key = row["Offer Name"]
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            row["Offer Name"] = f"{key} #{seen[key]}"

    dst = os.path.join(outdir, "surya-graha-akay-import.csv")
    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=OUT_COLS)
        w.writeheader()
        w.writerows(rows)
    sdst = os.path.join(outdir, "surya-graha-skipped.csv")
    with open(sdst, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["row", "source", "reason", "raw"])
        w.writerows(skipped)
    with open(os.path.join(outdir, "surya-graha-records.json"), "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)

    write_airtable_batches(rows, outdir)

    flagged = [r for r in rows if r["Review Flags"]]
    print(f"\nOK: {len(rows)} offer rows -> {dst}")
    print(f"FLAGGED for review: {len(flagged)}")
    print(f"SKIPPED (not priceable, nothing drops silently): {len(skipped)} -> {sdst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
