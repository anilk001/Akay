// A ledger of offer URLs that have left the catalogue, so they 301 to the
// brand page instead of 404ing.
//
// About 270 offer pages a day disappear when a line expires or is deleted in
// Airtable (1,625 between 2026-09-24 and 2026-09-29). Google had many of them
// indexed and some were ranking — Search Console showed hundreds of /offers/
// URLs with impressions — and every one that 404s throws away what it earned.
// The brand page is the closest live page to a retired offer: same product
// family, current stock, same search intent.
//
// sync-offers records the pages that vanished between the old and new
// snapshot (updateLedger); the build turns the ledger into `_redirects` lines
// (retiredRedirects). Only brand and category — both public fields — are
// stored, so the ledger is as public-safe as the snapshot it is derived from.
//
// The ledger is capped: Netlify reads every rule on every request, and at
// this churn an uncapped file would pass 100,000 rules within a year. Google
// processes a 301 within weeks, so keeping the most recent MAX_ENTRIES
// retirements (a few months at current churn) covers the URLs still in its
// index and lets older ones age out.
import { readFileSync } from 'node:fs';
import { withSlugs, generateSlug, legacySlug, brandPages, categorySlug } from './slug.mjs';

export const MAX_ENTRIES = 20000;
export const LEDGER_URL = new URL('../data/retired-offers.json', import.meta.url);

/** The committed ledger, or an empty one if it is missing or unreadable. */
export function readLedger(url = LEDGER_URL) {
  try {
    return JSON.parse(readFileSync(url, 'utf8'));
  } catch {
    return {};
  }
}

/** Every /offers/<slug>/ page a snapshot builds, with the fields a redirect needs. */
export function offerPages({ offers = [], delisted = [] } = {}, slugFn = generateSlug) {
  const pages = new Map();
  for (const o of withSlugs([...offers, ...delisted], slugFn)) {
    pages.set(o.slug, { brand: (o.brand || '').trim(), category: (o.category || '').trim() });
  }
  return pages;
}

/**
 * Record the pages `prev` built that `next` does not.
 *
 * `ledger` maps slug -> [brand, category, retiredDate]. A slug that is live
 * again in `next` is dropped (its page is back). Pages retired by the
 * 2026-09-29 accent rule are recorded under their pre-change slug as well,
 * since that is the URL Google holds for them.
 */
export function updateLedger(ledger = {}, prev, next, today, max = MAX_ENTRIES) {
  const live = offerPages(next);
  const out = {};
  for (const [slug, entry] of Object.entries(ledger)) {
    if (!live.has(slug)) out[slug] = entry;
  }
  if (prev) {
    for (const slugFn of [generateSlug, legacySlug]) {
      for (const [slug, { brand, category }] of offerPages(prev, slugFn)) {
        if (live.has(slug) || out[slug]) continue;
        if (!brand && !category) continue;
        out[slug] = [brand, category, today];
      }
    }
  }
  return capLedger(out, max);
}

/** Keep the `max` most recent retirements; ties break by slug so the result is stable. */
export function capLedger(ledger, max = MAX_ENTRIES) {
  const entries = Object.entries(ledger);
  const kept = entries.length > max
    ? entries.sort(([sa, a], [sb, b]) => (b[2] || '').localeCompare(a[2] || '') || sa.localeCompare(sb)).slice(0, max)
    : entries;
  return Object.fromEntries(kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * `{ from, to }` 301s for retired offers, against the pages this build makes:
 * the brand page if the brand still has one, else the category page, else
 * nothing (the 404 page is better than a redirect to an unrelated page).
 * A slug that is a live page again is never redirected.
 */
export function retiredRedirects(ledger = {}, { offers = [], delisted = [] } = {}) {
  const livePages = offerPages({ offers, delisted });
  const brandSlugs = new Set(brandPages(offers.filter((o) => !o.delisted)).map((p) => p.slug));
  const categorySlugs = new Set(offers.map((o) => categorySlug(o.category || '')).filter(Boolean));

  // Snapshots before mid-September carried no brand on many rows. Their slugs
  // still start with the brand ("kilbeggan-irish-whiskey-…"), so match the
  // longest brand-page key that prefixes the slug at a word boundary. Keys
  // under three characters are too generic to trust this way.
  const brandKeys = [...brandSlugs].map((s) => s.replace(/-wholesale$/, ''))
    .filter((k) => k.length >= 3)
    .sort((a, b) => b.length - a.length);
  const brandFromSlug = (slug) => brandKeys.find((k) => slug.startsWith(`${k}-`));

  const rules = [];
  for (const [slug, [brand, category]] of Object.entries(ledger)) {
    if (livePages.has(slug)) continue;
    const key = brand ? generateSlug(brand) : brandFromSlug(slug);
    const brandSlug = key ? `${key}-wholesale` : '';
    const catSlug = categorySlug(category || '');
    let to = null;
    if (brandSlug && brandSlugs.has(brandSlug)) to = `/brands/${brandSlug}/`;
    else if (catSlug && categorySlugs.has(catSlug)) to = `/category/${catSlug}/`;
    if (to) rules.push({ from: `/offers/${slug}/`, to });
  }
  return rules;
}

/** One entry per line, sorted: small diffs in the refresh commits. */
export function serialiseLedger(ledger) {
  const lines = Object.entries(ledger).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}
