import { defineConfig } from 'astro/config';

// Static output — Astro renders every offer card at build time from Airtable,
// so the published site is plain HTML/CSS that Netlify serves globally
// with no server to run. Rebuild to refresh offers (see README: Build Hook).
export default defineConfig({
  site: 'https://offers.akay.ie',
  output: 'static',
  trailingSlash: 'ignore',
  build: { assets: '_assets' },
});
