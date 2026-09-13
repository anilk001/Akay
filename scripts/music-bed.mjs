/**
 * Original music bed synthesiser for AKAY offer videos.
 *
 * Renders a calm, confident instrumental bed of an arbitrary length as a
 * 16-bit stereo WAV buffer. Everything is generated from scratch here, so the
 * audio on a published offer video is AKAY's own work — no stock library, no
 * licence to track, no takedown risk on WhatsApp / LinkedIn / Instagram.
 *
 * Used by scripts/add-video-audio.mjs. Pure Node, no dependencies.
 */

const TWO_PI = Math.PI * 2;

/**
 * Chord voicings as semitone offsets from the root, with the bass note first.
 * Each variant is a four-bar loop that resolves on the last bar, so a bed can
 * be cut to any length and still end somewhere musical.
 */
const VARIANTS = {
  // Warm and open — the default for a standard offer card.
  calm: {
    rootHz: 146.83, // D3
    barSeconds: 3.2,
    progression: [
      { bass: -12, tones: [0, 4, 7, 11, 14] }, // Dmaj9
      { bass: -15, tones: [-3, 0, 4, 7, 11] }, // Bm9
      { bass: -19, tones: [-7, -3, 0, 4, 7] }, // Gmaj9
      { bass: -17, tones: [-5, -1, 2, 7, 9] }, // Asus-ish, leads back round
    ],
  },
  // A touch brighter and more forward — for a launch or a hero offer.
  bright: {
    rootHz: 174.61, // F3
    barSeconds: 2.8,
    progression: [
      { bass: -12, tones: [0, 4, 7, 11, 14] },
      { bass: -17, tones: [-5, -1, 2, 5, 9] },
      { bass: -14, tones: [-2, 2, 5, 9, 12] },
      { bass: -12, tones: [0, 4, 7, 11, 16] },
    ],
  },
  // Darker and slower — suits a closing card or a market-update clip.
  deep: {
    rootHz: 130.81, // C3
    barSeconds: 3.8,
    progression: [
      { bass: -12, tones: [0, 3, 7, 10, 14] }, // Cm9
      { bass: -14, tones: [-2, 2, 5, 9, 12] },
      { bass: -17, tones: [-5, -1, 3, 7, 10] },
      { bass: -12, tones: [0, 3, 7, 10, 12] },
    ],
  },
};

export const VARIANT_NAMES = Object.keys(VARIANTS);

const semitone = (rootHz, semi) => rootHz * Math.pow(2, semi / 12);

