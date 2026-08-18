#!/usr/bin/env python3
"""Preflight the Akay offer dispatch BEFORE ticking "Queued for Dispatch".

Every gate the "Offer Dispatch - Akay" n8n workflow applies is re-checked here,
plus the content checks that decide whether the email a client receives is
actually usable. The point is to fail on a laptop in two seconds instead of
halting silently at 08:00 the next morning, or emailing 377 buyers a price with
no basis.

Input: JSON on stdin or a file path. Either a bare array of Offer records, or

    {"offers": [...], "clients": [...], "backups": [...]}

Records may be Airtable-API shaped ({"id": "rec...", "fields": {...}}), Gate Check
shaped ({"offerId": ..., "offerFields": {...}}), or flat objects with field names
as keys — so one export drives this and compose_preview.cjs both. Field NAMES are
used throughout, never field IDs.

    python3 preflight_dispatch.py dispatch.json
    python3 preflight_dispatch.py < dispatch.json

Exit status 0 = clear to queue. 1 = at least one BLOCKER. 2 = bad input.
Warnings never fail the run; they are the things a trader should look at.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone

# The dispatch workflow reads these and nothing else. Anything not listed is
# internal and must never reach a client.
PUBLIC_FIELDS = [
    "Public Product Description",
    "Public Spec",
    "Price Per Unit & Case",
    "Price Display",
    "Bond/Customs Status",
    "Stock Display",
    "Availability",
    "Lead Time",
    "MOQ",
    "Public Terms",
    "Public Note",
]

# Build Recipients hard-asserts these are identical across bundle members.
BUNDLE_AUDIENCE_FIELDS = [
    "Target Capsule Tags",
    "Target Countries",
    "Bond/Customs Status",
    "Match Interest Category",
    "Category",
]

INTERNAL_ADDRESSES = ["info@akay.ie", "kai@akay.ie"]
NO_MAILING_TAG = "no mailing"
COUNTRY_ALIASES = {"prchina": "china", "cn": "china", "roc": "taiwan", "tw": "taiwan"}

SEVERITY_ORDER = {"BLOCKER": 0, "WARNING": 1}


class Finding:
    def __init__(self, severity: str, offer: str, issue: str, fix: str) -> None:
        self.severity = severity
        self.offer = offer
        self.issue = issue
        self.fix = fix

    def __str__(self) -> str:
        return f"[{self.severity}] {self.offer}: {self.issue} -> {self.fix}"


# ---------------------------------------------------------------- field access


def fields_of(record: dict) -> dict:
    """Accept Airtable's {"fields": …}, the workflow's {"offerFields": …}, or a flat row."""
    for key in ("fields", "offerFields"):
        inner = record.get(key)
        if isinstance(inner, dict):
            return inner
    return record


def id_of(record: dict):
    return record.get("id") or record.get("offerId")


def plain(value) -> str:
    """Flatten an Airtable cell to a comparable string, as the workflow does."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else ""
    if isinstance(value, list):
        return ", ".join(p for p in (plain(v) for v in value) if p)
    if isinstance(value, dict):
        return str(value.get("name", ""))
    return str(value).strip()


def to_list(value) -> list[str]:
    if not value:
        return []
    items = value if isinstance(value, list) else [value]
    return [p for p in (plain(v) for v in items) if p]


def parse_list(value) -> list[str]:
    """Split the comma/semicolon/newline lists the targeting fields hold."""
    return [p.strip().lower() for p in re.split(r"[,;\n]", plain(value)) if p.strip()]


def fold_country(value) -> str:
    squashed = re.sub(r"[.\s_-]", "", plain(value).lower())
    return COUNTRY_ALIASES.get(squashed, squashed)


def squash(value) -> str:
    return re.sub(r"[^a-z0-9]", "", plain(value).lower())


def label_of(record: dict) -> str:
    f = fields_of(record)
    name = plain(f.get("Offer Name")) or plain(f.get("Public Product Description")) or "(unnamed)"
    rec_id = id_of(record)
    return f"{name} [{rec_id}]" if rec_id else name


def as_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------- gate re-checks


