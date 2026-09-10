import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS, SERIF, MONO, THEMES, ThemeName } from './theme';
import { VideoOffer } from './offer';
import { Layout, OfferSlide } from './OfferSlide';

// A "this week's offers" roll: title card, one slide per offer, sign-off.
export const INTRO_FRAMES = 45;
export const PER_OFFER_FRAMES = 90;
export const OUTRO_FRAMES = 60;

export type OfferRollProps = {
  offers: VideoOffer[];
  title?: string;
  subtitle?: string;
  layout?: Layout;
  theme?: ThemeName;
};

export function rollDuration(offerCount: number): number {
  return INTRO_FRAMES + Math.max(offerCount, 1) * PER_OFFER_FRAMES + OUTRO_FRAMES;
}

const Card: React.FC<{
  theme: ThemeName; layout: Layout; kicker: string; headline: string; footer: string;
}> = ({ theme, layout, kicker, headline, footer }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = THEMES[theme];
  const k = layout === 'portrait' ? 1 : layout === 'landscape' ? 0.92 : 0.86;
  const s = (n: number) => n * k;
  const p = spring({ frame, fps, config: { damping: 200, mass: 0.6 } });
  const rule = interpolate(frame, [4, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      backgroundColor: t.paper, fontFamily: SANS, color: t.ink,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: `${s(88)}px ${s(80)}px`, gap: s(28),
    }}>
      <AbsoluteFill style={{
        background: `radial-gradient(120% 80% at 15% 0%, ${t.card} 0%, ${t.paper} 45%, ${t.paper2} 100%)`,
      }} />
      <div style={{ opacity: p, transform: `translateY(${(1 - p) * s(24)}px)`, display: 'flex', flexDirection: 'column', gap: s(28) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: s(20) }}>
          <Img src={staticFile('akay-bird.png')} style={{ width: s(96), height: s(96), objectFit: 'contain' }} />
          <div style={{ fontFamily: SERIF, fontSize: s(56) }}>AKAY</div>
        </div>
        <div style={{ fontSize: s(28), letterSpacing: s(5), textTransform: 'uppercase', color: t.brass, fontWeight: 600 }}>
          {kicker}
        </div>
        <div style={{ fontFamily: SERIF, fontSize: s(96), lineHeight: 1.05, letterSpacing: s(-1) }}>{headline}</div>
        <div style={{ height: s(4), width: `${rule * 100}%`, backgroundColor: t.brass, borderRadius: 999 }} />
        <div style={{ fontFamily: MONO, fontSize: s(32), color: t.inkSoft }}>{footer}</div>
      </div>
    </AbsoluteFill>
  );
};

export const OfferRoll: React.FC<OfferRollProps> = ({
  offers, title = "This week's offers", subtitle = 'Wholesale spirits, beer & FMCG by the case',
  layout = 'portrait', theme = 'paper',
}) => {
  const list = offers.length ? offers : [];
  return (
    <AbsoluteFill style={{ backgroundColor: THEMES[theme].paper }}>
      <Sequence durationInFrames={INTRO_FRAMES}>
        <Card theme={theme} layout={layout} kicker={subtitle} headline={title} footer="offers.akay.ie" />
      </Sequence>

      {list.map((offer, i) => (
        <Sequence
          key={offer.id ?? i}
          from={INTRO_FRAMES + i * PER_OFFER_FRAMES}
          durationInFrames={PER_OFFER_FRAMES}
        >
          {/* Fade the last 10 frames so slides cross into each other, not cut. */}
          <OfferSlide offer={offer} layout={layout} theme={theme} outAt={PER_OFFER_FRAMES - 10} />
        </Sequence>
      ))}

      <Sequence from={INTRO_FRAMES + list.length * PER_OFFER_FRAMES} durationInFrames={OUTRO_FRAMES}>
        <Card
          theme={theme}
          layout={layout}
          kicker="Full catalogue, live pricing"
          headline="offers.akay.ie"
          footer="Message us on WhatsApp to enquire"
        />
      </Sequence>
    </AbsoluteFill>
  );
};
