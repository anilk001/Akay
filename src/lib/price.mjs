// One place that turns a normalized offer's price basis into words.
// The catalogue prices some lines per case and others per bottle, piece, jar
// or can — printing "/ case" on all of them puts a wrong price in the page
// title, the meta description and the card, which is exactly what Google
// shows in the SERP. Basis values come from src/data/airtable.mjs.
export function basisNoun(priceBasis = '') {
  const b = String(priceBasis).toLowerCase();
  if (/case|pack/.test(b)) return 'case';
  if (/bottle|btl/.test(b)) return 'bottle';
  if (/piece|jar|can|unit/.test(b)) return 'unit';
  return '';
}

// "USD 113.40 per case" — or "price on enquiry" when the line has no price.
export function priceLabel(offer, { short = false } = {}) {
  if (offer.amount == null || !offer.currency) return 'price on enquiry';
  const noun = basisNoun(offer.priceBasis);
  const money = `${offer.currency} ${offer.amount.toFixed(2)}`;
  if (!noun) return money;
  return short ? `${money} / ${noun}` : `${money} per ${noun}`;
}