def check_send_eligible(record: dict, out: list[Finding]) -> bool:
    """The four conditions of the Send Eligible formula, re-read from the parts."""
    f = fields_of(record)
    label = label_of(record)
    failures = []

    if plain(f.get("Status")) != "Live":
        failures.append(f'Status = "{plain(f.get("Status")) or "blank"}" (needs Live)')
    if plain(f.get("Is Expired")) != "No":
        failures.append(f'Is Expired = "{plain(f.get("Is Expired")) or "blank"}" (needs No)')
    if f.get("Do Not Broadcast"):
        failures.append("Do Not Broadcast is ticked")
    if plain(f.get("Offer Approval Status")) != "Approved":
        failures.append(
            f'Offer Approval Status = "{plain(f.get("Offer Approval Status")) or "blank"}" (needs Approved)'
        )

    if failures:
        out.append(
            Finding(
                "BLOCKER",
                label,
                "not send-eligible: " + "; ".join(failures),
                "fix the field(s) in Airtable; Gate Check halts the dispatch otherwise",
            )
        )
        return False

    # The formula's own verdict must agree with the parts, exactly as Gate Check
    # insists. A disagreement means the formula changed under us.
    verdict = plain(f.get("Send Eligible")).lower()
    if verdict and verdict != "yes":
        out.append(
            Finding(
                "BLOCKER",
                label,
                'every component condition passes but the Send Eligible formula says "%s"' % verdict,
                "the formula and this checker disagree - reconcile before dispatching",
            )
        )
        return False
    return True


def check_backup(backups: list[dict], out: list[Finding], today: date) -> None:
    """Dispatch refuses to run without a Verified backup dated today."""
    if not backups:
        out.append(
            Finding(
                "WARNING",
                "(backup gate)",
                "no Backup Registry records supplied, so the backup gate was not checked",
                "pass Backup Registry rows as \"backups\" to verify this gate offline",
            )
        )
        return

    stamp = today.isoformat()
    for record in backups:
        f = fields_of(record)
        if plain(f.get("Status")).lower() == "verified" and plain(f.get("Backup Date"))[:10] == stamp:
            return

    seen = sorted(
        (plain(fields_of(r).get("Backup Date"))[:10] for r in backups if fields_of(r).get("Backup Date")),
        reverse=True,
    )
    out.append(
        Finding(
            "BLOCKER",
            "(backup gate)",
            f"no Verified Backup Registry entry dated {stamp} (newest: {seen[0] if seen else 'none'})",
            "run Daily Backup - Akay and confirm it lands Verified, then dispatch",
        )
    )


def check_bundle_agreement(members: list[dict], bundle_id: str, out: list[Finding]) -> None:
    if len(members) < 2:
        return
    for field in BUNDLE_AUDIENCE_FIELDS:
        values = {json.dumps(fields_of(m).get(field), sort_keys=True, default=str) for m in members}
        if len(values) > 1:
            out.append(
                Finding(
                    "BLOCKER",
                    f'bundle "{bundle_id}"',
                    f"members disagree on {field}",
                    f"make {field} identical on every line of the bundle, or split it into separate bundles",
                )
            )


def check_targeting_sanity(record: dict, out: list[Finding]) -> None:
    f = fields_of(record)
    label = label_of(record)
    tags = parse_list(f.get("Target Capsule Tags"))
    countries = parse_list(f.get("Target Countries"))

    if NO_MAILING_TAG in tags:
        out.append(
            Finding(
                "BLOCKER",
                label,
                'Target Capsule Tags contains "No Mailing"',
                "No Mailing is an opt-out, never a target - remove it",
            )
        )
    if f.get("Match Interest Category") and not plain(f.get("Category")):
        out.append(
            Finding(
                "BLOCKER",
                label,
                "Match Interest Category is ticked but Category is blank",
                "set Category, or untick Match Interest Category",
            )
        )
    if not countries:
        out.append(
            Finding(
                "WARNING",
                label,
                "Target Countries is blank, so this goes to clients in every country",
                "list the countries you mean, or confirm a worldwide send is intended",
            )
        )
    if not tags:
        out.append(
            Finding(
                "WARNING",
                label,
                "Target Capsule Tags is blank, so no interest filter applies",
                "tag the offer (e.g. \"Indv spirits\") to reach buyers of this category only",
            )
        )