/** Fast-attack, exponential-decay envelope for plucked notes. */
function pluckEnv(t, decay) {
  const attack = 0.006;
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

/** Raised-sine window, used to crossfade one chord's pad into the next. */
function padWindow(u) {
  if (u <= 0 || u >= 1) return 0;
  return Math.pow(Math.sin(Math.PI * u), 0.7);
}

/**
 * Schroeder-style reverb: three combs in parallel into one allpass. Delay
 * lengths differ per channel, which is what opens the stereo image up.
 */
function reverb(input, sampleRate, channelSeed) {
  const combDelays = [1231, 1597, 2053].map((d) => d + channelSeed * 37);
  const combFeedback = [0.79, 0.77, 0.75];
  const combs = combDelays.map((d) => new Float64Array(d));
  const combIdx = combDelays.map(() => 0);

  const apDelay = 347 + channelSeed * 11;
  const apBuf = new Float64Array(apDelay);
  let apIdx = 0;
  const apGain = 0.7;

  // One-pole lowpass inside the comb loop so the tail darkens as it decays,
  // instead of ringing metallically.
  const damp = 0.28;
  const lastOut = new Float64Array(combs.length);

  const out = new Float64Array(input.length);

  for (let i = 0; i < input.length; i++) {
    let acc = 0;
    for (let c = 0; c < combs.length; c++) {
      const buf = combs[c];
      const idx = combIdx[c];
      const delayed = buf[idx];
      acc += delayed;
      lastOut[c] = delayed * (1 - damp) + lastOut[c] * damp;
      buf[idx] = input[i] + lastOut[c] * combFeedback[c];
      combIdx[c] = (idx + 1) % buf.length;
    }
    acc /= combs.length;

    const delayedAp = apBuf[apIdx];
    const apOut = -apGain * acc + delayedAp;
    apBuf[apIdx] = acc + apGain * apOut;
    apIdx = (apIdx + 1) % apBuf.length;

    out[i] = apOut;
  }

  return out;
}

/**
 * Render the bed.
 *
 * @param {object} options
 * @param {number} options.seconds     Total length of the bed.
 * @param {number} [options.sampleRate]
 * @param {string} [options.variant]   One of VARIANT_NAMES.
 * @param {boolean} [options.sting]    Play a soft bell on the first frame.
 * @returns {Buffer} a 16-bit stereo WAV file.
 */
export function renderBed({ seconds, sampleRate = 48000, variant = 'calm', sting = true } = {}) {
  if (!(seconds > 0)) throw new Error(`music-bed: seconds must be positive, got ${seconds}`);
  const spec = VARIANTS[variant];
  if (!spec) {
    throw new Error(`music-bed: unknown variant "${variant}" (expected ${VARIANT_NAMES.join(', ')})`);
  }

  const { rootHz, barSeconds, progression } = spec;
  const total = Math.round(seconds * sampleRate);
  const dryL = new Float64Array(total);
  const dryR = new Float64Array(total);
  const sendL = new Float64Array(total); // what gets fed to the reverb
  const sendR = new Float64Array(total);

  // Plucks stop before the end so the last chord rings out rather than being
  // chopped off by the fade.
  const tail = Math.min(1.6, seconds * 0.25);
  const pluckUntil = Math.max(0, seconds - tail);

  const barCount = Math.max(1, Math.ceil(seconds / barSeconds));

  for (let bar = 0; bar < barCount; bar++) {
    const chord = progression[bar % progression.length];
    const barStart = bar * barSeconds;
    const isLast = bar === barCount - 1;

    // --- Pad: stacked sines, detuned across the channels for width. ---
    // The window runs a little past the bar so consecutive chords overlap.
    const padSpan = isLast ? Math.max(barSeconds, seconds - barStart) + 0.9 : barSeconds * 1.35;
    const padStart = Math.max(0, Math.floor(barStart * sampleRate));
    const padEnd = Math.min(total, Math.ceil((barStart + padSpan) * sampleRate));

    for (let ti = 0; ti < chord.tones.length; ti++) {
      const semi = chord.tones[ti];
      const f = semitone(rootHz, semi);
      // Quieter as the voicing climbs, so the top of the chord never shouts.
      const voiceGain = 0.22 / (1 + ti * 0.42);
      const phaseOffset = ti * 1.37;

      for (let i = padStart; i < padEnd; i++) {
        const t = i / sampleRate;
        const u = (t - barStart) / padSpan;
        const env = padWindow(u);
        if (env <= 0) continue;
        // A slow vibrato keeps the pad from sounding synthetic and static.
        const drift = 1 + 0.0016 * Math.sin(TWO_PI * 0.17 * t + phaseOffset);
        const left = Math.sin(TWO_PI * f * 0.9987 * drift * t + phaseOffset);
        const right = Math.sin(TWO_PI * f * 1.0013 * drift * t + phaseOffset + 0.6);
        const v = env * voiceGain;
        dryL[i] += left * v;
        dryR[i] += right * v;
        sendL[i] += left * v * 0.35;
        sendR[i] += right * v * 0.35;
      }
    }

    // --- Sub bass: the chord root, holding under everything. ---
    const bassF = semitone(rootHz, chord.bass);
    const bassEnd = Math.min(total, Math.ceil((barStart + barSeconds * 1.1) * sampleRate));
    for (let i = padStart; i < bassEnd; i++) {
      const t = i / sampleRate;
      const u = (t - barStart) / (barSeconds * 1.1);
      const env = padWindow(u);
      if (env <= 0) continue;
      // A little second harmonic so it survives a phone speaker.
      const v = (Math.sin(TWO_PI * bassF * t) + 0.22 * Math.sin(TWO_PI * bassF * 2 * t)) * env * 0.3;
      dryL[i] += v;
      dryR[i] += v;
    }

    // --- Pluck arpeggio: eighth notes walking the chord. ---
    const notesPerBar = 8;
    const noteLen = barSeconds / notesPerBar;
    const pattern = [0, 2, 4, 3, 1, 3, 2, 4];

    for (let n = 0; n < notesPerBar; n++) {
      const onset = barStart + n * noteLen;
      if (onset >= pluckUntil) break;

      const toneIdx = pattern[n % pattern.length] % chord.tones.length;
      // Lift the arpeggio an octave above the pad so it reads as a separate part.
      const f = semitone(rootHz, chord.tones[toneIdx] + 12);
      const decay = 0.42;
      const noteEnd = Math.min(total, Math.ceil((onset + decay * 4) * sampleRate));
      const noteStart = Math.max(0, Math.floor(onset * sampleRate));
      // Alternate the panning gently, note to note.
      const pan = n % 2 === 0 ? -0.22 : 0.22;
      const gL = 0.3 * (1 - pan) * 0.5 + 0.15;
      const gR = 0.3 * (1 + pan) * 0.5 + 0.15;
      // Ease the arpeggio out over the final bar rather than stopping dead.
      const fadeOut = Math.min(1, Math.max(0, (pluckUntil - onset) / 1.2));

      for (let i = noteStart; i < noteEnd; i++) {
        const t = i / sampleRate - onset;
        const env = pluckEnv(t, decay) * fadeOut;
        if (env <= 0.0001) continue;
        const body =
          Math.sin(TWO_PI * f * t) +
          0.3 * Math.sin(TWO_PI * f * 2 * t) +
          0.12 * Math.sin(TWO_PI * f * 3 * t);
        dryL[i] += body * env * gL;
        dryR[i] += body * env * gR;
        sendL[i] += body * env * gL * 0.5;
        sendR[i] += body * env * gR * 0.5;
      }
    }
  }

  // --- Opening bell, so the video starts on a deliberate note. ---
  if (sting) {
    const chord = progression[0];
    const f = semitone(rootHz, chord.tones[2] + 12);
    const partials = [1, 2.76, 5.4];
    const gains = [1, 0.36, 0.16];
    const decay = 1.9;
    const end = Math.min(total, Math.ceil(decay * 3 * sampleRate));
    for (let i = 0; i < end; i++) {
      const t = i / sampleRate;
      const env = pluckEnv(t, decay);
      if (env <= 0.0001) continue;
      let v = 0;
      for (let p = 0; p < partials.length; p++) {
        v += gains[p] * Math.sin(TWO_PI * f * partials[p] * t);
      }
      v *= env * 0.19;
      dryL[i] += v;
      dryR[i] += v;
      sendL[i] += v * 0.6;
      sendR[i] += v * 0.6;
    }
  }

  // --- Air: barely-there filtered noise, to stop the bed sounding sterile. ---
  let noiseState = 0;
  for (let i = 0; i < total; i++) {
    const white = Math.random() * 2 - 1;
    noiseState = noiseState * 0.993 + white * 0.007; // one-pole lowpass
    const t = i / sampleRate;
    const swell = 0.5 + 0.5 * Math.sin(TWO_PI * 0.09 * t);
    const v = noiseState * 0.5 * (0.4 + 0.6 * swell);
    dryL[i] += v;
    dryR[i] += v * 0.9;
  }

  // --- Reverb and mix. ---
  const wetL = reverb(sendL, sampleRate, 0);
  const wetR = reverb(sendR, sampleRate, 1);

  const fadeIn = Math.min(0.5, seconds * 0.12);
  const fadeOut = Math.min(1.4, seconds * 0.3);
  const mixL = new Float64Array(total);
  const mixR = new Float64Array(total);
  let peak = 0;

  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    let gain = 1;
    if (t < fadeIn) gain *= t / fadeIn;
    const fromEnd = seconds - t;
    if (fromEnd < fadeOut) gain *= Math.max(0, fromEnd / fadeOut);

    // Soft saturation glues the layers and guarantees nothing ever clips.
    const l = Math.tanh((dryL[i] + wetL[i] * 0.24) * 1.1) * gain;
    const r = Math.tanh((dryR[i] + wetR[i] * 0.24) * 1.1) * gain;
    mixL[i] = l;
    mixR[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }

  const normalise = peak > 0 ? 0.82 / peak : 1;
  return encodeWav(mixL, mixR, sampleRate, normalise);
}

/** Pack two float channels into a 16-bit PCM stereo WAV. */
function encodeWav(left, right, sampleRate, gain) {
  const frames = left.length;
  const bytesPerSample = 2;
  const channels = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // PCM header size
  buf.writeUInt16LE(1, 20); // format: PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buf.writeUInt16LE(channels * bytesPerSample, 32);
  buf.writeUInt16LE(8 * bytesPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of [left, right]) {
      const clamped = Math.max(-1, Math.min(1, channel[i] * gain));
      buf.writeInt16LE(Math.round(clamped * 32767), offset);
      offset += bytesPerSample;
    }
  }

  return buf;
}
