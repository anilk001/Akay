// PATCH 2 — workflow DO2ltjkISp2YDNnc, node "Classify Message"
// Add BUY_SIDE beside the existing PRICE_RE, and gate processedAs on it.

// Buy-side phrasing. A priced message that is REQUESTING stock is not a
// supplier offer. Until now the only thing stopping such a message becoming
// an Offer was the sender being unknown to Suppliers; a counterparty who is
// both client and supplier (Java Distri) would have had their enquiry turned
// into an Offer to sell, at the price they asked to pay.
//
// Deliberately NARROW. A missed offer costs more than a review line, so this
// lists only phrasings that are unmistakably buy-side. Notably ABSENT:
// "do you have", "do you need", and a bare "looking for" — all three appear
// in genuine sell messages ("Do you need Pilsner Urquell...").
const BUY_SIDE = /\b(?:i(?:'|’)?d\s+like\s+(?:a\s+)?(?:quote|quotation|price)|(?:please\s+|kindly\s+)?(?:send|share)\s+(?:me\s+|us\s+)?(?:a\s+|your\s+)?(?:quote|quotation|best\s+price)|what(?:'|’)?s\s+your\s+best\s+price|can\s+you\s+(?:do|beat|match)\b|(?:we\s+are|we're|i\s+am|i'm)\s+looking\s+to\s+buy|interested\s+in\s+buying|want\s+to\s+buy|request(?:ing)?\s+(?:a\s+)?quot)/i;

// ...inside the loop, replacing the existing hasPrice/processedAs lines:

  const hasPrice = text.length > 0 && PRICE_RE.test(text);
  const isBuySide = hasPrice && BUY_SIDE.test(text);

  out.push({
    json: {
      ...j,
      hasPrice,
      isBuySide,
      processedAs: hasPrice && !isBuySide ? 'Supplier Offer' : 'Other',
    },
  });
