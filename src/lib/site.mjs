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

// The "ask us to re-confirm this price" endpoint (n8n workflow
// GHZu605lfGOlf2eW). Written down once here for the same reason SITE_URL is:
// if the automation moves, it is one edit rather than a grep.
//
// The link is a GET that logs an enquiry, so it carries rel="nofollow" at every
// call site to keep crawlers out of it. Repeat hits are harmless — the workflow
// is idempotent per offer per day — but there is no reason to invite them.
const RECONFIRM_ENDPOINT = 'https://akay-team.app.n8n.cloud/webhook/reconfirm';

/** Re-confirm link for one offer. Returns '' when the record id is unknown. */
export function reconfirmUrl(offerId = '') {
  const id = String(offerId || '').trim();
  // Only a real Airtable record id — a snapshot placeholder like
  // "snapshot-12" would just produce the workflow's "link not valid" page.
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return '';
  return `${RECONFIRM_ENDPOINT}?o=${encodeURIComponent(id)}`;
}

// Absolute URL for an internal path. Accepts '/', '/about/', 'about/'.
export function absoluteUrl(path = '/') {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_URL}/${String(path).replace(/^\/+/, '')}`.replace(/(?<!:)\/{2,}/g, '/');
}
