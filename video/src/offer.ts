// The offer shape a video is allowed to see, and the helpers that turn it into
// on-screen strings. The runtime allowlist itself lives in ../video-fields.mjs,
// shared with the render CLI; this type is its compile-time twin.

export type VideoOffer = {
  id: string;
  name: string;
  variants: string;
  brand: string;
  category: string;
  spec: string;
  currency: string;
  amount: number | null;
  priceDetail: string;
  priceBasis: string;
  stock: 'in' | 'warn' | 'enq';
  qty: number | null;
  terms: string;
  tier: string;
  origin: string;
};

export { toVideoOffer, VIDEO_FIELDS } from '../video-fields.mjs';

export const STOCK_LABEL: Record<VideoOffer['stock'], string> = {
  in: 'In stock',
  warn: 'Limited',
  enq: 'Enquire',
};

/** "EUR 34.80/case (120pk) · EUR 0.29/unit" -> { basis:"per case", other:"EUR 0.29/unit" } */
export function priceParts(detail: string): { basis: string; other: string } {
  const parts = String(detail || '').split('·').map((s) => s.trim());
  const first = parts[0] || '';
  const basis = /\/\s*bottle|\/\s*btl/i.test(first) ? 'per bottle'
    : /\/\s*case/i.test(first) ? 'per case'
    : /\/\s*pack/i.test(first) ? 'per pack'
    : /\/\s*unit/i.test(first) ? 'per unit' : '';
  return { basis, other: parts.slice(1).join(' · ') };
}

export function formatAmount(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  return amount.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * A third of the catalogue (2,048 of 6,273 rows in the current snapshot) carries
 * a bare pack count as its Public Spec — "40", "120" — instead of a description
 * like "24 x 355ml". Left alone that renders as a chip reading just "40". The
 * number is the units per case (it matches the "(40pk)" in the price string),
 * so label it rather than showing a naked figure.
 */
function specChip(spec: string): string {
  const trimmed = String(spec).trim();
  const bare = trimmed.match(/^(\d+)$/);
  return bare ? `${bare[1]} per case` : trimmed;
}

/** Chips under the price: spec, duty tier, origin, incoterm, cases available. */
export function chipsFor(o: VideoOffer): string[] {
  const chips: string[] = [];
  if (o.spec) chips.push(specChip(o.spec));
  if (o.tier) chips.push(o.tier === 'T1' ? 'T1 duty paid' : o.tier);
  if (o.origin) chips.push(o.origin);
  if (o.terms) chips.push(o.terms);
  // Case counts run to five figures; unseparated they read as a part number.
  if (typeof o.qty === 'number' && o.qty > 0) chips.push(`${o.qty.toLocaleString('en-IE')} cases`);
  return chips;
}

/**
 * Airtable often carries the variant in the product name *and* in the Variant
 * field ("Corona Extra — 4 x 6 x 355ml Bottles" + "4 x 6 x 355ml Bottles"). The
 * site prints both; on a full-bleed video frame the repeat is glaring, so the
 * headline drops a tail that the variant line is about to say anyway.
 */
export function displayName(o: VideoOffer): string {
  const name = String(o.name || '').trim();
  const variants = String(o.variants || '').trim();
  if (!variants) return name;
  const tail = new RegExp(`\\s*[—–-]\\s*${variants.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const trimmed = name.replace(tail, '').trim();
  return trimmed.length >= 6 ? trimmed : name;
}
