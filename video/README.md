# AKAY offer videos (Remotion)

Motion graphics for the trade catalogue, built with [Remotion](https://remotion.dev):
React components rendered to MP4. Every video is generated from the **same
public-safe offer data** that builds offers.akay.ie, so a price on a reel and a
price on the site come from one source.

This workspace is deliberately **outside** the Astro site:

- it has its own `package.json` and `node_modules`;
- the root `npm install` / `npm run build` and the Netlify deploy never touch it;
- adding motion graphics therefore cannot slow down or break the catalogue build.

## Setup

```bash
npm run video:install     # from the repo root (once)
```

## Making a video

```bash
# from the repo root
npm run video:list -- corona                    # find offers
npm run video:render -- -o "Corona Extra"       # 9:16 reel  -> video/out/*.mp4
npm run video:render -- -c OfferSquare -o recWeX4kQcETGD0JB
npm run video:render -- -c OfferRoll --category Beer -n 6
npm run video                                   # Remotion Studio (visual editor)
```

Rendered files land in `video/out/` (git-ignored).

### Compositions

| id              | size      | use                                             |
| --------------- | --------- | ----------------------------------------------- |
| `OfferReel`     | 1080×1920 | WhatsApp status, Reels, TikTok, Shorts (8s)     |
| `OfferSquare`   | 1080×1080 | LinkedIn, Instagram feed, WhatsApp broadcast    |
| `OfferWide`     | 1920×1080 | website hero, email, presentations              |
| `OfferRoll`     | 1080×1920 | multi-offer roll — title card, N offers, sign-off |
| `OfferRollWide` | 1920×1080 | same roll, 16:9                                 |

`OfferRoll` length follows the number of offers passed in
(`calculateMetadata` → 1.5s intro + 3s per offer + 2s sign-off).

### Flags

| flag | meaning |
| ---- | ------- |
| `-c, --comp <id>` | composition (default `OfferReel`) |
| `-o, --offer <id\|text>` | Airtable record id, or a substring of name/brand/category/spec |
| `--category`, `--brand`, `--featured` | narrow the pool |
| `-n, --count <n>` | offers in a roll (default 5) |
| `--theme paper\|night` | light catalogue look, or dark |
| `--layout portrait\|square\|landscape` | override the composition's default framing |
| `--title`, `--subtitle` | roll title card copy |
| `--still` | render one PNG instead of a video |
| `--frame <n>` | which frame the `--still` captures (default 40 — entrance finished) |
| `--out <path>` | output path (default `video/out/<comp>-<slug>.<ext>`) |
| `--list [query]` | print matching offers and exit |

## Where the data comes from

`render.mjs` calls `getOffers()` from `src/data/airtable.mjs` — live Airtable
when `AIRTABLE_TOKEN` is set, the committed snapshot otherwise. That function
only ever requests the `FIELDS` allowlist, and `toVideoOffer()` narrows each row
again to the fifteen keys a composition may draw. **Supplier identity, buy
prices, margins and internal notes are not in either list and cannot reach a
frame** (golden rule 1 in `CLAUDE.md`). The render CLI and the compositions
import that second allowlist from one module, `video-fields.mjs`, so putting a
new field on screen is a single deliberate, reviewable edit.

Remotion Studio opens on `src/sample-offers.json` — five real public rows, so
the editor has something on screen without bundling all 6,000.

## Chromium

Rendering needs a Chromium. `render.mjs` reuses one that is already on the
machine (`REMOTION_BROWSER_EXECUTABLE`, else Playwright's headless shell under
`PLAYWRIGHT_BROWSERS_PATH`), and otherwise lets Remotion download its own —
which needs egress to `remotion.media`.

## Fonts

Compositions use the site's font stacks. Headless Chromium has no Hoefler Text
or Segoe UI, so the generic fallbacks render — close to the site, not identical.
To pin exact type, install `@remotion/google-fonts` and call `loadFont()` in
`src/theme.ts`; note that fetches a webfont at render time.

## Layout

```
video/
  render.mjs             CLI: pick offers -> bundle -> renderMedia
  remotion.config.ts     Studio/CLI config (publicDir points at the site's public/)
  video-fields.mjs       the public-safe allowlist — one list, both consumers
  find-browser.mjs       reuse an installed Chromium when there is one
  src/
    index.ts             registerRoot
    Root.tsx             the five <Composition> declarations
    OfferSlide.tsx       one offer, all three framings
    OfferRoll.tsx        title card + slides + sign-off
    offer.ts             VideoOffer type + price/name formatting
    theme.ts             brand tokens copied from the site's :root
    sample-offers.json   Studio placeholder data
```
