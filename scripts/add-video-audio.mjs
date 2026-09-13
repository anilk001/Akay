#!/usr/bin/env node
/**
 * Put a soundtrack on a silent AKAY offer video.
 *
 * Renders an original music bed the exact length of the clip (see
 * scripts/music-bed.mjs), optionally mixes a voiceover over it with the music
 * ducking underneath, normalises to a sensible level for social feeds, and
 * muxes the result back onto the untouched video stream.
 *
 *   node scripts/add-video-audio.mjs offer.mp4
 *   node scripts/add-video-audio.mjs offer.mp4 -o offer-with-audio.mp4 --variant bright
 *   node scripts/add-video-audio.mjs offer.mp4 --voice-file voiceover.mp3
 *   node scripts/add-video-audio.mjs offer.mp4 --say "Halls liquid strawberry, thirty four eighty per case."
 *
 * Needs ffmpeg. If it is not on PATH, `npm i -D ffmpeg-static` is enough —
 * this script finds that binary on its own. `--say` additionally needs
 * espeak-ng; for anything customer-facing prefer `--voice-file` with a real
 * recording or a proper TTS render, because espeak-ng sounds robotic.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderBed, VARIANT_NAMES } from './music-bed.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

function usage(message) {
  if (message) console.error(`add-video-audio: ${message}\n`);
  console.error(`Usage: node scripts/add-video-audio.mjs <video> [options]

  -o, --out <file>       Output path (default: <video>-with-audio.mp4)
      --variant <name>   Music bed: ${VARIANT_NAMES.join(' | ')} (default: calm)
      --voice-file <f>   Mix this audio file in as a voiceover
      --say <text>       Synthesise a voiceover with espeak-ng (robotic — drafts only)
      --voice-delay <s>  Hold the voiceover back this long (default: 0.8)
      --music-level <n>  Music gain when there is a voiceover (default: 0.55)
      --no-sting         Drop the opening bell
      --keep-audio       Keep the video's existing audio and mix the bed under it
`);
  process.exit(message ? 1 : 0);
}

function parseArgs(argv) {
  const opts = {
    input: null,
    out: null,
    variant: 'calm',
    voiceFile: null,
    say: null,
    voiceDelay: 0.8,
    musicLevel: 0.55,
    sting: true,
    keepAudio: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usage(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '-h': case '--help': usage(); break;
      case '-o': case '--out': opts.out = next(); break;
      case '--variant': opts.variant = next(); break;
      case '--voice-file': opts.voiceFile = next(); break;
      case '--say': opts.say = next(); break;
      case '--voice-delay': opts.voiceDelay = Number(next()); break;
      case '--music-level': opts.musicLevel = Number(next()); break;
      case '--no-sting': opts.sting = false; break;
      case '--keep-audio': opts.keepAudio = true; break;
      default:
        if (arg.startsWith('-')) usage(`unknown option ${arg}`);
        if (opts.input) usage('only one input video at a time');
        opts.input = arg;
    }
  }

  if (!opts.input) usage('no input video given');
  if (!existsSync(opts.input)) usage(`no such file: ${opts.input}`);
  if (!VARIANT_NAMES.includes(opts.variant)) {
    usage(`unknown variant "${opts.variant}" (expected ${VARIANT_NAMES.join(', ')})`);
  }
  if (opts.voiceFile && opts.say) usage('use --voice-file or --say, not both');
  if (opts.voiceFile && !existsSync(opts.voiceFile)) usage(`no such file: ${opts.voiceFile}`);
  if (!Number.isFinite(opts.voiceDelay) || opts.voiceDelay < 0) usage('--voice-delay must be >= 0');
  if (!Number.isFinite(opts.musicLevel) || opts.musicLevel <= 0) usage('--music-level must be > 0');

  if (!opts.out) {
    const ext = path.extname(opts.input) || '.mp4';
    opts.out = path.join(
      path.dirname(opts.input),
      `${path.basename(opts.input, ext)}-with-audio${ext}`,
    );
  }

  return opts;
}

/** ffmpeg from PATH, or the binary npm's ffmpeg-static drops in node_modules. */
function findFfmpeg() {
  const onPath = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (onPath.status === 0) return 'ffmpeg';

  const bundled = path.join(REPO, 'node_modules', 'ffmpeg-static', 'ffmpeg');
  if (existsSync(bundled)) return bundled;

  console.error(`add-video-audio: ffmpeg not found.
Install it system-wide, or run: npm i -D ffmpeg-static`);
  process.exit(1);
}

