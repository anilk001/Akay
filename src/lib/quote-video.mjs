// The Instant Quote walkthrough, written down once so the homepage explainer
// and the /instant-quote/ landing page can never disagree about which asset is
// live — the same reason SITE_URL and QUOTE_URL live in site.mjs.
//
// To publish a real screen recording: drop the file in public/ (H.264 MP4,
// muted, a minute at most) and set QUOTE_VIDEO to its absolute path, e.g.
// '/instant-quote.mp4'. Both pages swap their animated mock for the recording
// on the next build. Left null, the mock renders: nothing to host, no extra
// bytes, and it still shows the before/after the buyer came to see.
export const QUOTE_VIDEO = null;

// The still frame — the video's poster, and the image the launch email links
// from. 1200x676, committed at public/instant-quote-preview.png; rebuilt by
// the recipe in marketing/instant-quote-launch/README.md.
export const QUOTE_VIDEO_POSTER = '/instant-quote-preview.png';

// The same frame animated (600x338, ~100 KB) for email. Frame one is the
// finished, priced file, because Outlook shows frame one and stops.
export const QUOTE_VIDEO_GIF = '/instant-quote-preview.gif';

// Landing page the email image points at. One path, written down once, so the
// email, the sitemap and the internal links cannot drift apart.
export const QUOTE_LANDING_PATH = '/instant-quote/';
