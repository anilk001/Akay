// Single source of truth for the WhatsApp enquiry links used across the site.
//
// Every "WhatsApp Enquiry" button is a plain wa.me click-to-chat deep link —
// there is no API and no server involved, so these strings ARE the integration.
// Keeping the number in one place means a future move to a Business API number
// is a one-line change instead of a grep across nine call sites.

// International format, digits only: no '+', no spaces, no leading zero.
// wa.me rejects anything else.
export const WA_NUMBER = '353872382368';

// Human-readable form, for link text and prose.
export const WA_DISPLAY = '+353 87 238 2368';

// Bare chat link with no prefilled message.
export const WA_LINK = `https://wa.me/${WA_NUMBER}`;

// Build a prefilled enquiry for one offer.
//
// Every field is optional in Airtable, so each clause is omitted rather than
// interpolated blank: 24 of the ~2,500 live offers have no Public Spec, and at
// least one has no price. Interpolating those unguarded produced messages like
// "quote for Indomie Noodles () listed at USD " landing in the customer's chat.
export function enquiryLink(offer, basisMsg = '') {
  const parts = [`Hi, I'd like a quote for ${offer.name}`];

  if (offer.spec) parts.push(`(${offer.spec})`);

  if (offer.amount != null && offer.currency) {
    const price = `${offer.currency} ${offer.amount.toFixed(2)}`;
    parts.push(`listed at ${price}${basisMsg ? ` ${basisMsg}` : ''}`);
  }

  const text = `${parts.join(' ')}.`;
  return `${WA_LINK}?text=${encodeURIComponent(text)}`;
}
