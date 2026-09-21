// Single source of truth for the public origin and the site-wide SEO
// defaults. The site moved from offers.akay.ie to akay.ie — canonical URLs,
// JSON-LD @ids, the sitemap, robots.txt and llms.txt all read the origin
// from here so a future move is one edit, not a grep.
export const SITE_URL = 'https://akay.ie';
export const SITE_NAME = 'AKAY Trade';
export const LEGAL_NAME = 'Akay Irl Ltd';
// 1200x630 share card (public/og-akay.png). The bird logo alone is 320x279,
// which every platform renders as a small square thumbnail; this is what
// WhatsApp, LinkedIn and Slack previews actually show.
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-akay.png`;
export const DEFAULT_OG_IMAGE_WIDTH = '1200';
export const DEFAULT_OG_IMAGE_HEIGHT = '630';
export const DEFAULT_OG_IMAGE_ALT =
  'AKAY Trade — wholesale spirits, beer and FMCG by the case, with live trade pricing';
export const LOCALE = 'en_IE';

// Public profiles Google uses to reconcile the Organization entity. Only add
// URLs that are confirmed to exist — a sameAs pointing at a 404 weakens the
// entity match instead of strengthening it. (The company LinkedIn page URL
// belongs here once confirmed.)
export const SAME_AS = ['https://www.facebook.com/163964083657461'];

// The Trade Desk (the React app in quote/, deployed to its own Netlify
// project). It is a separate origin from the catalogue, and its two tabs are
// hash routed — an unknown hash falls back to the chat tab. Written down once
// here, like SITE_URL, so moving the tool is one edit rather than a grep.
export const QUOTE_URL = 'https://quote.akay.ie';
const QUOTE_TABS = ['chat', 'excel'];

/**
 * Link into the Trade Desk. `quoteUrl('chat')` opens Ask AKAY, `'excel'` the
 * buying-list upload. An unknown tab returns the bare origin rather than a
 * hash the app would silently drop.
 */
export function quoteUrl(tab = 'chat') {
  const id = String(tab || '').replace(/^#/, '').toLowerCase();
  return QUOTE_TABS.includes(id) ? `${QUOTE_URL}/#${id}` : QUOTE_URL;
}

// The "ask us to re-confirm this price" endpoint (n8n workflow
// GHZu605lfGOlf2eW). Written down once here for the same reason SITE_URL is:
// if the automation moves, it is one edit rather than a grep.
//
// POST ONLY since 2026-09-21: the offer page posts a form, there is no GET link.
// A browser-disguised crawler walked the old GET link every ~30s and burned
// n8n executions; the webhook now accepts POST only, so stray GETs cost nothing.
//
// The link is a GET that logs an enquiry, so it carries rel="nofollow" at every
// call site to keep crawlers out of it. Repeat hits are harmless — the workflow
// is idempotent per offer per day — but there is no reason to invite them.
export const RECONFIRM_ENDPOINT = 'https://akay-team.app.n8n.cloud/webhook/reconfirm';

/** Offer id for the re-confirm form. Returns '' when the record id is unknown. */
export function reconfirmOfferId(offerId = '') {
  const id = String(offerId || '').trim();
  // Only a real Airtable record id — a snapshot placeholder like
  // "snapshot-12" would just produce the workflow's "link not valid" page.
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return '';
  return id;
}

// Absolute URL for an internal path. Accepts '/', '/about/', 'about/'.
export function absoluteUrl(path = '/') {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}/${String(path).replace(/^\/+/, '')}`.replace(/(?<!:)\/{2,}/g, '/');
}
