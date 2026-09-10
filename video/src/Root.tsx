import React from 'react';
import { Composition } from 'remotion';
import { OfferSlide, OfferSlideProps } from './OfferSlide';
import { OfferRoll, OfferRollProps, rollDuration } from './OfferRoll';
import { toVideoOffer, VideoOffer } from './offer';
import sampleOffers from './sample-offers.json';

// Sample rows so `npm run studio` opens with something real on screen. Renders
// driven by render.mjs override these through inputProps with live catalogue
// data (or the committed snapshot when there is no Airtable token).
const SAMPLES: VideoOffer[] = (sampleOffers as Record<string, unknown>[]).map(toVideoOffer);

const FPS = 30;
const SINGLE_FRAMES = 8 * FPS;

export const RemotionRoot: React.FC = () => {
  const single: OfferSlideProps = { offer: SAMPLES[0], theme: 'paper' };
  const roll: OfferRollProps = { offers: SAMPLES, theme: 'paper' };

  return (
    <>
      {/* 9:16 — WhatsApp status, Reels, TikTok, Shorts */}
      <Composition
        id="OfferReel"
        component={OfferSlide}
        durationInFrames={SINGLE_FRAMES}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ ...single, layout: 'portrait' } as OfferSlideProps}
      />

      {/* 1:1 — LinkedIn, Instagram feed, WhatsApp broadcast */}
      <Composition
        id="OfferSquare"
        component={OfferSlide}
        durationInFrames={SINGLE_FRAMES}
        fps={FPS}
        width={1080}
        height={1080}
        defaultProps={{ ...single, layout: 'square' } as OfferSlideProps}
      />

      {/* 16:9 — website hero, email, presentations */}
      <Composition
        id="OfferWide"
        component={OfferSlide}
        durationInFrames={SINGLE_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ ...single, layout: 'landscape' } as OfferSlideProps}
      />

      {/* Multi-offer roll. Length follows the number of offers passed in. */}
      <Composition
        id="OfferRoll"
        component={OfferRoll}
        durationInFrames={rollDuration(SAMPLES.length)}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ ...roll, layout: 'portrait' } as OfferRollProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: rollDuration((props as OfferRollProps).offers?.length ?? 1),
        })}
      />

      <Composition
        id="OfferRollWide"
        component={OfferRoll}
        durationInFrames={rollDuration(SAMPLES.length)}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ ...roll, layout: 'landscape' } as OfferRollProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: rollDuration((props as OfferRollProps).offers?.length ?? 1),
        })}
      />
    </>
  );
};
