/**
 * n8n Code node — "Carry Existing Supplier Id Forward"
 * Mode: Run Once for All Items
 * Workflow: Email Body Offer Ingestion — Akay (8oPUD8d9NPVBEime)
 *
 * Decides, for each forwarded email with no Sheet Profile, whether we already
 * trade with the sender's company — and if not, what a new Supplier record
 * should be called.
 *
 * ── ISSUE 4, IN ITS WORST FORM ──────────────────────────────────────────
 * This pipeline did not match domains at all. "Search Existing Supplier if No
 * Email Profile" filtered on the address and nothing else:
 *
 *     AND({Email} != '', LOWER({Email}) = LOWER("{{ $json.fromAddress }}"))
 *
 * and this node then paired emails to rows on that same exact address. So it
 * was not merely the THIRD contact at a supplier that became a duplicate, as
 * on the Excel and PDF paths — it was the SECOND, and the fourth, and every
 * one after that. Any address we had not seen before was a brand-new supplier.
 *
 * And "Create New Supplier" named it:
 *
 *     "Supplier Name": "={{ $json.senderDomain || $json.fromAddress }}"
 *
 * — the bare domain string. That is where supplier records called
 * "halitlar.com" come from, sitting beside the real "Halitlar Gida Ltd".
 *
 * ── WHAT CHANGED ─────────────────────────────────────────────────────
 * The search node now returns the WHOLE supplier book (no filter, executeOnce)
 * and the matching happens here, against the same cascade the Excel, PDF and
 * WhatsApp pipelines run:
 *
 *   1. exact address
 *   2. domain, where every record on that domain is the same company
 *   3. company name — the sender's display name, or a company line written
 *      out in the body
 *
 * Company names are compared as whole TOKENS, never as concatenated
 * characters: a character-prefix test reads "java" as a prefix of "javana" and
 * files a Javana Foods offer against Java Distri.
 *
 * ── AMBIGUITY MUST NOT CREATE ──────────────────────────────────────────
 * Two different companies sharing a mail host is not a match, and it is also
 * not a reason to add a third record. `createSupplier` is false in that case,
 * so "Need New Supplier?" routes it onward with no supplier rather than
 * inventing one; the reason travels on the item for the review note.
 *
 * ── WHAT THIS NODE MUST NOT BREAK ──────────────────────────────────────
 * "Attach New Supplier & Finalize Offers" reads this node POSITIONALLY:
 *
 *     $('Carry Existing Supplier Id Forward').all()[$itemIndex]
 *
 * so the contract is one output item per original email, in the original
 * order. That is preserved exactly. The originals are the false branch of
 * "Has Working Column Map?", i.e. precisely the items fed into the search.
 *
 * The historical reason this node runs once for ALL items is unchanged and
 * still load-bearing: the search REPLACES each incoming item with the rows it
 * found, so its item count never lined up with the emails that went in, and a
 * batch where nobody matched collapsed into ONE synthetic {} item whose
 * pairedItem listed every input. itemMatching() cannot resolve that lineage —
 * execution 22643, two forwarded emails, one output item, a throw where the
 * right answer was simply "no existing supplier". Rebuilding one item per
 * email here needs no lineage at all.
 */

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'hotmail.co.uk',
  'outlook.com', 'outlook.fr', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr',
  'live.com', 'live.co.uk', 'icloud.com', 'me.com', 'aol.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'gmx.de', 'web.de', 'mail.ru',
  'yandex.ru', 'qq.com', '163.com', 'sina.com', 'naver.com', 'zoho.com',
  // Consumer and ISP mailboxes seen on real supplier records. Two unrelated
  // suppliers on btinternet.com are not one company — measured 2026-09-14.
  'btinternet.com', 'btconnect.com', 'talktalk.net', 'virginmedia.com', 'sky.com',
  'orange.fr', 'wanadoo.fr', 'free.fr', 'libero.it', 'virgilio.it', 'tiscali.it',
  'seznam.cz', 'onet.pl', 'wp.pl', 'o2.pl', 't-online.de', 'bluewin.ch',
  'telenet.be', 'skynet.be', 'xtra.co.nz', 'bigpond.com', 'inbox.lv', 'ymail.com',
  'rocketmail.com', 'mail.com', 'list.ru', 'bk.ru', 'inbox.ru',
]);

const OURS = /@akay\.ie$/i;

// Legal forms and subject decoration only. Industry words (trading, beverages,
// drinks, foods, distri, global, group, international) are deliberately NOT
// here: dropping them collapses "Newport Global" and "Pika Trading" into one.
const NOISE = new Set([
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'plc',
  'gmbh', 'ag', 'bv', 'nv', 'sarl', 'sas', 'sa', 'srl', 'spa', 'oy', 'ab',
  'as', 'aps', 'kft', 'sp', 'zoo', 'doo', 'ltda', 'pty', 'pte', 'co', 'company',
  'offers', 'offer', 'stock', 'stocklist', 'list', 'prices', 'price', 'pricelist',
]);

