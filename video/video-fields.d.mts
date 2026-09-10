import type { VideoOffer } from './src/offer';

export declare const VIDEO_FIELDS: readonly (keyof VideoOffer)[];
export declare function toVideoOffer(o: Record<string, unknown>): VideoOffer;
