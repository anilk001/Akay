export const prerender = true;

export async function GET() {
  const llmsTxt = `# AKAY Trade — Wholesale Beverage & FMCG Offers

> Live B2B wholesale catalogue from Akay Irl Ltd (Shannon, Ireland). Spirits, beer, soft drinks, grocery and FMCG by the case, pallet and container. Duty-paid (T2) and export/under-bond (T1). Prices indicative, trade buyers only. Enquiries via WhatsApp +353 87 238 2368 or offers@akay.ie.

## Catalogue

- [All live offers](https://akay.ie/): full catalogue, updated continuously
- [Search offers](https://akay.ie/search/): typo-tolerant search with brand, size, pack, bond and warehouse filters
- [Spirits](https://akay.ie/category/spirits/)
- [Beer](https://akay.ie/category/beer/)
- [Soft Drinks](https://akay.ie/category/soft-drinks/)
- [Grocery](https://akay.ie/category/grocery/)
- [Toiletries](https://akay.ie/category/toiletries/)
- [Confectionery](https://akay.ie/category/confectionery/)
- [Wine](https://akay.ie/category/wine/)
- [Champagne](https://akay.ie/category/champagne/)
- [Other FMCG](https://akay.ie/category/other-fmcg/)
- [Brands A–Z](https://akay.ie/brands/): every stocked brand with its live wholesale offers

## Guides

- [T1 vs T2 duty status](https://akay.ie/guides/t1-vs-t2-duty-status/): duty-paid vs under-bond explained for beverage trading
- [Incoterms explained](https://akay.ie/guides/incoterms-exw-dap-cfr/): EXW, FCA, DAP, CIF, FOB, CFR shipping terms
- [How to buy wholesale](https://akay.ie/guides/how-to-buy-wholesale-spirits-eu/): step-by-step wholesale purchasing, MOQs, pricing, enquiry process
- [How to send a requirement list](https://akay.ie/guides/requirement-list-format/): uploading a buying list for instant pricing, and what to include so more lines match

## Company

- [About AKAY](https://akay.ie/about/): 36 years in trade, Ireland-based, 1,000+ suppliers, 6,000+ clients
- [All guides](https://akay.ie/guides/): index of the buyer's guides above

## How to Enquire

1. Browse [akay.ie](https://akay.ie/)
2. Upload your buying list at [quote.akay.ie](https://quote.akay.ie) — any format, no template
3. Download it back with our selling price on every matched line, and the saving marked against your cost if your list carries one

Or send a requirement list by email or WhatsApp and receive a quote within 24 hours.

**Email:** offers@akay.ie
**WhatsApp:** +353 87 238 2368
**Hours:** Monday–Friday, 9am–5pm GMT

---

Minimum order: 1 case. Optimal: 1+ pallets (40–60 cases). Worldwide delivery. T1 (under-bond) and T2 (duty-paid) options available.
`;

  return new Response(llmsTxt, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
