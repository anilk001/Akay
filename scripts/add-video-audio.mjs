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
      --music-file <f>   Use this track as the music instead of the synth bed;
                         it is looped or trimmed to length and faded
      --variant <name>   Synth bed: ${VARIANT_NAMES.join(' | ')} (default: calm)
      --voice-file <f>   Mix this audio file in as a voiceover
      --say <text>       Synthesise a voiceover with espeak-ng (robotic — drafts only)
      --voice-delay <s>  Hold the voiceover back this long (default: 0.8)
      --music-level <n>  Music gain when there is a voiceover (default: 0.55)
      --hold <s|auto>    Freeze the last frame for this long, so a voiceover
                         that overruns the picture still fits. "auto" works out
                         the length needed. Re-encodes the video
      --stretch <n|fit>  Slow the whole picture by this factor, giving every
                         screen more time. "fit" slows it just enough to cover
                         the voiceover. Re-encodes the video.
                         Note: if the video was already cut to the narration,
                         this pushes it out of sync — prefer --hold auto
      --no-sting         Drop the opening bell (synth bed only)
      --keep-audio       Keep the video's existing audio and mix the music under it
`);
  process.exit(message ? 1 : 0);
}

function parseArgs(argv) {
  const opts = {
    input: null,
    out: null,
    variant: 'calm',
    musicFile: null,
    voiceFile: null,
    say: null,
    voiceDelay: 0.8,
    musicLevel: 0.55,
    hold: 0, // seconds, or the string 'auto'
    stretch: 1, // factor, or the string 'fit'
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
      case '--music-file': opts.musicFile = next(); break;
      case '--hold': {
        const v = next();
        opts.hold = v === 'auto' ? 'auto' : Number(v);
        break;
      }
      case '--stretch': {
        const v = next();
        opts.stretch = v === 'fit' ? 'fit' : Number(v);
        break;
      }
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
  if (opts.musicFile && !existsSync(opts.musicFile)) usage(`no such file: ${opts.musicFile}`);
  if (opts.hold !== 'auto' && (!Number.isFinite(opts.hold) || opts.hold < 0)) {
    usage('--hold takes a number of seconds or "auto"');
  }
  if (opts.hold === 'auto' && !opts.voiceFile && !opts.say) {
    usage('--hold auto needs a voiceover to measure against');
  }
  if (opts.stretch !== 'fit' && (!Number.isFinite(opts.stretch) || opts.stretch <= 0)) {
    usage('--stretch takes a positive factor or "fit"');
  }
  if (opts.stretch === 'fit' && !opts.voiceFile && !opts.say) {
    usage('--stretch fit needs a voiceover to measure against');
  }
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

/** The video's frame rate, so a re-encode keeps it. Null when unreadable. */
function probeFps(ffmpeg, file) {
  const res = run(ffmpeg, ['-hide_banner', '-i', file], { capture: true });
  const match = /,\s*([\d.]+)\s*fps\b/.exec(res.stderr || '');
  if (!match) return null;
  const fps = Number(match[1]);
  return Number.isFinite(fps) && fps > 0 ? fps : null;
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

    let voicePath = opts.voiceFile;
    if (opts.say) {
      voicePath = path.join(work, 'voice.wav');
      synthesiseSpeech(opts.say, voicePath);
    }

    // How long the voiceover needs the picture to stay up for.
    const voiceNeeds = voicePath ? probeDuration(ffmpeg, voicePath) + opts.voiceDelay : 0;

    // Holding the last frame lets a slightly-long voiceover finish. On these
    // videos the last frame is the call to action, so the extra beat is time
    // the viewer can use rather than dead air.
    const TAIL = 0.6; // a breath after the last word

    // Slowing the whole picture comes first; a hold then tops up whatever is
    // still short.
    let stretch =
      opts.stretch === 'fit' ? Math.max(1, (voiceNeeds + TAIL) / duration) : opts.stretch;
    stretch = Math.round(stretch * 10000) / 10000;
    const stretched = duration * stretch;

    let hold = opts.hold === 'auto' ? Math.max(0, voiceNeeds + TAIL - stretched) : opts.hold;
    hold = Math.round(hold * 100) / 100;
    const finalDuration = stretched + hold;

    console.log(`Clip is ${duration.toFixed(2)}s.`);
    if (voicePath) console.log(`Voiceover needs ${voiceNeeds.toFixed(2)}s.`);
    if (stretch !== 1) {
      console.log(
        `Slowing the picture ${stretch.toFixed(4)}x → ${stretched.toFixed(2)}s ` +
          `(every screen is on ${((stretch - 1) * 100).toFixed(1)}% longer).`,
      );
    }
    if (hold > 0) {
      console.log(`Holding the last frame for ${hold.toFixed(2)}s → ${finalDuration.toFixed(2)}s total.`);
    }

    // Still too short? Then the voiceover really will be clipped — say so.
    if (voicePath && voiceNeeds > finalDuration + 0.05) {
      const over = voiceNeeds - finalDuration;
      console.warn(
        `\nWARNING: the voiceover runs ${voiceNeeds.toFixed(2)}s (including the ` +
          `${opts.voiceDelay}s delay) but the video is only ${finalDuration.toFixed(2)}s.\n` +
          `         The last ${over.toFixed(2)}s of speech will be cut off.\n` +
          `         Try --hold auto, shorten the script, or drop --voice-delay.\n`,
      );
    }

    let musicPath = opts.musicFile;
    if (!musicPath) {
      musicPath = path.join(work, 'bed.wav');
      console.log(`Rendering a "${opts.variant}" bed to match.`);
      writeFileSync(
        musicPath,
        renderBed({ seconds: finalDuration, variant: opts.variant, sting: opts.sting }),
      );
    } else {
      const musicSeconds = probeDuration(ffmpeg, musicPath);
      const action = musicSeconds < finalDuration ? 'looped' : 'trimmed';
      console.log(
        `Music is ${musicSeconds.toFixed(2)}s — ${action} to ${finalDuration.toFixed(2)}s and faded.`,
      );
    }

    const keepExisting = opts.keepAudio && hasAudio(ffmpeg, opts.input);
    if (opts.keepAudio && !keepExisting) {
      console.log('No existing audio track to keep — using the bed on its own.');
    }

    // Input 0 is the video, input 1 the music, then any voiceover. A supplied
    // track is looped so a short one still covers the whole clip; the synth bed
    // is already the exact length.
    const inputs = ['-i', opts.input];
    if (opts.musicFile) inputs.push('-stream_loop', '-1');
    inputs.push('-i', musicPath);
    if (voicePath) inputs.push('-i', voicePath);

    const voiceIndex = 2;
    const filters = [];
    let musicLabel = '[1:a]';

    if (opts.musicFile) {
      // Cut the supplied track to length and top and tail it, so it never just
      // stops dead when the picture ends.
      const fadeOut = Math.min(2.5, finalDuration * 0.2);
      filters.push(
        `[1:a]atrim=0:${finalDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
          `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
          `afade=t=in:st=0:d=0.6,` +
          `afade=t=out:st=${(finalDuration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[music]`,
      );
      musicLabel = '[music]';
    }

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
        `${musicLabel}volume=${opts.musicLevel}[bedlvl]`,
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

    // Only touch the picture when a hold was asked for — otherwise the original
    // video stream is copied through untouched.
    const videoArgs = [];
    let videoMap = '0:v:0';
    if (hold > 0 || stretch !== 1) {
      const steps = [];
      // setpts rescales the timestamps; the output frame rate is pinned below,
      // so ffmpeg repeats frames to fill the extra time.
      if (stretch !== 1) steps.push(`setpts=${stretch.toFixed(6)}*PTS`);
      if (hold > 0) steps.push(`tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`);
      filters.push(`[0:v]${steps.join(',')}[vout]`);
      videoMap = '[vout]';
      videoArgs.push('-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p');
      const fps = probeFps(ffmpeg, opts.input);
      if (fps) videoArgs.push('-r', String(fps));
    } else {
      videoArgs.push('-c:v', 'copy');
    }

    const args = [
      '-hide_banner',
      '-y',
      ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', videoMap,
      '-map', '[aout]',
      ...videoArgs,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-t', finalDuration.toFixed(3),
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
