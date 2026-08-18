/**
 * compose() — the body of the n8n "Compose Email" Code node, extracted so it
 * can be run against real dispatch fixtures offline. Keep this function and the
 * node byte-identical; the whole point is that the preview cannot drift from
 * what the workflow sends.
 *
 * `gateAll` is the gate-passed item list ($('Gate Check').all().map(i => i.json)).
 * `onlyOfferIds` optionally restricts composition to one dispatch group — pass
 * Build Recipients' `bundleOfferIds` so the mail and the audience can never be
 * computed from different groups.
 */
function compose(gateAll, onlyOfferIds) {
  const PLACEHOLDERS = {
    PRODUCT_NAME:  { field: 'Public Product Description', required: true },
    PACK_FORMAT:   { field: 'Public Spec' },
    PRICE_LINE:    { field: 'Price Per Unit & Case' },
    PRICE_DISPLAY: { field: 'Price Display' },
    BOND_STATUS:   { field: 'Bond/Customs Status', transform: glossBondStatus },
    STOCK_DISPLAY: { field: 'Stock Display' },
    AVAILABILITY:  { field: 'Availability' },
    LEAD_TIME:     { field: 'Lead Time' },
    MOQ:           { field: 'MOQ' },
    TERMS:         { field: 'Public Terms' },
    PUBLIC_NOTE:   { field: 'Public Note' },
    VALIDITY:      { field: 'Auto Expiry Date', transform: formatDate },
  };

  function glossBondStatus(value) {
    const map = {
      't1': 'Export / duty unpaid (T1)',
      't2': 'EU free circulation (T2)',
      'bonded': 'Under bond — duty suspended',
      'duty paid': 'Duty paid',
      'on floor': 'Ex-warehouse stock',
    };
    return map[String(value ?? '').trim().toLowerCase()] || '';
  }
  function formatDate(value) {
    const s = String(value ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const [y, m, d] = s.split('-');
    return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
  }

  const UNSUBSCRIBE_TEXT = 'To stop receiving offers, reply with "unsubscribe".';
  const UNSUBSCRIBE_MAILTO = 'mailto:offers@akay.ie?subject=unsubscribe';

  const passed = gateAll.filter((g) => g.gatePassed);
  if (!passed.length) {
    return { composed: false, haltReason: 'No gate-passed offers reached Compose Email' };
  }
  // Build Recipients has already chosen which group this run sends. Honour that
  // choice rather than re-deriving it, so the two nodes cannot disagree about
  // which offers the audience was filtered for.
  let members;
  if (Array.isArray(onlyOfferIds) && onlyOfferIds.length) {
    members = onlyOfferIds.map((id) => passed.find((g) => g.offerId === id)).filter(Boolean);
    if (!members.length) {
      return {
        composed: false,
        haltReason: `Build Recipients chose offer(s) ${onlyOfferIds.join(', ')} but none of them passed the gate`,
      };
    }
  } else {
    const primary = passed[0];
    const bundleId = (primary.offerFields || {})['Bundle ID'] || null;
    members = bundleId
      ? passed.filter((g) => (g.offerFields || {})['Bundle ID'] === bundleId)
      : [primary];
  }

  const resolvedMembers = [];
  for (const m of members) {
    const f = m.offerFields || {};
    const values = {};
    const missingRequired = [];

    for (const [name, spec] of Object.entries(PLACEHOLDERS)) {
      let v = plain(f[spec.field]);
      if (spec.transform) v = spec.transform(v);
      if (spec.required && !v) missingRequired.push(`${name} (${spec.field})`);
      values[name] = v;
    }

    // A price the buyer can act on must state its basis. "Price Per Unit & Case"
    // does; the bare "Price Display" does not, and its own field description
    // ("Per-case price") is wrong on the five unit-priced Price Types. Prefer the
    // basis-labelled string; fall back only when it is empty, and then say the
    // basis in words from Price Type so the mail is never ambiguous.
    if (!values.PRICE_LINE) {
      if (!values.PRICE_DISPLAY) {
        missingRequired.push('PRICE_LINE (Price Per Unit & Case / Price Display)');
      } else {
        const basis = plain(f['Price Type']).replace(/^per\s+/i, '').toLowerCase();
        values.PRICE_LINE = basis ? `${values.PRICE_DISPLAY}/${basis}` : values.PRICE_DISPLAY;
      }
    }

    if (missingRequired.length) {
      return { composed: false, haltReason: `Refusing to send — required field(s) empty on "${f['Offer Name'] || m.offerName}": ${missingRequired.join(', ')}` };
    }

    // A bare pack count ("15") tells a buyer nothing. Grocery lines carry no
    // Volume ML, so Public Spec collapses to the PCS/Case number alone.
    if (/^\d+$/.test(values.PACK_FORMAT)) {
      values.PACK_FORMAT = `${values.PACK_FORMAT} per case`;
    }

    const leaks = [];
    const hay = Object.values(values).join(' ').toLowerCase();
    for (const supplier of namesOf(f['Supplier Name'])) {
      if (supplier.length >= 4 && hay.includes(supplier.toLowerCase())) leaks.push(`supplier name "${supplier}"`);
    }
    // Buy-price leak test. It used to also test the bare String(buy), which
    // made every offer with a small whole-number Buy Price un-sendable: Buy
    // Price 1 matched the "1" in "1 pallet/line" and halted the whole dispatch
    // with a LEAK GUARD message about a price that was never leaked. A price
    // written in public text carries decimals or a currency, so test those two
    // forms only.
    const buy = Number(f['Buy Price']);
    const sell = Number(f['Sell Price']);
    if (Number.isFinite(buy) && buy > 0 && (!Number.isFinite(sell) || Math.abs(sell - buy) > 0.005)) {
      const forms = [buy.toFixed(2)];
      if (!Number.isInteger(buy)) forms.push(String(buy));
      let found = null;
      for (const form of forms) {
        if (new RegExp(`(^|[^0-9.,])${escapeRe(form)}([^0-9]|$)`).test(hay)) { found = form; break; }
      }
      // A bare integer is only a price when a currency introduces it.
      if (!found && Number.isInteger(buy)) {
        const CURRENCY = '(?:eur|usd|gbp|aed|sgd|chf|\\$|\u20ac|\u00a3)';
        if (new RegExp(`${CURRENCY}\\s*${escapeRe(String(buy))}(?![0-9.,])`).test(hay)) found = String(buy);
      }
      if (found) leaks.push(`buy price ${found}`);
    }
    for (const addr of ['info@akay.ie', 'kai@akay.ie']) {
      if (hay.includes(addr)) leaks.push(`internal address ${addr}`);
    }
    if (leaks.length) {
      return { composed: false, haltReason: `LEAK GUARD TRIPPED on "${f['Offer Name'] || m.offerName}" — refusing to send. Found: ${leaks.join('; ')}.` };
    }

    resolvedMembers.push({ offerId: m.offerId, bundleTitle: plain(f['Bundle Title']), values });
  }

  const isBundle = resolvedMembers.length > 1;
  const bundleTitle = resolvedMembers.map((m) => m.bundleTitle).find(Boolean) || resolvedMembers[0].values.PRODUCT_NAME;
  const subject = `New Offer: ${isBundle ? bundleTitle : resolvedMembers[0].values.PRODUCT_NAME} — Limited Availability`;

  const introLine = isBundle
    ? `We have a new offer that may be of interest — ${resolvedMembers.length} products in the ${bundleTitle} range:`
    : 'We have a new offer that may be of interest:';

  const productBlocks = resolvedMembers.map((m) => {
    const v = m.values;
    const lines = [v.PRODUCT_NAME];
    if (v.PACK_FORMAT) lines.push(`Pack: ${v.PACK_FORMAT}`);
    lines.push(`Price: ${v.PRICE_LINE}`);
    if (v.BOND_STATUS) lines.push(`Status: ${v.BOND_STATUS}`);
    const avail = v.AVAILABILITY || v.STOCK_DISPLAY;
    if (avail) lines.push(`Quantity: ${avail}`);
    if (v.MOQ) lines.push(`Minimum order: ${v.MOQ}`);
    if (v.LEAD_TIME) lines.push(`Lead time: ${v.LEAD_TIME}`);
    return lines.join('\n');
  }).join('\n\n');

  // Terms and note both describe the delivery position and traders often write
  // the terms into the note. Print the note, and print Public Terms separately
  // only when the note does not already contain it — otherwise the warehouse
  // name appears twice.
  const note = resolvedMembers[0].values.PUBLIC_NOTE;
  const terms = resolvedMembers[0].values.TERMS;

  // The note is free text a trader wrote by hand, historically to supply the
  // price basis, MOQ and validity the template used to omit. Now that the
  // product block carries all three, those hand-written lines are duplicates —
  // the Coffee-Mate send of 2026-08-17 printed the whole offer twice. Drop only
  // note lines that restate something already printed above; keep everything
  // that adds information.
  const printedPriceFigures = resolvedMembers
    .flatMap((m) => m.values.PRICE_LINE.match(/\d+[.,]\d+/g) || [])
    .map((s) => s.replace(',', '.'));
  const BASIS_WORD = /\bper\s+(case|carton|box|pack|bottle|can|jar|piece|unit|btl|pc)s?\b|\/(case|carton|bottle|can|jar|piece|unit)\b/i;
  const RESTATED_FACT = /^(terms|incoterms?|delivery terms|minimum order|min order|moq|validity|valid until|price valid)\b\s*[:\-]?/i;

  const noteLines = String(note).split('\n');
  const keptNoteLines = [];
  let noteLinesDropped = 0;
  for (const raw of noteLines) {
    const line = raw.trim();
    if (!line) { keptNoteLines.push(raw); continue; }
    const restatesPrice =
      printedPriceFigures.some((fig) => line.includes(fig)) &&
      (BASIS_WORD.test(line) || /^\s*(\d+[).]|[-*\u2022])\s/.test(raw));
    const restatesFact = RESTATED_FACT.test(line);
    if (restatesPrice || restatesFact) { noteLinesDropped++; continue; }
    keptNoteLines.push(raw);
  }
  const trimmedNote = keptNoteLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Terms and validity are stated once. Public Terms is printed separately only
  // when the note that survived trimming does not already carry it, so the
  // warehouse name never appears twice.
  const closingFacts = [];
  if (terms && !squash(trimmedNote).includes(squash(terms))) closingFacts.push(`Terms: ${terms}`);
  const validity = resolvedMembers
    .map((m) => m.values.VALIDITY)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0];
  if (validity) closingFacts.push(`Validity: until ${validity}, subject to prior sale`);

  const bodyParts = [`Hi {{{FIRST_NAME|there}}},`, '', introLine, '', productBlocks];
  if (closingFacts.length) bodyParts.push('', closingFacts.join('\n'));
  if (trimmedNote) bodyParts.push('', trimmedNote);
  bodyParts.push(
    '',
    'Interested, or want to discuss quantities? Reply to this email.',
    '',
    'Have a full requirement list? Reply with an Excel attachment (Brand, Product Name, Quantity columns) and put "Requirement List" in the subject line — we\'ll price what we can straight away.',
    '',
    'Best regards,',
    'Akay Irl Ltd',
    '',
    `You're receiving this because you're registered as a buyer with Akay Irl Ltd. ${UNSUBSCRIBE_TEXT}`
  );

  const body = bodyParts.join('\n').replace(/\n{3,}/g, '\n\n');

  const leftover = `${subject}\n${body}`.match(/\{\{\{(?!FIRST_NAME)[^}]*\}\}\}/g);
  if (leftover) {
    return { composed: false, haltReason: `Unresolved placeholder(s) would have been sent verbatim: ${[...new Set(leftover)].join(', ')}` };
  }

  return {
    composed: true,
    offerId: resolvedMembers[0].offerId,
    bundleOfferIds: resolvedMembers.map((m) => m.offerId),
    isBundle,
    subject,
    bodyTemplate: body,
    noteLinesDropped,
    listUnsubscribe: UNSUBSCRIBE_MAILTO,
  };

  function plain(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(plain).filter(Boolean).join(', ');
    if (typeof v === 'object') return String(v.name ?? '');
    return String(v).trim();
  }
  function namesOf(v) {
    if (!v) return [];
    return (Array.isArray(v) ? v : [v]).map((x) => (x && typeof x === 'object' ? x.name : x)).filter(Boolean).map(String);
  }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function squash(s) { return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
}
module.exports = { compose };