const originals = $('Has Working Column Map?').all(1);
const results = $input.all();
const lastInput = Math.max(0, results.length - 1);

// The whole supplier book, now that the search no longer filters.
const suppliers = results
  .map((r) => ({ id: (r.json || {}).id, f: (r.json || {}).fields || r.json || {} }))
  .filter((s) => s.id);

const indexes = buildIndexes(suppliers);

return originals.map((item, i) => {
  const original = item.json || {};
  const stated = cleanAddress(original.fromAddress);
  const senderName = String(original.senderName || '').trim();
  const body = String([original.prose, original.snippet, original.text, original.bodyPlain, original.body]
    .filter(Boolean).join('\n'));

  const bodyAddresses = harvestAddresses(body).filter((a) => a !== stated);
  const addresses = [stated, ...bodyAddresses].filter(Boolean);

  let hit = null;
  let ambiguous = false;
  let candidates = [];
  let via = '';

  // 1. Exact address.
  for (const addr of addresses) {
    const found = indexes.byAddress.get(addr);
    if (found) { hit = found; via = `email address ${addr}`; break; }
  }

  // 2. Domain, where the records on it are one company.
  if (!hit) {
    for (const addr of addresses) {
      const domain = addr.split('@')[1];
      if (!domain || GENERIC_DOMAINS.has(domain)) continue;
      const group = indexes.byDomain.get(domain);
      if (!group) continue;
      if (group.sameCompany) {
        hit = group.records[0];
        via = `domain ${domain} (${group.records.length} contact(s) on file for this company)`;
      } else {
        ambiguous = true;
        candidates = group.records.map((s) => text(s.f['Supplier Name'])).filter(Boolean);
        via = `AMBIGUOUS — domain ${domain} matches ${candidates.length} different suppliers: ${candidates.join(', ')}`;
      }
      break;
    }
  }

  // 3. Company name.
  if (!hit && !ambiguous) {
    for (const candidate of [senderName, ...harvestCompanyLines(body)].filter(Boolean)) {
      const hits = matchByName(candidate, suppliers);
      if (hits.length === 1) { hit = hits[0]; via = `company name "${candidate}"`; break; }
      if (hits.length > 1) {
        ambiguous = true;
        candidates = hits.map((s) => text(s.f['Supplier Name'])).filter(Boolean);
        via = `AMBIGUOUS — company name "${candidate}" matches ${candidates.length} suppliers: ${candidates.join(', ')}`;
        break;
      }
    }
  }

  // Create only on unambiguous company-level identity. A forwarded mail
  // carries CC lists and colleagues' signatures, so the message must point at
  // exactly ONE outside company, or the stated sender must name one.
  const outsideDomains = [...new Set(addresses.map((a) => a.split('@')[1]).filter((d) => d && !GENERIC_DOMAINS.has(d)))];
  const statedDomain = stated ? stated.split('@')[1] : '';
  const createDomain = outsideDomains.length === 1
    ? outsideDomains[0]
    : (statedDomain && !GENERIC_DOMAINS.has(statedDomain) ? statedDomain : '');
  const createEmail = createDomain ? (addresses.find((a) => a.split('@')[1] === createDomain) || '') : '';
  // A company name, never the bare domain string that produced "halitlar.com".
  const createName = createDomain ? (harvestCompanyLines(body)[0] || companyFromDomain(createDomain)) : '';

  const createSupplier = Boolean(!hit && !ambiguous && createEmail && createName);

  if (!hit && !ambiguous) {
    via = createSupplier
      ? `no existing supplier — creating "${createName}" from ${createEmail}`
      : `UNRESOLVED — no supplier identified from ${stated || senderName || 'this email'}; link the Supplier by hand`;
  }

  return {
    json: {
      ...original,
      existingSupplierId: hit ? hit.id : null,
      existingSupplierName: hit ? (text(hit.f['Supplier Name']) || null) : null,
      existingProfileId: null,
      createSupplier,
      createName,
      createEmail,
      supplierAmbiguous: ambiguous,
      supplierCandidates: candidates,
      supplierVia: via,
    },
    pairedItem: { item: Math.min(i, lastInput) },
  };
});

// ── helpers ────────────────────────────────────────────────────────────