def check_recipients(members: list[dict], clients: list[dict], out: list[Finding], group: str) -> None:
    """Replicates Build Recipients so an empty audience is known in advance."""
    if not clients:
        out.append(
            Finding(
                "WARNING",
                group,
                "no Clients records supplied, so the recipient count was not checked",
                'pass Clients rows as "clients" to see the real audience size before sending',
            )
        )
        return

    f = fields_of(members[0])
    target_tags = parse_list(f.get("Target Capsule Tags"))
    target_countries = [fold_country(c) for c in parse_list(f.get("Target Countries"))]
    match_category = bool(f.get("Match Interest Category"))
    offer_category = plain(f.get("Category")).lower()
    offer_bond = plain(f.get("Bond/Customs Status")).lower()

    matched, seen_emails = [], set()
    for record in clients:
        c = fields_of(record)
        tags = [t.lower() for t in to_list(c.get("Capsule Tags"))]
        if NO_MAILING_TAG in tags or c.get("Do Not Contact"):
            continue
        if plain(c.get("Status")) != "Active":
            continue
        email = plain(c.get("Email")).lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            continue
        if target_tags and not any(t in tags for t in target_tags):
            continue
        if target_countries and fold_country(c.get("Country")) not in target_countries:
            continue
        if match_category:
            interests = [i.lower() for i in to_list(c.get("Interest Categories"))]
            if offer_category not in interests:
                continue
        if offer_bond and offer_bond in [b.lower() for b in to_list(c.get("Excluded Bond Status"))]:
            continue
        if email in seen_emails:
            continue
        seen_emails.add(email)
        matched.append(email)

    if not matched:
        out.append(
            Finding(
                "BLOCKER",
                group,
                f"targeting matches 0 of {len(clients)} clients",
                "widen Target Countries / Target Capsule Tags, or check the spelling against Clients.Country",
            )
        )
    else:
        print(f"  audience: {len(matched)} recipient(s) from {len(clients)} clients", file=sys.stderr)


# ---------------------------------------------------------- content re-checks


def check_leak_guard(record: dict, out: list[Finding]) -> None:
    """The same two defences Compose Email runs, so a trip is never a surprise."""
    f = fields_of(record)
    label = label_of(record)
    hay = " ".join(plain(f.get(name)) for name in PUBLIC_FIELDS).lower()

    for supplier in to_list(f.get("Supplier Name")):
        if len(supplier) >= 4 and supplier.lower() in hay:
            out.append(
                Finding(
                    "BLOCKER",
                    label,
                    f'supplier name "{supplier}" appears in a public field',
                    "remove it - the leak guard halts the whole dispatch on this",
                )
            )

    buy, sell = as_number(f.get("Buy Price")), as_number(f.get("Sell Price"))
    if buy and buy > 0 and (sell is None or abs(sell - buy) > 0.005):
        for form in (f"{buy:.2f}", str(buy)):
            if re.search(rf"(^|[^0-9.]){re.escape(form)}([^0-9]|$)", hay):
                out.append(
                    Finding("BLOCKER", label, f"buy price {form} appears in a public field", "remove it")
                )
                break

    for address in INTERNAL_ADDRESSES:
        if address in hay:
            out.append(
                Finding("BLOCKER", label, f"internal address {address} appears in a public field", "remove it")
            )


