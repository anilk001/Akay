let original;
try {
  original = $('Carry Existing Supplier Id Forward').all()[$itemIndex].json;
} catch (e) {
  original = $('New Sender or Skip?').all()[$itemIndex].json;
}
const extracted = $('LLM Extract Offers').item.json;

let supplierId = null;
let supplierName = null;
try {
  const created = $('Create New Supplier').item.json;
  supplierId = created.id;
  supplierName = created.fields ? created.fields['Supplier Name'] : created['Supplier Name'];
} catch (e) {
  supplierId = original.existingSupplierId || null;
  // existingSupplierName is the name on the RECORD we matched. Before the
  // resolver learned to match on domain and company name, the only fallbacks
  // were the sender's domain and address — so an offer correctly linked to
  // Halitlar Gida Ltd still carried "halitlar.com" into the internal Offer
  // Name. The old fallbacks stay for the case where nothing matched at all.
  supplierName = original.existingSupplierName || original.senderDomain || original.fromAddress || null;
}

function key(o) {
  const n = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return [n(o.productName), o.volumeMl ?? ''].join('|');  // Fixed: name+volume only
}

const rawOffers = (extracted.output && extracted.output.offers) || extracted.offers || [];
const offers = rawOffers
  .filter((o) => o.productName && o.buyPrice != null && o.currency)
  .map((o, idx) => ({
    ...o,
    productKey: key(o),
    sourceSheet: 'Email (LLM extraction, new sender)',
    // The email item carries the Gmail id as sourceMessageId (stamped by
    // Flatten Block) or id; original.messageId never existed, so every offer
    // on this path was written with a BLANK Source Message ID — which is why
    // message-level dedupe could never see them.
    sourceMessageId: original.sourceMessageId || original.id || '',
    sheetRow: idx + 1,
  }));

return {
  json: {
    ...original,
    offers,
    supplierRecordId: supplierId,
    supplierName,
    supplierTrust: 'Medium',
    // 30 days, aligned with the company-wide fallback (Anil, 2026-09-06). Was 14.
    supplierValidityDays: 30,
  },
};
