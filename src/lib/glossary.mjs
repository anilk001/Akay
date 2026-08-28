// §3a — the customs glossary, and the mapping from a catalogue badge to its
// entry.
//
// Every line in the catalogue carries a Bond/Customs Status: T1, T2, Bonded,
// Duty Paid, On Floor or Other. An EU wholesaler reads those at a glance. An
// importer in Lagos, Dubai or São Paulo does not, and a code they cannot decode
// is a reason to close the tab rather than ask. The badge therefore links
// straight to the entry that explains it.
//
// The six statuses here are the exact options on the Airtable single-select, so
// no live badge can point at a missing anchor.

export const BOND_ENTRIES = [
  {
    id: 't1',
    term: 'T1',
    match: ['t1'],
    short: 'Goods moving under customs control, duty and excise not yet paid.',
    body: [
      'T1 is a customs transit status, not a product grade. The stock is physically inside the EU but has never been cleared for sale here: import duty, excise and VAT are all still suspended, and the consignment moves between bonded warehouses under a customs guarantee.',
      'This is the normal status for export business. It is usually 15–40% cheaper than the same stock duty-paid, because none of the destination taxes are in the price yet.',
      'To buy T1 you need somewhere to receive it under bond — a bonded warehouse, a customs-approved consignee, or an export shipment leaving the EU. If you intend to sell the goods inside the EU, you (or your warehouse) clear them on arrival and pay the duty then.',
    ],
  },
  {
    id: 't2',
    term: 'T2',
    match: ['t2'],
    short: 'Union goods, cleared and free to circulate inside the EU.',
    body: [
      'T2 means the goods have EU status: import duty has been paid, and they can move and be sold anywhere in the single market without further customs formality.',
      'Excise on alcohol is a separate question from customs status — T2 stock may still be moving under excise suspension between tax warehouses. Where a line is both cleared and excise-paid, we list it as Duty Paid.',
      'T2 is the right status if you are a distributor or retailer selling inside the EU and do not hold a bonded facility.',
    ],
  },
  {
    id: 'bonded',
    term: 'Bonded',
    match: ['bonded'],
    short: 'Physically held in a customs or excise bonded warehouse.',
    body: [
      'Bonded describes where the stock is sitting: a warehouse authorised to hold goods with duty and excise suspended. Loendersloot in the Netherlands is the best-known example in the drinks trade.',
      'Bonded stock can ship to you under bond (staying in suspension) or be cleared on the way out. Which one applies changes the landed cost significantly, so it is settled in the quote, not assumed.',
      'Practically, bonded and T1 overlap: a bonded line is normally offered T1 for export.',
    ],
  },
  {
    id: 'duty-paid',
    term: 'Duty Paid',
    match: ['duty paid', 'duty-paid', 'dutypaid'],
    short: 'Import duty and excise both settled — ready to sell immediately.',
    body: [
      'Duty Paid is the fully cleared position: customs duty and excise have been paid in the country where the stock sits, and it can be sold on without any further tax event.',
      'It carries the highest price of the four statuses, because the taxes are already in it. If you are exporting the goods out of the EU again, duty-paid stock is usually the wrong buy — you would be paying EU excise on something leaving the EU. Ask us about the T1 equivalent instead.',
    ],
  },
  {
    id: 'on-floor',
    term: 'On Floor',
    match: ['on floor', 'on-floor'],
    short: 'Physically present in the warehouse, available for immediate loading.',
    body: [
      'On Floor is an availability statement rather than a customs one: the stock is in the warehouse now, counted, and can be loaded as soon as the paperwork clears — as distinct from stock that is in transit, on allocation, or being sourced against your order.',
      'Ask for the customs status separately on an On Floor line; we will confirm whether it loads T1 or duty-paid.',
    ],
  },
  {
    id: 'other',
    term: 'Other',
    match: ['other'],
    short: 'A status that does not fit the standard four — ask and we will state it.',
    body: [
      'Some lines arrive with a customs position that is genuinely specific: goods in a free zone, stock under an inward-processing arrangement, or a consignment whose status changes on the loading date.',
      'Rather than force it into a category that would mislead you, we mark it Other. Ask on the line and we will tell you exactly what it is before you commit.',
    ],
  },
];

// Incoterms as they apply to us specifically (§3). Generic definitions are a
// web search away; what a buyer cannot look up is which party does what on an
// Akay shipment.
export const INCOTERMS = [
  ['EXW', 'Ex Works', 'You collect from the named warehouse. We make the goods available and provide the documents; loading, export clearance, freight and insurance are yours. Cheapest headline price, most work at your end.'],
  ['FCA', 'Free Carrier', 'We deliver to the carrier you nominate and handle export clearance. You carry the freight from that point. Common on our Loendersloot and Riga loadings.'],
  ['FOB', 'Free On Board', 'We deliver the goods on board the vessel at the named port and clear them for export. Risk transfers once loaded. Used on our sea freight out of EU and Asian ports.'],
  ['CFR', 'Cost and Freight', 'We pay the sea freight to your named destination port. Insurance is yours, and risk transfers at the load port, not on arrival.'],
  ['CIF', 'Cost, Insurance and Freight', 'As CFR, plus we carry minimum cargo insurance to the destination port. Risk still transfers at the load port — the insurance is what covers you in between.'],
  ['DAP', 'Delivered At Place', 'We deliver to your named address, freight paid. Import duty, taxes and customs clearance at destination remain yours. Our usual term for intra-EU truck deliveries.'],
];

// Maps a Bond/Customs Status value from Airtable to its glossary anchor.
// Unknown values return the page rather than a dead fragment.
export function GLOSSARY_HREF(status) {
  const key = String(status || '').trim().toLowerCase();
  const hit = BOND_ENTRIES.find((e) => e.match.includes(key));
  return hit ? `/customs-glossary/#${hit.id}` : '/customs-glossary/';
}
