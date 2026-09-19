function compose(gateAll, onlyOfferIds) {
  const PLACEHOLDERS = {
    PRODUCT_NAME:  { field: 'Public Product Description', required: true },
    PACK_FORMAT:   { field: 'Public Spec' },
    PRICE_LINE:    { field: 'Price Per Unit & Case' },
    PRICE_DISPLAY: { field: 'Price Display' },
    BOND_STATUS:   { field: 'Bond/Customs Status', transform: glossBondStatus },
    STOCK_DISPLAY: { field: 'Stock Display' },
    STOCK_CASES:   { field: 'Stock Cases' },
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
  // Every problem found across EVERY member is collected and reported in one
  // halt, instead of returning on the first one. A halt unticks Queued for
  // Dispatch, so each early return used to cost a full fix / re-tick / re-run
  // cycle to discover only the next problem.
  const problems = [];
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

    if (!values.PRICE_LINE) {
      if (!values.PRICE_DISPLAY) {
        missingRequired.push('PRICE_LINE (Price Per Unit & Case / Price Display)');
      } else {
        const basis = plain(f['Price Type']).replace(/^per\s+/i, '').toLowerCase();
        values.PRICE_LINE = basis ? `${values.PRICE_DISPLAY}/${basis}` : values.PRICE_DISPLAY;
      }
    }

    if (missingRequired.length) {
      problems.push(`required field(s) empty on "${f['Offer Name'] || m.offerName}": ${missingRequired.join(', ')}`);
    }

    if (/^\d+$/.test(values.PACK_FORMAT)) {
      values.PACK_FORMAT = `${values.PACK_FORMAT} per case`;
    }

    const leaks = [];
    const hay = Object.values(values).join(' ').toLowerCase();
    for (const supplier of namesOf(f['Supplier Name'])) {
      if (supplier.length >= 4 && hay.includes(supplier.toLowerCase())) leaks.push(`supplier name "${supplier}"`);
    }
    const buy = Number(f['Buy Price']);
    const sell = Number(f['Sell Price']);
    if (Number.isFinite(buy) && buy > 0 && (!Number.isFinite(sell) || Math.abs(sell - buy) > 0.005)) {
      const forms = [buy.toFixed(2)];
      if (!Number.isInteger(buy)) forms.push(String(buy));
      let found = null;
      for (const form of forms) {
        if (new RegExp(`(^|[^0-9.,])${escapeRe(form)}([^0-9]|$)`).test(hay)) { found = form; break; }
      }
      if (!found && Number.isInteger(buy)) {
        const CURRENCY = '(?:eur|usd|gbp|aed|sgd|chf|[$€£])';
        if (new RegExp(`${CURRENCY}\\s*${escapeRe(String(buy))}(?![0-9.,])`).test(hay)) found = String(buy);
      }
      if (found) leaks.push(`buy price ${found}`);
    }
    for (const addr of ['info@akay.ie', 'kai@akay.ie']) {
      if (hay.includes(addr)) leaks.push(`internal address ${addr}`);
    }
    if (leaks.length) {
      problems.push(`LEAK GUARD tripped on "${f['Offer Name'] || m.offerName}": ${leaks.join('; ')}`);
    }

    if (!missingRequired.length && !leaks.length) {
      resolvedMembers.push({ offerId: m.offerId, bundleTitle: plain(f['Bundle Title']), values });
    }
  }

  if (problems.length) {
    return {
      composed: false,
      haltReason: `Refusing to send — ${problems.length} problem(s) found. Fix all of them before re-queueing:` +
        problems.map((p) => `\n  - ${p}`).join(''),
      problems,
    };
  }
  if (!resolvedMembers.length) {
    return { composed: false, haltReason: 'No offer survived composition — nothing to send.' };
  }

  const isBundle = resolvedMembers.length > 1;
  const bundleTitle = resolvedMembers.map((m) => m.bundleTitle).find(Boolean) || resolvedMembers[0].values.PRODUCT_NAME;
  const subject = `New Offer: ${isBundle ? bundleTitle : resolvedMembers[0].values.PRODUCT_NAME} — Limited Availability`;

  const introLine = isBundle
    ? `We have a new offer that may be of interest — ${resolvedMembers.length} products in the ${bundleTitle} range:`
    : 'We have a new offer that may be of interest:';

  const note = resolvedMembers[0].values.PUBLIC_NOTE;

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
      (BASIS_WORD.test(line) || /^\s*(\d+[).]|[-*•])\s/.test(raw));
    const restatesFact = RESTATED_FACT.test(line);
    if (restatesPrice || restatesFact) { noteLinesDropped++; continue; }
    keptNoteLines.push(raw);
  }
  const trimmedNote = keptNoteLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  const distinctTerms = [...new Set(resolvedMembers.map((m) => m.values.TERMS).filter(Boolean))];
  const perLineTerms = distinctTerms.length > 1;

  const leadTimes = resolvedMembers.map((m) => m.values.LEAD_TIME);
  const sharedLeadTime = leadTimes.every((t) => t && t === leadTimes[0]) ? leadTimes[0] : '';

  const productBlocks = resolvedMembers.map((m) => {
    const v = m.values;
    const lines = [v.PRODUCT_NAME];
    if (v.PACK_FORMAT) lines.push(`Pack: ${v.PACK_FORMAT}`);
    lines.push(`Price: ${v.PRICE_LINE}`);
    if (v.STOCK_CASES) lines.push(`Available: ${v.STOCK_CASES} cases`);
    else if (v.STOCK_DISPLAY) lines.push(`Available: ${v.STOCK_DISPLAY}`);
    if (v.AVAILABILITY) lines.push(`Availability: ${v.AVAILABILITY}`);
    if (v.BOND_STATUS) lines.push(`Status: ${v.BOND_STATUS}`);
    if (perLineTerms && v.TERMS && !squash(trimmedNote).includes(squash(v.TERMS))) {
      lines.push(`Terms: ${v.TERMS}`);
    }
    if (v.MOQ) lines.push(`Minimum order: ${v.MOQ}`);
    if (v.LEAD_TIME && !sharedLeadTime) lines.push(`Lead time: ${v.LEAD_TIME}`);
    return lines.join('\n');
  }).join('\n\n');

  const terms = perLineTerms ? '' : resolvedMembers[0].values.TERMS;
  const closingFacts = [];
  if (terms && !squash(trimmedNote).includes(squash(terms))) closingFacts.push(`Terms: ${terms}`);
  const validity = resolvedMembers
    .map((m) => m.values.VALIDITY)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0];
  if (validity) closingFacts.push(`Validity: until ${validity}, subject to prior sale`);

  const bodyParts = [`Hi {{{FIRST_NAME|there}}},`, '', introLine];
  if (sharedLeadTime) bodyParts.push('', `Lead time: ${sharedLeadTime}`);
  bodyParts.push('', productBlocks);
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

const gateItems = $('Gate Check').all().map((i) => i.json);
let chosenIds = null;
try {
  chosenIds = $('Build Recipients').first().json.bundleOfferIds || null;
} catch (e) {
}

return { json: compose(gateItems, chosenIds) };