function run(bin, args, { capture = false } = {}) {
  const res = spawnSync(bin, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
}

/** Read a video's duration in seconds out of ffmpeg's own banner. */
function probeDuration(ffmpeg, file) {
  const res = run(ffmpeg, ['-hide_banner', '-i', file], { capture: true });
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(res.stderr || '');
  if (!match) {
    console.error(`add-video-audio: could not read the duration of ${file}`);
    process.exit(1);
  }
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** True when the file carries at least one audio stream. */
function hasAudio(ffmpeg, file) {
  const res = run(ffmpeg, ['-hide_banner', '-i', file], { capture: true });
  return /Stream #\d+:\d+.*: Audio:/.test(res.stderr || '');
}

function synthesiseSpeech(text, outFile) {
  const probe = spawnSync('espeak-ng', ['--version'], { stdio: 'ignore' });
  if (probe.status !== 0) {
    console.error(`add-video-audio: --say needs espeak-ng (apt-get install -y espeak-ng).
For anything customer-facing, record a voiceover and pass --voice-file instead.`);
    process.exit(1);
  }
  const res = run('espeak-ng', ['-v', 'en-gb', '-s', '145', '-p', '42', '-w', outFile, text]);
  if (res.status !== 0) {
    console.error('add-video-audio: espeak-ng failed');
    process.exit(1);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ffmpeg = findFfmpeg();
  const work = mkdtempSync(path.join(tmpdir(), 'akay-video-audio-'));

  try {
    const duration = probeDuration(ffmpeg, opts.input);
    console.log(`Clip is ${duration.toFixed(2)}s — rendering a "${opts.variant}" bed to match.`);

    const bedPath = path.join(work, 'bed.wav');
    writeFileSync(bedPath, renderBed({ seconds: duration, variant: opts.variant, sting: opts.sting }));

    let voicePath = opts.voiceFile;
    if (opts.say) {
      voicePath = path.join(work, 'voice.wav');
      synthesiseSpeech(opts.say, voicePath);
    }

    // A voiceover longer than the picture gets cut off mid-sentence, and it is
    // easy not to notice until it is already posted. Say so loudly.
    if (voicePath) {
      const voiceSeconds = probeDuration(ffmpeg, voicePath);
      const needed = voiceSeconds + opts.voiceDelay;
      if (needed > duration + 0.05) {
        const over = needed - duration;
        console.warn(
          `\nWARNING: the voiceover runs ${needed.toFixed(2)}s (including the ` +
            `${opts.voiceDelay}s delay) but the clip is only ${duration.toFixed(2)}s.\n` +
            `         The last ${over.toFixed(2)}s of speech will be cut off.\n` +
            `         Lengthen the video, shorten the script, or drop --voice-delay.\n`,
        );
      }
    }

    const keepExisting = opts.keepAudio && hasAudio(ffmpeg, opts.input);
    if (opts.keepAudio && !keepExisting) {
      console.log('No existing audio track to keep — using the bed on its own.');
    }

    // Input 0 is the video, input 1 the bed, then any voiceover.
    const inputs = ['-i', opts.input, '-i', bedPath];
    if (voicePath) inputs.push('-i', voicePath);

    const voiceIndex = 2;
    const filters = [];
    let musicLabel = '[1:a]';

    if (voicePath || keepExisting) {
      // Anything sitting on top of the bed both plays and drives the ducking.
      const topSources = [];
      if (voicePath) {
        filters.push(
          `[${voiceIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
            `adelay=${Math.round(opts.voiceDelay * 1000)}:all=1,volume=1.0[vo]`,
        );
        topSources.push('[vo]');
      }
      if (keepExisting) {
        filters.push(
          '[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[orig]',
        );
        topSources.push('[orig]');
      }

      let topLabel = topSources[0];
      if (topSources.length > 1) {
        filters.push(`${topSources.join('')}amix=inputs=${topSources.length}:normalize=0[top]`);
        topLabel = '[top]';
      }

      filters.push(`${topLabel}asplit=2[topkey0][topmix]`);
      // sidechaincompress stops as soon as *either* input ends, so a voiceover
      // shorter than the clip would cut the music — and the video with it. Pad
      // the key signal with silence so only the bed decides the length.
      filters.push('[topkey0]apad[topkey]');
      filters.push(
        `[1:a]volume=${opts.musicLevel}[bedlvl]`,
        // Pull the music down whenever the voice is speaking, then let it back up.
        '[bedlvl][topkey]sidechaincompress=threshold=0.04:ratio=9:attack=25:release=450[ducked]',
      );
      // normalize=0 keeps amix from rescaling the music the moment the voice
      // stops, which would otherwise be an audible jump in level.
      filters.push(
        '[ducked][topmix]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]',
      );
      musicLabel = '[mixed]';
    }

    // -16 LUFS is the usual target for social video; the limiter catches peaks.
    filters.push(`${musicLabel}loudnorm=I=-16:TP=-1.5:LRA=11,alimiter=limit=0.95[aout]`);

    const args = [
      '-hide_banner',
      '-y',
      ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '0:v:0',
      '-map', '[aout]',
      '-c:v', 'copy', // never re-encode the picture
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-shortest',
      '-movflags', '+faststart',
      opts.out,
    ];

    const res = run(ffmpeg, args, { capture: true });
    if (res.status !== 0) {
      console.error(res.stderr || 'add-video-audio: ffmpeg failed');
      process.exit(1);
    }

    console.log(`Wrote ${opts.out}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