// ---------------------------------------------------------------------------
// CLI: preview the exact email a dispatch will send, without sending anything.
//
//   node compose_preview.js gate-items.json
//   node compose_preview.js < gate-items.json
//
// Input is either the "Gate Check" output ([{offerId, gatePassed, offerFields}])
// or the same Offer records preflight_dispatch.py takes ([{id, fields}] or
// {"offers": [...]}) — both shapes are accepted so one export drives both tools.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const fs = require('fs');
  const raw = fs.readFileSync(process.argv[2] || 0, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`input is not valid JSON: ${err.message}`);
    process.exit(2);
  }

  const rows = Array.isArray(data) ? data : data.offers;
  if (!Array.isArray(rows) || !rows.length) {
    console.error('no offers in input');
    process.exit(2);
  }

  const gateItems = rows.map((row) => ({
    offerId: row.offerId || row.id || null,
    offerName: (row.offerFields || row.fields || row)['Offer Name'] || row.offerName || '(unnamed)',
    gatePassed: row.gatePassed !== false,
    bondStatus: (row.offerFields || row.fields || row)['Bond/Customs Status'] || null,
    offerFields: row.offerFields || row.fields || row,
  }));

  const result = compose(gateItems);
  if (!result.composed) {
    console.error(`WOULD HALT: ${result.haltReason}`);
    process.exit(1);
  }

  // FIRST_NAME is resolved per recipient by Build Sends; show a worked example.
  const render = (text, firstName) =>
    String(text).replace(/\{\{\{FIRST_NAME(\|[^}]*)?\}\}\}/g, (_m, dflt) => firstName || (dflt ? dflt.slice(1) : 'there'));

  console.log(`Subject: ${render(result.subject, 'Ahmed')}`);
  console.log(`${'-'.repeat(72)}`);
  console.log(render(result.bodyTemplate, 'Ahmed'));
  console.log(`${'-'.repeat(72)}`);
  console.log(
    `${result.isBundle ? result.bundleOfferIds.length + ' bundled line(s)' : 'single offer'}` +
      `, ${result.noteLinesDropped} duplicate Public Note line(s) dropped.`
  );
}
