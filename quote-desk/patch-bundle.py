#!/usr/bin/env python3
"""Patch the deployed quote.akay.ie bundle: AKAY branding + buyer-facing copy.

Display strings only. No logic, no API call, no class name is touched. Every
replacement must match exactly once or the script refuses to write anything.
"""
import sys

SRC, DST = sys.argv[1], sys.argv[2]
LOGO = "https://akay.ie/akay-bird.png"

EDITS = [
    # Header: link the mark home, swap the "TD" placeholder for the AKAY bird.
    ('s.jsxs("div",{className:"flex items-center gap-2.5",children:[',
     's.jsxs("a",{href:"https://akay.ie",className:"flex items-center gap-2.5",children:[' ),
    ('s.jsx("div",{className:"flex size-8 items-center justify-center rounded-lg '
     'bg-accent text-sm font-bold text-accent-ink",children:"TD"})',
     's.jsx("img",{src:"%s",alt:"",width:320,height:279,'
     'className:"shrink-0",style:{height:"32px",width:"auto"}})' % LOGO),
    ('children:"Trade Desk"', 'children:"AKAY"'),
    ('children:"Search & price matching"', 'children:"Live offers & instant pricing"'),

    # Tabs: the page is for buyers, not for running web research.
    ('label:"AI Web Search Chat",short:"Search"', 'label:"Ask AKAY",short:"Ask"'),
    ('label:"Upload Quote/Excel",short:"Quote"', 'label:"Upload your list",short:"Upload"'),

    # Chat empty state.
    ('children:"Ask anything, grounded in live search"',
     'children:"Ask about our offers and prices"'),
    ('children:"Every answer cites the web pages it came from, so you can check '
     'the source before acting on it."',
     'children:"Prices, pack sizes, minimum order and lead time on what we stock '
     '\\u2014 plus anything about AKAY and how we trade."'),

    # Starter prompts: our offers, not general market research.
    ('_y=["Current EU wholesale price trend for Scotch whisky",'
     '"Which countries require excise duty stamps on spirits imports?",'
     '"Recent recalls or bans affecting FMCG confectionery in the EU"]',
     '_y=["What are your best prices this week?",'
     '"What special offers are live right now?",'
     '"Send me your full featured product list"]'),
    ('placeholder:"Ask about prices, regulations, suppliers, markets…"',
     'placeholder:"Ask for our best price, this week\'s special offers, '
     'or the featured product list…"'),

    # Upload tab: addressed to the buyer, and no internal system named.
    ('children:"Upload a customer quote"', 'children:"Upload your buying list"'),
    ('children:"We read the product lines, match them against live Airtable stock, '
     'and show you what each line is worth."',
     'children:"We read every line, match it against our live published offers, '
     'and write our selling price into your own file."'),
    ('children:L?"Matching against Airtable…":"Match prices & stock"',
     'children:L?"Pricing your list…":"Price my list"'),
    ('check them before quoting.', 'check them before ordering.'),
]

js = open(SRC, encoding="utf-8").read()
fail = []
for old, new in EDITS:
    n = js.count(old)
    if n != 1:
        fail.append("%d matches (need 1): %s" % (n, old[:70]))
if fail:
    sys.exit("REFUSED, nothing written:\n  " + "\n  ".join(fail))

for old, new in EDITS:
    js = js.replace(old, new, 1)

open(DST, "w", encoding="utf-8").write(js)
print("patched %d strings -> %s" % (len(EDITS), DST))