def check_price_quality(record: dict, out: list[Finding]) -> None:
    f = fields_of(record)
    label = label_of(record)

    basis_price = plain(f.get("Price Per Unit & Case"))
    bare_price = plain(f.get("Price Display"))
    if not basis_price and not bare_price:
        out.append(
            Finding(
                "BLOCKER",
                label,
                "no price at all (both Price Per Unit & Case and Price Display are empty)",
                "set Buy Price, Margin % and Currency so the price formulas resolve",
            )
        )
    elif not basis_price and not plain(f.get("Price Type")):
        out.append(
            Finding(
                "WARNING",
                label,
                "price would be sent with no basis (Price Per Unit & Case empty and Price Type blank)",
                'set Price Type so the mail can say "/case" or "/bottle" - a bare figure is the most '
                "expensive ambiguity in a trade offer",
            )
        )

    buy, sell = as_number(f.get("Buy Price")), as_number(f.get("Sell Price"))
    margin = as_number(f.get("Margin %"))
    if buy and (margin is None or margin == 0) and (sell is None or abs(sell - buy) <= 0.005):
        out.append(
            Finding(
                "WARNING",
                label,
                f"Margin % is blank/zero, so the quoted price equals the buy price ({buy})",
                "set Margin %, or confirm the margin is already embedded in Buy Price",
            )
        )

    pcs = as_number(f.get("PCS/Case"))
    spec = plain(f.get("Public Spec"))
    if not spec:
        out.append(
            Finding("WARNING", label, "Public Spec is empty, so the mail states no pack format", "set Volume ML and PCS/Case")
        )
    elif re.fullmatch(r"\d+", spec):
        out.append(
            Finding(
                "WARNING",
                label,
                f'Public Spec is the bare number "{spec}" (no unit size)',
                "set Volume ML, or accept that the mail reads \"Pack: %s per case\"" % spec,
            )
        )
    elif not pcs:
        out.append(
            Finding(
                "WARNING",
                label,
                "PCS/Case is blank, so the mail cannot state how many units are in a case",
                "set PCS/Case",
            )
        )


def check_completeness(record: dict, out: list[Finding], today: date) -> None:
    f = fields_of(record)
    label = label_of(record)

    if not plain(f.get("Public Product Description")):
        out.append(
            Finding(
                "BLOCKER",
                label,
                "Public Product Description is empty",
                "set Brand / Product Name so the public title formula resolves",
            )
        )
    if not plain(f.get("MOQ")):
        out.append(Finding("WARNING", label, "MOQ is blank", "state the minimum order to avoid a reply round-trip"))
    availability = plain(f.get("Availability"))
    if not availability and not plain(f.get("Stock Display")):
        out.append(Finding("WARNING", label, "no quantity information", "set Availability or Stock Cases"))
    elif re.match(r"^\s*\d+\s*(day|week|month)s?\b", availability, re.I):
        out.append(
            Finding(
                "WARNING",
                label,
                f'Availability holds a duration ("{availability}"), so the mail reads "Quantity: {availability}"',
                "move it to Lead Time and put the real quantity in Availability",
            )
        )
    if not plain(f.get("Public Terms")):
        out.append(Finding("WARNING", label, "Public Terms is empty", "set Incoterm (and Warehouse if known)"))

    expiry = plain(f.get("Auto Expiry Date"))[:10]
    if not expiry:
        out.append(
            Finding("WARNING", label, "Auto Expiry Date is blank, so the mail states no validity", "set Auto Expiry Days")
        )
    else:
        try:
            parsed = datetime.strptime(expiry, "%Y-%m-%d").date()
        except ValueError:
            return
        if parsed <= today:
            out.append(Finding("BLOCKER", label, f"already expired ({expiry})", "re-date the offer or let it drop out"))
        elif parsed <= today + timedelta(days=3):
            out.append(
                Finding(
                    "WARNING",
                    label,
                    f"expires in under 3 days ({expiry})",
                    "extend the validity, or expect enquiries to arrive after it lapses",
                )
            )


def check_public_note(members: list[dict], out: list[Finding]) -> None:
    """Flag note lines the composer will drop as restatements."""
    f = fields_of(members[0])
    note = plain(f.get("Public Note"))
    if not note:
        return

    figures = set()
    for member in members:
        mf = fields_of(member)
        figures.update(re.findall(r"\d+[.,]\d+", plain(mf.get("Price Per Unit & Case"))))
        figures.update(re.findall(r"\d+[.,]\d+", plain(mf.get("Price Display"))))

    basis_word = re.compile(
        r"\bper\s+(case|carton|box|pack|bottle|can|jar|piece|unit|btl|pc)s?\b|/(case|carton|bottle|can|jar|piece|unit)\b",
        re.I,
    )
    restated_fact = re.compile(
        r"^(terms|incoterms?|delivery terms|minimum order|min order|moq|validity|valid until|price valid)\b\s*[:\-]?", re.I
    )

    dropped = []
    for raw in note.split("\n"):
        line = raw.strip()
        if not line:
            continue
        restates_price = any(fig in line for fig in figures) and (
            basis_word.search(line) or re.match(r"^\s*(\d+[).]|[-*•])\s", raw)
        )
        if restates_price or restated_fact.match(line):
            dropped.append(line)

    if dropped:
        out.append(
            Finding(
                "WARNING",
                label_of(members[0]),
                f"Public Note restates {len(dropped)} fact(s) the mail already prints "
                f'(first: "{dropped[0][:60]}")',
                "trim Public Note to information the product block does not carry; the composer drops "
                "these lines, but a hand-written note is easy to get out of step with the fields",
            )
        )


