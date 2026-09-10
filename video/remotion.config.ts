// Remotion Studio / CLI config for the AKAY offer videos.
//
// The video workspace lives outside the Astro site on purpose: `npm run build`
// and the Netlify deploy never install these dependencies, so adding motion
// graphics cannot slow down (or break) the catalogue build.

import { Config } from '@remotion/cli/config';
import { findBrowser } from './find-browser.mjs';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setEntryPoint('./src/index.ts');

// Serve the site's own public/ folder so the logo used in a video is byte-for-byte
// the logo on offers.akay.ie — staticFile('akay-bird.png') resolves there.
Config.setPublicDir('../public');

// Studio and `npx remotion render` reuse a Chromium that is already installed
// when there is one, so a sandbox with no egress to remotion.media still works.
const browser = findBrowser();
if (browser) Config.setBrowserExecutable(browser);
