// Regenerates public/instant-quote-preview.{png,gif} — the launch email's
// thumbnail and the landing page's poster — from preview-frame.html.
//
// Playwright and gifenc are NOT project dependencies: the catalogue build and
// the five-minute refresh must not pull a browser down. Install them where you
// run this and nowhere else:
//
//   npm i --no-save playwright gifenc && npx playwright install chromium
//   node marketing/instant-quote-launch/build-preview.mjs
//
import { chromium } from 'playwright';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SRC = 'file://' + path.join(DIR, 'preview-frame.html');
const OUT = path.resolve(DIR, '../../public');
const W = 1200, H = 676;
// stage, how long it holds in the loop (ms)
// Outlook (and every other client that refuses to animate) shows frame 1 and
// stops, so frame 1 is the finished, priced file — the payoff, not the empty
// upload. Clients that do animate loop 4 → 0 → 1 → 2 → 3 → 4, which is the
// same cycle, just entered at the end.
const STAGES = [[4, 2300], [0, 900], [1, 520], [2, 520], [3, 520]];

const browser = await chromium.launch();

// ── 1. the still: full size, final stage ──────────────────────────────────
const hi = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const hiPage = await hi.newPage();
await hiPage.goto(SRC, { waitUntil: 'load' });
await hiPage.evaluate(() => window.setStage(4));
await hiPage.screenshot({ path: path.join(OUT, 'instant-quote-preview.png') });
await hi.close();

// ── 2. the loop: half size (600px — the email column width) ───────────────
const lo = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 0.5 });
const loPage = await lo.newPage();
await loPage.goto(SRC, { waitUntil: 'load' });

// The browser is also the PNG decoder: a screenshot goes back into a canvas
// and comes out as raw RGBA, which is what the GIF encoder wants.
const decoder = await lo.newPage();
await decoder.setContent('<canvas id="c"></canvas>');

const frames = [];
for (const [stage] of STAGES) {
  await loPage.evaluate((n) => window.setStage(n), stage);
  const shot = (await loPage.screenshot({ type: 'png' })).toString('base64');
  const { data, width, height } = await decoder.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.getElementById('c');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = '';
    for (let i = 0; i < px.length; i += 8192) s += String.fromCharCode.apply(null, px.subarray(i, i + 8192));
    return { data: btoa(s), width: c.width, height: c.height };
  }, shot);
  frames.push({ rgba: new Uint8ClampedArray(Buffer.from(data, 'base64')), width, height });
}
await browser.close();

// One palette for the whole loop, built from the finished frame (every other
// frame's colours are a subset of it): no per-frame colour table, no flicker.
const gif = GIFEncoder();
const palette = quantize(frames[0].rgba, 256, { format: 'rgb565' });
frames.forEach((f, i) => {
  gif.writeFrame(applyPalette(f.rgba, palette, 'rgb565'), f.width, f.height, {
    palette: i === 0 ? palette : undefined,
    delay: STAGES[i][1],
    repeat: 0,
    transparent: false,
  });
});
gif.finish();
fs.writeFileSync(path.join(OUT, 'instant-quote-preview.gif'), Buffer.from(gif.bytes()));

const kb = (p) => (fs.statSync(path.join(OUT, p)).size / 1024).toFixed(0) + ' KB';
console.log('png', frames[0].width * 2 + 'x' + frames[0].height * 2, kb('instant-quote-preview.png'));
console.log('gif', frames[0].width + 'x' + frames[0].height, kb('instant-quote-preview.gif'), frames.length + ' frames');
