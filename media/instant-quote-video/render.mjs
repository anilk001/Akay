/**
 * Renders scene.html to a numbered frame sequence.
 *
 * The scene is deterministic — window.seek(t) fully describes the frame, with
 * no CSS transitions anywhere — so we step the clock ourselves rather than
 * screen-recording. Every capture is exact and the run is repeatable.
 *
 *   node render.mjs --fmt=portrait                  # full sequence
 *   node render.mjs --fmt=square --probe=2.6,26,34  # a few stills, to eyeball
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGO = process.env.AKAY_LOGO || path.resolve(HERE, '../../public/akay-bird.png');
// Chromium ships with the image; Playwright's own download is skipped here.
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const FMT = {
  portrait:  { w: 1080, h: 1920 },  // WhatsApp Status, Reels, TikTok
  square:    { w: 1080, h: 1080 },  // WhatsApp chat, LinkedIn feed
  landscape: { w: 1920, h: 1080 },  // email embed, YouTube, site
};

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']),
);
const fmt = args.fmt || 'portrait';
const fps = Number(args.fps || 30);
const outDir = path.resolve(HERE, args.out || `frames-${fmt}`);
const probe = args.probe ? args.probe.split(',').map(Number) : null;

const { w, h } = FMT[fmt];
// The logo is inlined so the scene renders from a file:// URL with no network.
const html = fs
  .readFileSync(path.join(HERE, 'scene.html'), 'utf8')
  .split('__LOGO__')
  .join('data:image/png;base64,' + fs.readFileSync(LOGO).toString('base64'));

const browser = await chromium.launch({
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate((f) => { document.documentElement.dataset.fmt = f; }, fmt);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
await page.waitForTimeout(250);

const DUR = await page.evaluate(() => window.DUR);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

if (probe) {
  for (const [i, t] of probe.entries()) {
    await page.evaluate((tt) => window.seek(tt), t);
    await page.screenshot({ path: `${outDir}/probe-${String(i).padStart(2, '0')}-t${t}.png` });
  }
  console.log(`${probe.length} probe stills -> ${outDir}`);
} else {
  const total = Math.round(DUR * fps);
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate((tt) => window.seek(tt), i / fps);
    await page.screenshot({ path: `${outDir}/f${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 96 });
    if (i && i % 300 === 0) console.log(`  ${fmt} ${i}/${total} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  console.log(`${fmt}: ${total} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${outDir}`);
}
await browser.close();
