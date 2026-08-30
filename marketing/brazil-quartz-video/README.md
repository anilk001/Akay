# Brazil Quartz Trip — Promo Video (Chinese voiceover)

`akay_brazil_quartz.mp4` — 1080x1920 vertical (WeChat Channels / Douyin format), ~51s,
Mandarin female voiceover, H.264 + AAC.

## Story

| # | Scene | Visual | Narration (zh) |
|---|-------|--------|----------------|
| 1 | Intro | Trip footage: large clear quartz crystal in hand at the yard in Brazil | 大家好！我们刚刚结束了巴西的水晶原石采购之旅，为大家带回了品质一流的巴西水晶。 |
| 2 | Selection | Close-ups of quartz points being hand-picked | 在巴西矿区，我们亲自考察，逐批挑选，只选晶体通透、成色好的原石。 |
| 3 | Shipment | Wide shots of the quartz piles | 首批近八吨高品质白水晶原石已经发货，正运往中国。 |
| 4 | New items | Red Jasper reel (square, blurred backdrop) | 这次考察我们还发现了不少新品:颜色饱满的紫水晶，还有红碧玉等特色原石，也在陆续到货。 |
| 5 | Warehouse | Warehouse photo (Ken Burns) | 所有货品直达我们东海的仓库，曲阳水晶街赵庄村。规格齐全，现货供应，欢迎到仓库现场看货挑选。 |
| 6 | CTA | Purple brand card: AKAY logo, WeChat QRs (Daniel + Anil), address | 按规格定价，量大优惠。扫码加微信，询价、看货、长期合作。我们在水晶街等您！ |

Branding follows the existing "Brazil Quartz Promotion Flier" (deep purple / gold / white).

## Source material

- Trip footage: `5fefdbc1-ea4d-405d-8a89-4c4515577dce.MP4` (Google Drive, 2:16 phone video of the quartz)
- Red Jasper reel: `Red Jespar video.mp4` (Google Drive)
- Warehouse photo + Daniel WeChat QR: extracted from `Quartz China/Brazil Quartz Promotion Flier.pdf` (Dropbox)
- AKAY logo + Anil WeChat QR: Google Drive
- Voiceover: kokoro multilingual TTS (sherpa-onnx), voice `zf_xiaoxiao`, generated offline
- Music: synthesized ambient pad (no licensing constraints)

## Rebuilding

The build scripts live in `build/`:

1. `build_assets.py` — renders the Chinese title/caption overlays and the CTA card (PIL + WenQuanYi Zen Hei)
2. `narration.py` — synthesizes the six narration segments (requires the sherpa-onnx kokoro-multi-lang-v1_0 model)
3. `mix_audio.py` — lays narration on the timeline, adds the ambient bed, ducks under speech
4. `build_video.sh` — renders the six scenes with ffmpeg (imageio-ffmpeg), concats, and muxes

Scene timings are set in `mix_audio.py` (offsets) and `build_video.sh` (per-scene `-ss`/`-t`).
