/**
 * Encodes the frame sequences written by render.mjs into delivery files.
 *
 * H.264 High / yuv420p / faststart, plus a silent AAC track: that combination
 * is what WhatsApp, Gmail and iOS all play without re-transcoding. A muted
 * track matters — some players stall on a video with no audio stream at all.
 *
 *   node encode.mjs                     # every format that has frames
 *   node encode.mjs --fmt=portrait
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; }
}
const FF = ffmpegBin();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']),
);
const fps = Number(args.fps || 30);
const outDir = path.resolve(HERE, args.out || 'out');
fs.mkdirSync(outDir, { recursive: true });

const run = (a) => {
  const r = spawnSync(FF, a, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr?.slice(-2500)); process.exit(1); }
};
const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(2) + ' MB';

const formats = args.fmt ? [args.fmt] : ['portrait', 'square', 'landscape'];

for (const fmt of formats) {
  const frames = path.resolve(HERE, `frames-${fmt}`);
  if (!fs.existsSync(frames)) { console.log(`skip ${fmt} (no frames)`); continue; }

  const mp4 = path.join(outDir, `akay-instant-quote-${fmt}.mp4`);
  run([
    '-y', '-framerate', String(fps), '-i', path.join(frames, 'f%05d.jpg'),
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p',
    '-x264-params', 'keyint=60:min-keyint=30',
    '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart', mp4,
  ]);
  console.log(`${fmt.padEnd(10)} mp4  ${mb(mp4)}`);

  // WebM for the site itself — smaller over the wire, and <video> takes both.
  if (fmt === 'landscape') {
    const webm = path.join(outDir, `akay-instant-quote-${fmt}.webm`);
    run([
      '-y', '-framerate', String(fps), '-i', path.join(frames, 'f%05d.jpg'),
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1',
      '-pix_fmt', 'yuv420p', '-an', webm,
    ]);
    console.log(`${fmt.padEnd(10)} webm ${mb(webm)}`);
  }

  // Poster: the title card, which is the frame worth freezing on.
  const poster = path.join(outDir, `akay-instant-quote-${fmt}-poster.jpg`);
  run([
    '-y', '-i', path.join(frames, `f${String(Math.round(12.2 * fps)).padStart(5, '0')}.jpg`),
    '-q:v', '3', poster,
  ]);
  console.log(`${fmt.padEnd(10)} poster ${mb(poster)}`);
}
console.log(`\n-> ${outDir}`);
