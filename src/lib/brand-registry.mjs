// Append-only record of every brand slug the site has ever published.
//
// §1 requires that a brand page which falls to zero live lines renders with
// `noindex` rather than disappearing mid-rebuild. Detecting "gone since last
// time" needs a memory of last time, and the offers snapshot cannot be it:
// Netlify builds with no Airtable token, so the snapshot IS the live data on
// every production build, and comparing the two always finds nothing missing.
//
// So the memory is this file. It only ever gains entries — a brand that sold
// through keeps its slug, and its page keeps returning 200 with `noindex`
// instead of 404-ing the moment a trader unticks Listing Approved.
//
// Updated by `npm run sync-offers`, alongside the snapshot it already writes,
// and committed by the refresh workflow in the same commit.

import registry from '../data/brand-registry.json' with { type: 'json' };
import { brandSlug } from './slug.mjs';
import { canonicalBrand } from '../data/brand-aliases.mjs';

// Read path: a static import, so it works inside the Astro/Vite build. Reading
// it with fs and import.meta.url does NOT — once bundled, import.meta.url is not
// a filesystem path, the read throws, and the registry silently comes back
// empty, which is precisely the failure this file exists to prevent.
export function readRegistry() {
  return registry && typeof registry.slugs === 'object' ? registry.slugs : {};
}

// Write path: `sync-offers` only, which runs in plain Node where fs and
// import.meta.url both behave. Re-reads from disk rather than trusting the
// import, so two refreshes in one process cannot lose an entry.
export async function updateRegistry(offers) {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('../data/brand-registry.json', import.meta.url));

  let slugs = {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && typeof raw.slugs === 'object') slugs = raw.slugs;
  } catch (err) {
    // Loud, not silent: starting from empty would drop every retired brand.
    console.warn(`[brand-registry] could not read ${path} (${err.message}) — starting a new registry`);
  }

  let added = 0;
  for (const o of offers) {
    const brand = canonicalBrand(o.brand);
    if (!brand) continue;
    const slug = brandSlug(brand);
    if (!slug || slugs[slug]) continue;
    slugs[slug] = brand;
    added++;
  }

  // Sorted so a diff shows genuine additions rather than key reordering.
  const sorted = Object.fromEntries(Object.keys(slugs).sort().map((k) => [k, slugs[k]]));
  writeFileSync(
    path,
    `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), slugs: sorted }, null, 1)}\n`
  );
  return { added, total: Object.keys(sorted).length };
}
