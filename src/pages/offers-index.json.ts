import type { APIRoute } from 'astro';
import { getOffers } from '../data/airtable.mjs';

// The search index the chat assistant reads.
//
// The site is static, so there is no server that can query Airtable at request
// time. This endpoint bakes the catalogue into a single JSON file at build time
// and the Netlify chat function fetches it once per cold start, then keeps it in
// memory. It stays in step with the cards automatically: same getOffers(), same
// build, so the assistant can never quote a price the page is not showing.
//
// Only PUBLIC-SAFE fields are emitted — the exact set already rendered on every
// card. Supplier, buy price and margin are not in the offer object at all.
export const prerender = true;

export const GET: APIRoute = async () => {
  const { offers, source } = await getOffers();

  const index = offers.map((o: any) => ({
    id: o.id,
    name: o.name,
    variants: o.variants,
    brand: o.brand,
    category: o.category,
    spec: o.spec,
    currency: o.currency,
    amount: o.amount,
    unitAmount: o.unitAmount,
    priceDetail: o.priceDetail,
    stock: o.stock,
    qty: o.qty,
    terms: o.terms,
    tier: o.tier,
    origin: o.origin,
  }));

  return new Response(JSON.stringify({ source, count: index.length, offers: index }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Rebuilt on every deploy (the snapshot refresh commits every 5 min), so a
      // short cache is plenty and keeps the function's cold start warm-ish.
      'Cache-Control': 'public, max-age=300',
    },
  });
};
