import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS, SERIF, MONO, THEMES, ThemeName } from './theme';
import { chipsFor, displayName, formatAmount, priceParts, STOCK_LABEL, VideoOffer } from './offer';

export type Layout = 'portrait' | 'square' | 'landscape';

export type OfferSlideProps = {
  offer: VideoOffer;
  layout?: Layout;
  theme?: ThemeName;
  /** Frames before the slide starts fading out. Omit to never fade (single-offer reels). */
  outAt?: number;
};

// Every size below is expressed against a 1080-wide portrait frame and scaled
// per layout, so one component drives the 9:16, 1:1 and 16:9 renders.
const SCALE: Record<Layout, number> = { portrait: 1, square: 0.86, landscape: 0.92 };

export const OfferSlide: React.FC<OfferSlideProps> = ({
  offer, layout = 'portrait', theme = 'paper', outAt,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = THEMES[theme];
  const k = SCALE[layout];
  const s = (n: number) => n * k;

  // Staggered spring entrance — each block lands a beat after the one above it.
  const rise = (index: number) => {
    const p = spring({ frame: frame - index * 4, fps, config: { damping: 200, mass: 0.6 } });
    return { opacity: p, transform: `translateY(${(1 - p) * s(28)}px)` };
  };

  const fadeOut = outAt === undefined
    ? 1
    : interpolate(frame, [outAt, Math.min(outAt + 10, durationInFrames)], [1, 0], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
      });

  const { basis, other } = priceParts(offer.priceDetail);
  // Count the headline price up over the first ~2/3 second, then hold.
  const counted = interpolate(frame, [0, 20], [0, offer.amount ?? 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const stockColor = offer.stock === 'in' ? t.ok : offer.stock === 'warn' ? t.warn : t.neu;
  const stockBg = offer.stock === 'in' ? t.okBg : offer.stock === 'warn' ? t.warnBg : t.neuBg;

  const headline = displayName(offer);
  const nameSize = headline.length > 46 ? s(80) : headline.length > 30 ? s(96) : s(112);

  return (
    <AbsoluteFill style={{ backgroundColor: t.paper, fontFamily: SANS, opacity: fadeOut }}>
      {/* Slow-drifting wash so a static card still feels like motion footage. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 80% at 15% 0%, ${t.card} 0%, ${t.paper} 45%, ${t.paper2} 100%)`,
          transform: `scale(${interpolate(frame, [0, durationInFrames], [1.06, 1.14])})`,
        }}
      />

      <AbsoluteFill
        style={{
          padding: layout === 'landscape' ? `${s(70)}px ${s(96)}px` : `${s(88)}px ${s(80)}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          color: t.ink,
        }}
      >
        {/* ---- masthead ---- */}
        <div style={{ ...rise(0), display: 'flex', alignItems: 'center', gap: s(20) }}>
          <Img src={staticFile('akay-bird.png')} style={{ width: s(76), height: s(76), objectFit: 'contain' }} />
          <div style={{ fontFamily: SERIF, fontSize: s(46), letterSpacing: s(1) }}>AKAY</div>
          <div style={{ flex: 1, height: 1, backgroundColor: t.line }} />
          <div style={{ fontSize: s(24), letterSpacing: s(4), textTransform: 'uppercase', color: t.muted }}>
            Trade offer
          </div>
        </div>

        {/* ---- the offer ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: s(layout === 'square' ? 20 : 30) }}>
          <div style={{ ...rise(1), height: s(4), width: s(120), backgroundColor: t.brass, borderRadius: 999 }} />
          <div style={{ ...rise(1), fontSize: s(28), letterSpacing: s(5), textTransform: 'uppercase', color: t.brass, fontWeight: 600 }}>
            {[offer.category, offer.brand].filter(Boolean).join(' · ')}
          </div>

          <div style={{ ...rise(2), fontFamily: SERIF, fontSize: nameSize, lineHeight: 1.04, letterSpacing: s(-1) }}>
            {headline}
          </div>

          {offer.variants ? (
            <div style={{ ...rise(3), fontSize: s(32), color: t.muted, lineHeight: 1.35 }}>{offer.variants}</div>
          ) : null}

          {/* price panel */}
          <div
            style={{
              ...rise(4),
              marginTop: s(10),
              backgroundColor: t.card,
              border: `1px solid ${t.line}`,
              borderLeft: `${s(8)}px solid ${t.brass}`,
              borderRadius: s(18),
              padding: `${s(40)}px ${s(44)}px`,
              // 16:9 is far wider than the panel needs; cap it so the price
              // stays a block, not a stretched band across the frame.
              maxWidth: layout === 'landscape' ? s(1180) : undefined,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: s(24),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: s(14) }}>
              <span style={{ fontFamily: MONO, fontSize: s(40), color: t.muted }}>{offer.currency}</span>
              <span style={{ fontFamily: SERIF, fontSize: s(layout === 'square' ? 118 : 148), lineHeight: 1, letterSpacing: s(-2) }}>
                {formatAmount(offer.amount === null ? null : counted)}
              </span>
            </div>
            <div style={{ textAlign: 'right', paddingBottom: s(10) }}>
              {basis ? <div style={{ fontSize: s(30), color: t.inkSoft }}>{basis}</div> : null}
              {other ? <div style={{ fontFamily: MONO, fontSize: s(26), color: t.muted, marginTop: s(6) }}>{other}</div> : null}
            </div>
          </div>

          {/* chips */}
          <div style={{ ...rise(5), display: 'flex', flexWrap: 'wrap', gap: s(12) }}>
            <span style={{
              fontSize: s(26), padding: `${s(10)}px ${s(20)}px`, borderRadius: 999,
              color: stockColor, backgroundColor: stockBg, fontWeight: 600,
            }}>
              {STOCK_LABEL[offer.stock]}
            </span>
            {chipsFor(offer).map((c) => (
              <span key={c} style={{
                fontSize: s(26), padding: `${s(10)}px ${s(20)}px`, borderRadius: 999,
                color: t.inkSoft, border: `1px solid ${t.line}`, backgroundColor: t.card,
              }}>
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* ---- call to action ---- */}
        <div style={{ ...rise(6), display: 'flex', alignItems: 'center', gap: s(20) }}>
          <div style={{
            backgroundColor: t.brass, color: '#FFFFFF', fontWeight: 700,
            fontSize: s(30), padding: `${s(18)}px ${s(34)}px`, borderRadius: 999,
          }}>
            Enquire on WhatsApp
          </div>
          <div style={{ fontFamily: MONO, fontSize: s(30), color: t.inkSoft }}>offers.akay.ie</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
