// Build-time search index for /search. Emits ONLY the public-safe shape that
// getOffers() already produces (the FIELDS allowlist in src/data/airtable.mjs),
// plus the offer's URL slug. No Airtable call happens in the browser: the
// page fetches this static file once and searches it client-side.
//
// scripts/check-public-safety.mjs re-validates every key in the emitted file
// against the same PUBLIC_KEYS list after the build, so a new field fails CI.
import { getOffers } from '../data/airtable.mjs';
import { withSlugs, generateSlug } from '../lib/slug.mjs';

export const prerender = true;

import { PUBLIC_KEYS } from '../lib/search-index-keys.mjs';

type Row = Record<string, unknown>;

export async function GET() {
  const { offers } = await getOffers();
  const rows = withSlugs(offers).map((o: Record<string, unknown>) => {
    const row: Partial<Row> = {};
    for (const k of PUBLIC_KEYS) {
      const v = o[k];
      // Drop blanks to keep the file small; the client treats missing as empty.
      if (v === '' || v === null || v === undefined || v === false) continue;
      if (k === 'slug' && v === generateSlug(String(o.name || ''), String(o.spec || ''))) continue;
      row[k] = v;
    }
    return row;
  });

  const body = JSON.stringify({
    v: 1,
    generated: new Date().toISOString(),
    count: rows.length,
    offers: rows,
  });

  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
