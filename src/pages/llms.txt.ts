export const prerender = true;

export async function GET() {
  const llmsTxt = `# AKAY Trade — Wholesale Beverage & FMCG Offers

> Live B2B wholesale catalogue from Akay Irl Ltd (Shannon, Ireland). Spirits, beer, soft drinks, grocery and FMCG by the case, pallet and container. Duty-paid (T2) and export/under-bond (T1). Prices indicative, trade buyers only. Enquiries via WhatsApp +353 87 238 2368 or offers@akay.ie.

## Catalogue

- [All live offers](https://offers.akay.ie/): full catalogue, updated continuously
- [Spirits](https://offers.akay.ie/category/spirits/)
- [Beer](https://offers.akay.ie/category/beer/)
- [Soft Drinks](https://offers.akay.ie/category/soft-drinks/)
- [Grocery](https://offers.akay.ie/category/grocery/)
- [Toiletries](https://offers.akay.ie/category/toiletries/)
- [Confectionery](https://offers.akay.ie/category/confectionery/)
- [Champagne](https://offers.akay.ie/category/champagne/)
- [Other FMCG](https://offers.akay.ie/category/other-fmcg/)

## Guides

- [T1 vs T2 duty status](https://offers.akay.ie/guides/t1-vs-t2-duty-status/): duty-paid vs under-bond explained for beverage trading
- [Incoterms explained](https://offers.akay.ie/guides/incoterms-exw-dap-cfr/): EXW, FCA, DAP, CIF, FOB, CFR shipping terms
- [How to buy wholesale](https://offers.akay.ie/guides/how-to-buy-wholesale-spirits-eu/): step-by-step wholesale purchasing, MOQs, pricing, enquiry process
- [Requirement list format](https://offers.akay.ie/guides/requirement-list-format/): how to structure requests for wholesale pricing

## Company

- [About AKAY](https://offers.akay.ie/about/): 36 years in trade, Ireland-based, 1,000+ suppliers, 6,000+ clients

## How to Enquire

1. Browse [offers.akay.ie](https://offers.akay.ie/)
2. Send a requirement list with product names and quantities
3. Receive a quote within 24 hours

**Email:** offers@akay.ie
**WhatsApp:** +353 87 238 2368
**Hours:** Monday–Friday, 9am–5pm GMT

---

Minimum order: 1 case. Optimal: 1+ pallets (40–60 cases). Worldwide delivery. T1 (under-bond) and T2 (duty-paid) options available.
`;

  return new Response(llmsTxt, {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}
