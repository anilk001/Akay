import numpy as np, soundfile as sf

SR = 48000
TOTAL = 51.5
n = int(TOTAL * SR)
mix = np.zeros(n, dtype=np.float64)

# --- narration placement (scene start + 0.4s) ---
offsets = {"s1": 0.5, "s2": 8.7, "s3": 16.9, "s4": 22.8, "s5": 32.0, "s6": 42.6}
for key, off in offsets.items():
    data, sr = sf.read(f"audio/{key}.wav")
    if data.ndim > 1:
        data = data.mean(axis=1)
    # resample 24k -> 48k (linear)
    x_old = np.linspace(0, 1, len(data))
    x_new = np.linspace(0, 1, int(len(data) * SR / sr))
    data = np.interp(x_new, x_old, data)
    i0 = int(off * SR)
    mix[i0:i0 + len(data)] += data * 0.95

# --- ambient music bed ---
t = np.arange(n) / SR
music = np.zeros(n)
chords = [
    [130.81, 196.00, 261.63, 329.63],  # C
    [110.00, 164.81, 261.63, 329.63],  # Am
    [87.31, 174.61, 261.63, 349.23],   # F
    [98.00, 196.00, 246.94, 293.66],   # G
]
seg = TOTAL / 8
for ci in range(8):
    ch = chords[ci % 4]
    i0, i1 = int(ci * seg * SR), int(min((ci + 1) * seg + 1.5, TOTAL) * SR)
    tt = t[i0:i1]
    env = np.ones(len(tt))
    a = int(1.2 * SR)
    env[:a] *= np.linspace(0, 1, a) ** 2
    r = int(1.4 * SR)
    env[-r:] *= np.linspace(1, 0, r) ** 2
    seg_wave = np.zeros(len(tt))
    for f0 in ch:
        vib = 1 + 0.002 * np.sin(2 * np.pi * 0.15 * tt)
        seg_wave += np.sin(2 * np.pi * f0 * vib * tt) * 0.9
        seg_wave += np.sin(2 * np.pi * 2 * f0 * tt) * 0.18
        seg_wave += np.sin(2 * np.pi * 3 * f0 * tt) * 0.05
    music[i0:i1] += seg_wave * env / len(ch)

# gentle sparkle: soft high plucks on beat
rng = np.random.default_rng(7)
for beat in np.arange(2, TOTAL - 3, 3.2):
    f0 = rng.choice([523.25, 659.26, 783.99, 1046.5])
    i0 = int(beat * SR)
    dur = int(1.6 * SR)
    tt = np.arange(dur) / SR
    pluck = np.sin(2 * np.pi * f0 * tt) * np.exp(-2.2 * tt) * 0.12
    music[i0:i0 + dur] += pluck

# duck music under narration, master fades
music *= 0.16
for key, off in offsets.items():
    data, sr = sf.read(f"audio/{key}.wav")
    dur = len(data) / sr
    i0, i1 = int((off - 0.15) * SR), int((off + dur + 0.3) * SR)
    music[max(0, i0):i1] *= 0.55
fade = int(1.0 * SR)
music[:fade] *= np.linspace(0, 1, fade)
fo = int(2.5 * SR)
music[-fo:] *= np.linspace(1, 0, fo)
mix += music

peak = np.abs(mix).max()
if peak > 0.92:
    mix *= 0.92 / peak
sf.write("audio/final_mix.wav", mix.astype(np.float32), SR)
print("final mix written", TOTAL, "s, peak", round(float(np.abs(mix).max()), 3))
