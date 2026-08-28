// Company identity for the §2 credibility block.
//
// A €50k container buyer verifies the counterparty before they enquire, and the
// first thing they look for is a registered number they can check against a
// public register. Getting this wrong is worse than leaving it blank, so
// anything Anil has not supplied stays as the TBC sentinel and is rendered as
// "on request" — never invented, never guessed from the domain.
//
// isTBC() drives a build warning so an unfilled field cannot quietly ship for
// months, and the renderer omits the row from the structured data entirely
// rather than publishing a placeholder into schema.org.

export const TBC = 'TBC';

// Akay Irl Ltd was established in 1996 (confirmed by Anil 2026-08-28), which is
// also what the CRO register shows against company number 250418 — so this is
// the one date a buyer can independently verify, and every "years in trade"
// claim on the site is counted from it rather than stated separately.
//
// Deriving the count matters: a hardcoded "30" is wrong from 1 January 2027
// onwards, and the site has already been through one round of a stale years
// figure contradicting the real one. This cannot go stale.
export const FOUNDED = 1996;

export const company = {
  // Legal identity, supplied by Anil 2026-08-28.
  registeredName: 'Akay Irl Ltd',
  cro: '250418',           // Irish CRO company number — checkable at core.cro.ie
  vat: 'IE8250418E',       // Irish VAT number
  // EORI matches the VAT number, which is the normal Irish arrangement: an
  // Irish trader's EORI is their VAT number. Listed separately anyway, because
  // a customs broker asks for "EORI" and needs to see that exact label.
  eori: 'IE8250418E',
  registeredAddress: '36 Gleann an Oir, Shannon, Co. Clare, V14 V006, Ireland',
  eircode: 'V14 V006',

  // Trading footprint. This object is the SINGLE SOURCE for every "years in
  // trade" claim on the site — /about/, the About guide, llms.txt and the
  // footer all read from here. Seven places previously hardcoded "36", which
  // contradicted the real figure; a buyer checking a supplier notices two
  // different numbers on the same site, so nothing may restate it as a literal
  // again.
  founded: FOUNDED,
  yearsTrading: new Date().getFullYear() - FOUNDED,
  countriesShipped: 'Over 50',
  containersPerMonth: TBC,

  // §3 — which payment terms to publish is Anil's commercial call (TT in
  // advance / LC / against documents). Publishing the wrong one invites
  // negotiation on terms we do not offer, so /trade-terms/ says "confirmed on
  // quotation" until this is filled in.
  paymentTerms: TBC,

  // Verified from the existing site content and the WhatsApp module.
  tradingBase: 'Shannon, Ireland',
  email: 'offers@akay.ie',
  whatsappDisplay: '00353 87 238 2368',
  responseTime: 'Enquiries answered within one business day, Monday to Friday, 09:00–17:00 GMT',
  references: 'Trade and bank references available on request',
};

// The authenticity statement (§2). Fixed wording — this is a commercial
// representation, not marketing copy, so it is stated once here and reused
// verbatim everywhere it appears.
export const authenticity = [
  'All stock is genuine brand-owner product, sourced from the brand owner or an authorised distributor.',
  'Every line is batch and best-before traceable back to the consignment it shipped in.',
  'Full export documentation is supplied with each shipment.',
  'We do not deal in counterfeit, refilled or diverted goods, and we do not knowingly supply stock whose provenance we cannot evidence.',
];

export function isTBC(value) {
  return !value || value === TBC;
}

// Rendered in place of a TBC value. "On request" is honest — the number exists,
// it just is not published yet — where a placeholder like "IE0000000" is not.
export function orRequest(value) {
  return isTBC(value) ? 'On request' : value;
}

// Called once per build from the layout. Warns rather than fails: an unfilled
// CRO number is a content gap, not a data leak, and blocking the deploy over it
// would take the catalogue down.
let warned = false;
export function warnOnTBC() {
  if (warned) return;
  warned = true;
  const missing = Object.entries(company)
    .filter(([, v]) => isTBC(v))
    .map(([k]) => k);
  if (missing.length) {
    console.warn(
      `[company] ${missing.length} credibility field(s) still TBC and rendering as "On request": ${missing.join(', ')}.\n` +
      '          Fill them in src/data/company.mjs once Anil supplies them (brief §2 / "Open items for Anil").'
    );
  }
}
