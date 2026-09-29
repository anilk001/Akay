import { defineConfig } from 'astro/config';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getOffers } from './src/data/airtable.mjs';
import { buildRedirects, redirectsFile } from './src/lib/redirects.mjs';

// Writes dist/_redirects: 301s from URLs the slug rules retired to the pages
// that replaced them (see src/lib/redirects.mjs). Netlify reads _redirects
// before netlify.toml, and never redirects a path that exists as a file.
const legacyRedirects = {
  name: 'akay-legacy-redirects',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      const rules = buildRedirects(await getOffers());
      await writeFile(new URL('_redirects', dir), redirectsFile(rules));
      console.log(`[redirects] wrote ${rules.length} retired-URL redirects to ${fileURLToPath(new URL('_redirects', dir))}`);
    },
  },
};

// Static output — Astro renders every offer card at build time from Airtable,
// so the published site is plain HTML/CSS that Netlify serves globally
// with no server to run. Rebuild to refresh offers (see README: Build Hook).
export default defineConfig({
  site: 'https://akay.ie',
  output: 'static',
  trailingSlash: 'ignore',
  build: { assets: '_assets' },
  integrations: [legacyRedirects],
});