# ------------------------------------------------------------------ grouping


def group_offers(offers: list[dict]) -> list[tuple[str, list[dict]]]:
    """One dispatch group per Bundle ID; un-bundled offers each form their own.

    Ordered oldest Offer Date first, matching the workflow's group selection so
    the group reported as "this run" is the group that will actually be sent.
    """
    groups: dict[str, list[dict]] = {}
    for index, offer in enumerate(offers):
        bundle = plain(fields_of(offer).get("Bundle ID"))
        groups.setdefault(bundle or f"__single_{index}", []).append(offer)

    def sort_key(item):
        _, members = item
        dates = sorted(plain(fields_of(m).get("Offer Date")) for m in members if plain(fields_of(m).get("Offer Date")))
        return (dates[0] if dates else "9999-99-99", label_of(members[0]))

    return sorted(groups.items(), key=sort_key)


# ---------------------------------------------------------------------- main


def load(source: str | None) -> dict:
    raw = open(source, encoding="utf-8").read() if source else sys.stdin.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"input is not valid JSON: {exc}", file=sys.stderr)
        raise SystemExit(2)
    if isinstance(data, list):
        return {"offers": data}
    if not isinstance(data, dict):
        print("expected a JSON object or array", file=sys.stderr)
        raise SystemExit(2)
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Preflight the Akay offer dispatch.")
    parser.add_argument("input", nargs="?", help="JSON file (default: stdin)")
    parser.add_argument("--today", help="override today's date (YYYY-MM-DD) for the backup/expiry checks")
    args = parser.parse_args()

    data = load(args.input)
    offers = data.get("offers") or []
    if not offers:
        print("no offers in input - nothing to check", file=sys.stderr)
        return 2

    today = (
        datetime.strptime(args.today, "%Y-%m-%d").date()
        if args.today
        else datetime.now(timezone.utc).astimezone().date()
    )

    findings: list[Finding] = []
    check_backup(data.get("backups") or [], findings, today)

    groups = group_offers(offers)
    for position, (bundle_id, members) in enumerate(groups):
        group_label = f'bundle "{bundle_id}"' if not bundle_id.startswith("__single_") else label_of(members[0])
        print(f"group {position + 1}/{len(groups)}: {group_label} ({len(members)} line(s))", file=sys.stderr)

        if position > 0:
            findings.append(
                Finding(
                    "BLOCKER",
                    group_label,
                    "a second dispatch group is queued; one run sends ONE group only",
                    "queue this group on its own run - queueing several means the rest silently wait",
                )
            )

        eligible = all(check_send_eligible(m, findings) for m in members)
        check_bundle_agreement(members, bundle_id, findings)
        for member in members:
            check_targeting_sanity(member, findings)
            check_leak_guard(member, findings)
            check_price_quality(member, findings)
            check_completeness(member, findings, today)
        check_public_note(members, findings)
        if eligible and position == 0:
            check_recipients(members, data.get("clients") or [], findings, group_label)

    findings.sort(key=lambda f: (SEVERITY_ORDER[f.severity], f.offer))
    print()
    for index, finding in enumerate(findings, 1):
        print(f"{index}. {finding}")

    blockers = sum(1 for f in findings if f.severity == "BLOCKER")
    warnings = len(findings) - blockers
    print(f"\n{blockers} blocker(s), {warnings} warning(s) across {len(offers)} offer(s) in {len(groups)} group(s).")
    if blockers:
        print("DO NOT QUEUE. Clear the blockers first - each one halts the dispatch or corrupts the send.")
    else:
        print("Clear to queue: tick 'Queued for Dispatch' on this group, then trigger the workflow.")
    return 1 if blockers else 0


if __name__ == "__main__":
    raise SystemExit(main())
