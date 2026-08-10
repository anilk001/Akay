// Slug registry — the memory that lets off-sale offers keep a live URL.
//
// The site is rebuilt from whatever is currently public in Airtable, so once
// an offer goes off-sale it vanishes from the data and its page would silently
// 404. The SEO brief requires the opposite: keep the URL live with a
// "no longer available" page (schema availability: Discontinued), and only
// answer 410 Gone after ~90 days off-sale — accumulated URLs are the site's
// authority.
//
// This registry is a committed JSON file, updated by the same scheduled job
// that refreshes the offers snapshot (npm run sync-offers). Every slug that
// has ever been published is recorded with public-safe display fields and
// first/last-seen dates; the build renders "discontinued" pages for entries
// missing from the current catalogue.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REGISTRY_PATH = fileURLToPath(new URL('../data/slug-registry.json', import.meta.url));
export const GONE_AFTER_DAYS = 90;

export function loadRegistry() {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return { generated: null, slugs: {} };
  }
}

// Merge today's published offers (already slugged) into the registry.
// Existing entries keep firstSeen; entries present today bump lastSeen.
// Nothing is ever removed — 410 handling is a read-time decision.
export function updateRegistry(sluggedOffers, today = new Date().toISOString().slice(0, 10)) {
  const reg = loadRegistry();
  for (const o of sluggedOffers) {
    const prev = reg.slugs[o.slug];
    reg.slugs[o.slug] = {
      name: o.name,
      category: o.category || 'Other',
      spec: o.spec || '',
      firstSeen: prev?.firstSeen || today,
      lastSeen: today,
    };
  }
  reg.generated = today;
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 1));
  return reg;
}

export function daysSince(dateStr, now = Date.now()) {
  const t = Date.parse(dateStr);
  return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : Infinity;
}

// Split registry entries not in the current catalogue into:
//  - discontinued: off-sale ≤ GONE_AFTER_DAYS → render a "no longer available" page
//  - gone: off-sale  > GONE_AFTER_DAYS → emit a 410 redirect, no page
export function offSaleEntries(registry, liveSlugs) {
  const live = new Set(liveSlugs);
  const discontinued = [];
  const gone = [];
  for (const [slug, entry] of Object.entries(registry.slugs || {})) {
    if (live.has(slug)) continue;
    (daysSince(entry.lastSeen) > GONE_AFTER_DAYS ? gone : discontinued).push({ slug, ...entry });
  }
  return { discontinued, gone };
}
