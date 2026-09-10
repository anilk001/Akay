#!/usr/bin/env node
// Render an AKAY offer video from the live catalogue.
//
//   node render.mjs --list corona                 # find offers to render
//   node render.mjs --offer "Corona Extra"        # 9:16 reel for one offer
//   node render.mjs -c OfferSquare -o recXXXX     # 1:1 for a known record id
//   node render.mjs -c OfferRoll --category Beer -n 6
//   node render.mjs --still -c OfferWide -o "Halls"   # a PNG instead of a video
//
// Offers come from the site's own data layer: live Airtable when AIRTABLE_TOKEN
// is set, otherwise the committed snapshot — the same source, and the same
// public-safe field allowlist, that offers.akay.ie renders from. Nothing else
// can reach a frame: toVideoOffer() narrows every row again on the way in.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { getOffers } from '../src/data/airtable.mjs';
import { findBrowser } from './find-browser.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, 'out');

// Keep this list in sync with VIDEO_FIELDS in src/offer.ts.
const VIDEO_FIELDS = [
  'id', 'name', 'variants', 'brand', 'category', 'spec', 'currency', 'amount',
  'unitAmount', 'priceDetail', 'priceBasis', 'stock', 'qty', 'terms', 'tier',
  'origin', 'featured',
];
const toVideoOffer = (o) =>
  Object.fromEntries(VIDEO_FIELDS.map((k) => [k, o[k] ?? (k === 'featured' ? false : null)]));

const ROLL_COMPS = new Set(['OfferRoll', 'OfferRollWide']);

function parseArgs(argv) {
  const args = {
    comp: 'OfferReel', offer: '', category: '', brand: '', count: 5,
    theme: 'paper', title: '', subtitle: '', out: '', codec: 'h264',
    featured: false, still: false, list: null, layout: '', frame: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-c': case '--comp': case '--composition': args.comp = next(); break;
      case '-o': case '--offer': args.offer = next(); break;
      case '--category': args.category = next(); break;
      case '--brand': args.brand = next(); break;
      case '-n': case '--count': args.count = parseInt(next(), 10); break;
      case '--theme': args.theme = next(); break;
      case '--layout': args.layout = next(); break;
      case '--title': args.title = next(); break;
      case '--subtitle': args.subtitle = next(); break;
      case '--out': args.out = next(); break;
      case '--codec': args.codec = next(); break;
      case '--featured': args.featured = true; break;
      case '--still': args.still = true; break;
      case '--frame': args.frame = parseInt(next(), 10); break;
      case '--list': args.list = argv[i + 1] && !argv[i + 1].startsWith('-') ? next() : ''; break;
      default:
        if (a.startsWith('-')) throw new Error(`Unknown flag: ${a}`);
    }
  }
  return args;
}

const matches = (o, q) => {
  const needle = q.toLowerCase();
  return o.id === q || `${o.name} ${o.brand} ${o.category} ${o.spec}`.toLowerCase().includes(needle);
};

function select(offers, args) {
  let pool = offers;
  if (args.category) pool = pool.filter((o) => o.category.toLowerCase() === args.category.toLowerCase());
  if (args.brand) pool = pool.filter((o) => o.brand.toLowerCase() === args.brand.toLowerCase());
  if (args.featured) pool = pool.filter((o) => o.featured);
  if (args.offer) pool = pool.filter((o) => matches(o, args.offer));
  // A card with no price reads as broken, so never pick one by accident.
  const priced = pool.filter((o) => Number.isFinite(o.amount));
  return priced.length ? priced : pool;
}

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'offer';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { offers, source } = await getOffers();
  console.log(`[video] ${offers.length} offers (${source})`);

  if (args.list !== null) {
    const hits = (args.list ? offers.filter((o) => matches(o, args.list)) : offers).slice(0, 40);
    for (const o of hits) {
      console.log(`${o.id}\t${o.category}\t${o.name} — ${o.priceDetail || `${o.currency} ${o.amount}`}`);
    }
    console.log(`\n${hits.length} shown. Render one with:  npm run video:render -- -o "<name or id>"`);
    return;
  }

  const picked = select(offers, args);
  if (!picked.length) throw new Error('No offer matched. Try `npm run list -- <search>` first.');

  const isRoll = ROLL_COMPS.has(args.comp);
  const chosen = isRoll ? picked.slice(0, Math.max(1, args.count)) : [picked[0]];
  const inputProps = isRoll
    ? {
        offers: chosen.map(toVideoOffer),
        theme: args.theme,
        ...(args.layout ? { layout: args.layout } : {}),
        ...(args.title ? { title: args.title } : {}),
        ...(args.subtitle ? { subtitle: args.subtitle } : {}),
      }
    : {
        offer: toVideoOffer(chosen[0]),
        theme: args.theme,
        ...(args.layout ? { layout: args.layout } : {}),
      };

  console.log(`[video] ${args.comp}: ${chosen.map((o) => o.name).join(' | ')}`);

  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, 'src', 'index.ts'),
    // The logo comes from the site's public/ folder, not a copy of it.
    publicDir: path.join(ROOT, '..', 'public'),
    onProgress: (p) => { if (p === 100) console.log('[video] bundled'); },
  });

  // selectComposition evaluates the composition in a browser too, so it needs
  // the same Chromium as the render itself.
  const browserExecutable = findBrowser();
  if (browserExecutable) console.log(`[video] chromium: ${browserExecutable}`);
  const chromiumOptions = { gl: 'swangle' };

  const composition = await selectComposition({
    serveUrl, id: args.comp, inputProps, browserExecutable, chromiumOptions,
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const stem = `${args.comp}-${slugify(isRoll ? (args.category || args.brand || 'roll') : chosen[0].name)}`;
  const outputLocation = args.out
    ? path.resolve(args.out)
    : path.join(OUT_DIR, `${stem}.${args.still ? 'png' : 'mp4'}`);

  if (args.still) {
    await renderStill({ composition, serveUrl, output: outputLocation, inputProps, browserExecutable, chromiumOptions,
      // Default to the end of the entrance animation, where the card is fully drawn.
      frame: args.frame ?? Math.min(40, composition.durationInFrames - 1) });
  } else {
    let last = -1;
    await renderMedia({
      composition, serveUrl, codec: args.codec, outputLocation, inputProps,
      browserExecutable, chromiumOptions,
      onProgress: ({ progress }) => {
        const pct = Math.round(progress * 100);
        if (pct >= last + 20) { last = pct; console.log(`[video] ${pct}%`); }
      },
    });
  }

  console.log(`[video] wrote ${path.relative(process.cwd(), outputLocation)}`);
}

main().catch((err) => {
  console.error(`[video] ${err.stack || err.message}`);
  process.exit(1);
});
