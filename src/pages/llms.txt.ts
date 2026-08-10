// llms.txt (SEO brief §6) — a plain-text map of the site for AI crawlers.
// Generated at build time so the category links always reflect the live data.
import { getOffers } from '../data/airtable.mjs';
import { categorySlug } from '../lib/slug.mjs';

const SITE = 'https://offers.akay.ie';

export async function GET() {
  const { offers } = await getOffers();
  const categories = Array.from(new Set(offers.filter((o) => o.name).map((o) => o.category))).sort();

  const body = `# AKAY Trade — Wholesale Beverage & FMCG Offers

> Live B2B wholesale catalogue from Akay Irl Ltd (Shannon, Ireland). Spirits, beer,
> soft drinks, grocery and FMCG by the case, pallet and container. Duty-paid (T2)
> and export/under-bond (T1). Prices indicative, trade buyers only. Enquiries via
> WhatsApp +353 87 238 2368 or offers@akay.ie.

## Catalogue
- [All live offers](${SITE}/): full catalogue, updated continuously
${categories.map((c) => `- [${c}](${SITE}/category/${categorySlug(c)}/)`).join('\n')}

## Guides
- [T1 vs T2 duty status](${SITE}/guides/t1-vs-t2-duty-status/)
- [Incoterms explained](${SITE}/guides/incoterms-exw-dap-cfr/)
- [How to buy wholesale](${SITE}/guides/how-to-buy-wholesale-spirits-eu/)
- [Requirement list format](${SITE}/guides/requirement-list-format/)

## Company
- [About AKAY](${SITE}/about/): 36 years in trade, Ireland-based
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