function buildIndexes(rows) {
  const byAddress = new Map();
  const byDomain = new Map();
  for (const s of rows) {
    const email = cleanAddress(s.f['Email']);
    if (!email) continue;
    if (!byAddress.has(email)) byAddress.set(email, s);
    const domain = email.split('@')[1];
    if (!domain || GENERIC_DOMAINS.has(domain)) continue;
    if (!byDomain.has(domain)) byDomain.set(domain, { records: [], sameCompany: true });
    byDomain.get(domain).records.push(s);
  }
  for (const [domain, group] of byDomain.entries()) {
    // The old auto-create named its records "Garry (greeneking.co.uk)" or just
    // "greeneking.co.uk" — 98 of 395 supplier records carry that shape
    // (measured 2026-09-14). Such a name says nothing about the COMPANY, only
    // about who wrote first, so it cannot contradict a real name. Only the real
    // names on a domain decide whether it is one company; a domain carrying
    // nothing but placeholders is one company by construction.
    const real = group.records.filter((s) => !isPlaceholderName(text(s.f['Supplier Name']), domain));
    const tokens = real.map((s) => companyTokens(text(s.f['Supplier Name'])));
    group.sameCompany = tokens.length <= 1 || tokens.every((t) => sameCompany(t, tokens[0]));
    // Link to a properly named record when there is one.
    if (real.length) group.records = [...real, ...group.records.filter((s) => !real.includes(s))];
  }
  return { byAddress, byDomain };
}

function sameCompany(a, b) {
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short[0] !== long[0] || short[0].length < 3) return false;
  return short.every((t, i) => t === long[i]);
}

function companyTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !NOISE.has(t));
}

function matchByName(candidate, rows) {
  const tokens = companyTokens(candidate);
  if (!tokens.length) return [];
  // A placeholder-named record is never matched BY NAME: "Garry (greeneking.co.uk)"
  // would otherwise match any sender called Garry, and file another Garry's
  // offer against Greene King. Such records are still reached through their
  // address and domain, which is the evidence that actually identifies them.
  const hits = rows.filter((s) => {
    const n = text(s.f['Supplier Name']);
    return !isPlaceholderName(n, domainOf(s)) && sameCompany(tokens, companyTokens(n));
  });
  const distinct = [];
  for (const h of hits) {
    const hTokens = companyTokens(text(h.f['Supplier Name']));
    if (!distinct.some((d) => sameCompany(companyTokens(text(d.f['Supplier Name'])), hTokens))) distinct.push(h);
  }
  return distinct;
}

function harvestAddresses(t) {
  const found = String(t).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const out = [];
  for (const raw of found) {
    const a = cleanAddress(raw);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

function harvestCompanyLines(t) {
  const out = [];
  const LABELLED = /^(?:company|from company|supplier|firma|société|empresa)\s*[:\-]\s*(.+)$/i;
  const SUFFIXED = /^([A-Z0-9][\w&.,'’\- ]{2,60}?\s(?:Ltd|Limited|LLC|Inc|Corp|PLC|GmbH|AG|B\.?V\.?|N\.?V\.?|S\.?A\.?R\.?L\.?|S\.?A\.?|S\.?R\.?L\.?|S\.?P\.?A\.?|Oy|AB|A\/S|ApS|Kft|Pte|Pty|Ltda|Sp\.? z o\.?o\.?)\.?)\s*$/;
  for (const line of String(t).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const labelled = line.match(LABELLED);
    if (labelled) { push(labelled[1]); continue; }
    const suffixed = line.match(SUFFIXED);
    if (suffixed) push(suffixed[1]);
  }
  return out;

  function push(v) {
    // Strip a trailing comma or semicolon, but never the final dot of "S.R.L."
    const s = String(v).replace(/[,;]+$/, '').trim();
    if (s && !out.includes(s) && !/akay/i.test(s)) out.push(s);
  }
}

/** "halitlar-gida.com.tr" -> "Halitlar Gida". Never the bare domain string. */
function companyFromDomain(domain) {
  if (!domain) return '';
  const bare = String(domain).replace(/\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i, '').replace(/\.[a-z]{2,}$/i, '');
  const sld = bare.split('.').pop() || '';
  if (sld.length < 2) return '';
  return sld.split(/[-_]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * A supplier name that carries no company identity: the old auto-create's
 * "Firstname (domain)" where the bracketed domain is the record's own, or a
 * bare domain string. Judged against the record's OWN email domain so a real
 * company that happens to put a different domain in brackets is untouched.
 */
function isPlaceholderName(name, domain) {
  const n = String(name || '').trim().toLowerCase();
  const d = String(domain || '').trim().toLowerCase();
  if (!n) return true;
  const m = n.match(/\(([a-z0-9.-]+\.[a-z]{2,})\)$/);
  if (m) return !d || m[1] === d;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(n) && (!d || n === d);
}

function domainOf(s) {
  const email = cleanAddress(s.f['Email']);
  return email ? email.split('@')[1] : '';
}

function cleanAddress(v) {
  const raw = String(v ?? '').trim().toLowerCase();
  const angled = raw.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : raw).replace(/^mailto:/, '').replace(/[.,;>'"]+$/, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(addr)) return '';
  if (OURS.test(addr)) return '';
  return addr;
}

function text(v) {
  const a = Array.isArray(v) ? v[0] : v;
  if (a === null || a === undefined) return '';
  return (typeof a === 'object' ? String(a.name ?? '') : String(a)).trim();
}
