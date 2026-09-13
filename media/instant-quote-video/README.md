# Instant Quote explainer video

Source for the 42-second explainer promoting the Instant Quote feature
(the `.iq` section on the homepage / `quote.akay.ie`). It is rendered, not
filmed: `scene.html` is an animated HTML scene, Chromium steps its clock one
frame at a time, and ffmpeg encodes the frames.

Nothing here runs at site build time — this folder is a tool, not a page.

## Why rendered rather than screen-recorded

`scene.html` exposes `window.seek(t)`, which fully describes the frame at time
`t`. There are no CSS transitions or animations anywhere, so nothing depends on
when the browser happened to paint: every capture is exact, the output is
identical run to run, and a copy change means re-running two commands rather
than re-shooting and re-cutting.

## Regenerating

Playwright and ffmpeg are only needed to render, so they stay out of
`package.json` — adding them would put an ~80 MB ffmpeg download into the
5-minute refresh workflow's `npm ci`.

```bash
cd media/instant-quote-video
npm i --no-save playwright ffmpeg-static   # renderer only, not a site dependency

node render.mjs --fmt=portrait             # 1260 JPEG frames -> frames-portrait/
node encode.mjs --fmt=portrait             # -> out/akay-instant-quote-portrait.mp4
```

Omit `--fmt` on `encode.mjs` to encode every format that has frames. To check a
change without rendering 1,260 frames, grab stills instead:

```bash
node render.mjs --fmt=portrait --probe=2.6,12,26,34,40
```

Chromium comes from `CHROMIUM_PATH` (defaulting to the image's own copy) and the
logo from `AKAY_LOGO`, defaulting to `public/akay-bird.png` — the same bird the
site header uses, so the video can't drift from the brand mark.

## Formats

| `--fmt`     | Size      | For                                    |
|-------------|-----------|----------------------------------------|
| `portrait`  | 1080×1920 | WhatsApp Status, Reels, TikTok         |
| `square`    | 1080×1080 | WhatsApp chat, LinkedIn feed           |
| `landscape` | 1920×1080 | email, YouTube, embedding on the site  |

One scene file covers all three: type is sized in `--u`, which is
`min(1vw, 1vh)` and therefore 10.8px in every format, so only the column width
and vertical rhythm change per ratio.

Output is H.264 High / yuv420p / faststart with a silent AAC track — the
combination WhatsApp, Gmail and iOS all play without re-transcoding. The muted
track is deliberate: some players stall on a video with no audio stream at all.
Each file lands around 3–4 MB, well inside WhatsApp's 16 MB limit.

## Editing

- **Copy** lives in the markup in `scene.html`, one `<section class="scene">`
  per beat. It mirrors the homepage's own Instant Quote copy — if that changes,
  change it here too.
- **Timing** is the `S` table in the script block: `{scene: [start, end]}` in
  seconds. Every animation inside a scene is offset from its own start, so a
  scene can be re-timed without touching anything else. `DUR` is the total.
- **Example prices** are `ROWS`, matching the mock card on the homepage. They
  are illustrative and the video says so on screen — keep that disclaimer if
  the figures stay made up.

## Public-safety note

The scene is hand-written and self-contained: it never imports
`src/data/`, never reads the Airtable snapshot, and ships no offer data. The
only live figure is the offer count (5,915), which is already public on the
homepage. Keep it that way — supplier names, buy prices and margins must not
appear here any more than they may appear in `dist/`.
