/**
 * n8n Code node — "Resolve Supplier"
 * Mode: Run Once for All Items  ·  executeOnce: true
 * Deployed IDENTICALLY in two workflows:
 *   Excel Offer Ingestion — Akay      (j1NAhQEKz9hzi1T2)
 *   PDF/Image Offer Ingestion — Akay  (aZvwBunq4W07XqL3)
 *
 * ONE FILE, TWO DEPLOYMENTS. The two pipelines differ only in which node
 * carries the email metadata — "Read Workbook" in Excel, "Parse Offers" in
 * PDF — so this reads whichever is present and the source stays byte-identical
 * in both. Four copies of this logic drifting apart is what produced issues 4,
 * 5 and 6 in the first place; two copies that cannot drift is the fix.
 *
 * OUTPUT CONTRACT IS UNCHANGED. "Need Supplier?", "Create Missing Supplier"
 * and "Merge Supplier" read the same keys they always did, so nothing
 * downstream is rewired. New keys (ambiguous, candidates, confidence,
 * evidenceUsed) are additive; Merge Supplier ignores what it does not know.
 *
 * ── WHAT CHANGED, AND WHY ───────────────────────────────────────────────────
 *
 * 1. A COLLEAGUE IS NOT A NEW SUPPLIER (issue 4). The old domain index did:
 *        if (byDomain.has(domain)) byDomain.set(domain, null);   // "ambiguous"
 *    Two records on halitlar.com are not an ambiguity, they are two people at
 *    one company — so the moment a supplier had a SECOND contact on file,
 *    every third person there resolved to nothing and was auto-created, named
 *    `senderName || senderDomain || fromAddress`: the person. One company,
 *    three records, three people's names. Now the question is whether the
 *    records on a domain are the same COMPANY. Genuinely different companies
 *    on one mail host stay ambiguous and go to a human — and no third record
 *    is created, because an ambiguity is resolved by a person, not added to.
 *
 * 2. THE SENDER IS FOUND WITHOUT A FORWARD MARKER (issue 5). The old code
 *    recovered the real sender only behind a literal "-----Forwarded
 *    message-----" or "Begin forwarded message:". Outlook forwards, reply
 *    chains and "please see below" all fail that, leaving fromAddress as
 *    offers@akay.ie and externalSender false — so nothing matched AND nothing
 *    was created, with the supplier's address four lines down in the body.
 *    The body is now read. Note the metadata nodes do not carry it, so it is
 *    fetched from the Gmail trigger and matched on message id.
 *
 * 3. A CREATED SUPPLIER IS NAMED AFTER THE COMPANY, never the person — from a
 *    "Company:" line, a signature line ending in a legal form, or the domain.
 *
 * ── THE CARE TAKEN AROUND AUTO-CREATE ───────────────────────────────────────
 * Reading the whole body is what fixes issue 5 and also the one thing that
 * could make it worse: a forwarded mail carries CC lists, colleagues'
 * signatures and mailing-list footers, and creating a supplier from one of
 * those is a worse outcome than creating none. So MATCHING may use every
 * address found (matching an existing supplier is cheap to undo), while
 * CREATING requires that the message point at exactly one outside company:
 * one non-generic domain, or a stated sender whose domain is non-generic.
 * More than one and nothing is created.
 */

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'hotmail.co.uk',
  'outlook.com', 'outlook.fr', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr',
  'live.com', 'live.co.uk', 'icloud.com', 'me.com', 'aol.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'gmx.de', 'web.de', 'mail.ru',
  'yandex.ru', 'qq.com', '163.com', 'sina.com', 'naver.com', 'zoho.com',
]);

const OURS = /@akay\.ie$/i;
const NOT_A_PERSON = /^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|bounce|notifications?|automated)@/i;

// Legal forms and subject decoration. Industry words (trading, beverages,
// drinks, foods, distri, global, group, international) are deliberately NOT
// here: dropping them collapses "Newport Global" and "Pika Trading" — two
// different companies on one mail host — into one identity.
const NOISE = new Set([
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'plc',
  'gmbh', 'ag', 'bv', 'nv', 'sarl', 'sas', 'sa', 'srl', 'spa', 'oy', 'ab',
  'as', 'aps', 'kft', 'sp', 'zoo', 'doo', 'ltda', 'pty', 'pte', 'co', 'company',
  'offers', 'offer', 'stock', 'stocklist', 'list', 'prices', 'price', 'pricelist',
]);

// ── Inputs ──────────────────────────────────────────────────────────────────

const meta = emailMeta();
const suppliers = supplierRecords();
const bodyText = rawEmailBody(meta.sourceMessageId);

const statedAddress = cleanAddress(meta.fromAddress);
const envelopeFrom = String(meta.envelopeFrom || '');
const senderName = String(meta.senderName || '').trim();

const bodyAddresses = harvestAddresses(bodyText).filter((a) => a !== statedAddress);
const addresses = [statedAddress, ...bodyAddresses].filter(Boolean);

const evidenceUsed = [];
const indexes = buildIndexes(suppliers);

// ── The cascade ─────────────────────────────────────────────────────────────

let hit = null;
let ambiguous = false;
let candidates = [];
let via = '';

// 1. Exact address — the stated sender first, then anything in the body.
for (const addr of addresses) {
  const found = indexes.byAddress.get(addr);
  if (found) {
    hit = found;
    via = `existing supplier by email ${addr}`;
    evidenceUsed.push(addr === statedAddress ? 'sender address' : 'address found in the message body');
    break;
  }
}

// 2. Domain — where the records on it are all the same company.
if (!hit) {
  for (const addr of addresses) {
    const domain = addr.split('@')[1];
    if (!domain || GENERIC_DOMAINS.has(domain)) continue;
    const group = indexes.byDomain.get(domain);
    if (!group) continue;

    if (group.sameCompany) {
      hit = group.records[0];
      via = `existing supplier by domain ${domain} (${group.records.length} contact(s) on file for this company)`;
      evidenceUsed.push('sender domain');
    } else {
      ambiguous = true;
      candidates = group.records.map((s) => text(s.f['Supplier Name'])).filter(Boolean);
      via = `AMBIGUOUS — domain ${domain} matches ${candidates.length} different suppliers: ${candidates.join(', ')}. Link the Supplier by hand; nothing was created.`;
      evidenceUsed.push('sender domain (ambiguous)');
    }
    break;
  }
}

// 3. Company name — the sender's display name, a company line in the
//    signature, or the subject.
if (!hit && !ambiguous) {
  const names = [senderName, ...harvestCompanyLines(bodyText), String(meta.subject || '')].filter(Boolean);
  for (const candidate of names) {
    const hits = matchByName(candidate, suppliers);
    if (hits.length === 1) {
      hit = hits[0];
      via = `existing supplier by company name "${candidate}"`;
      evidenceUsed.push(candidate === senderName ? 'sender display name' : 'company name in the message');
      break;
    }
    if (hits.length > 1) {
      ambiguous = true;
      candidates = hits.map((s) => text(s.f['Supplier Name'])).filter(Boolean);
      via = `AMBIGUOUS — company name "${candidate}" matches ${candidates.length} suppliers: ${candidates.join(', ')}. Link the Supplier by hand; nothing was created.`;
      evidenceUsed.push('company name (ambiguous)');
      break;
    }
  }
}

// ── Create, but only on unambiguous company-level identity ──────────────────

const outsideDomains = [...new Set(addresses.map((a) => a.split('@')[1]).filter((d) => d && !GENERIC_DOMAINS.has(d)))];
const statedDomain = statedAddress ? statedAddress.split('@')[1] : '';

// One outside company in the message, or a stated sender that names one.
// Several and nothing is created: a CC list or a colleague's signature must
// never become a supplier record.
const createDomain = outsideDomains.length === 1
  ? outsideDomains[0]
  : (statedDomain && !GENERIC_DOMAINS.has(statedDomain) ? statedDomain : '');

const createEmail = createDomain
  ? (addresses.find((a) => a.split('@')[1] === createDomain) || '')
  : '';
const createName = createDomain
  ? (harvestCompanyLines(bodyText)[0] || companyFromDomain(createDomain))
  : '';

const needCreate = Boolean(!hit && !ambiguous && createEmail && createName);

if (!hit && !ambiguous) {
  via = needCreate
    ? `auto-create external supplier ${createEmail} as "${createName}"`
    : `UNRESOLVED — no supplier identified from ${describeEvidence()}. Link the Supplier by hand; without it this offer has no supplier email, country or trust level.`;
}

console.log(`Resolve Supplier: ${via}${evidenceUsed.length ? ` [via ${evidenceUsed.join(', ')}]` : ''}`);

return [{
  json: {
    // ── the contract Need Supplier? / Create Missing Supplier / Merge
    //    Supplier have always read ───────────────────────────────────────────
    fromAddress: statedAddress,
    senderName,
    senderDomain: statedDomain,
    externalSender: Boolean(statedAddress),
    envelopeFrom,
    existingSupplierId: hit ? hit.id : null,
    existingSupplierName: hit ? (text(hit.f['Supplier Name']) || null) : null,
    existingValidityDays: hit ? (hit.f['Default Validity Days'] ?? null) : null,
    existingDefaultCurrency: hit ? (text(hit.f['Default Currency']) || null) : null,
    needCreate,
    createEmail,
    createName,
    via,

    // ── additive: visible in the execution log and harmless downstream ──────
    ambiguous,
    candidates,
    confidence: hit ? (evidenceUsed[0] === 'sender domain' ? 'strong' : 'exact') : 'none',
    evidenceUsed,
    addressesSeen: addresses,
    bodyRead: Boolean(bodyText),
  },
}];

// ── inputs ──────────────────────────────────────────────────────────────────

/** Email metadata, from whichever of the two pipelines this is running in. */
function emailMeta() {
  for (const name of ['Read Workbook', 'Parse Offers']) {
    try {
      const j = $(name).first().json;
      if (j && (j.fromAddress !== undefined || j.sourceMessageId !== undefined)) return j;
    } catch (e) { /* not this pipeline */ }
  }
  return {};
}

function supplierRecords() {
  try {
    return $('Fetch Suppliers').all()
      .map((i) => ({ id: (i.json || {}).id, f: (i.json || {}).fields || i.json || {} }))
      .filter((s) => s.id);
  } catch (e) { return []; }
}

/**
 * The raw email body. Neither "Read Workbook" nor "Parse Offers" carries it,
 * and it is the whole point of the issue-5 fix, so it is fetched from the
 * trigger and matched on message id — not taken from .first(), which on a poll
 * that picked up several emails would be a different supplier's mail.
 */
function rawEmailBody(messageId) {
  for (const name of ['Gmail Trigger', 'Backfill — Get Message']) {
    try {
      const items = $(name).all().map((i) => i.json || {});
      if (!items.length) continue;
      const match = messageId
        ? items.find((g) => String(g.id || g.messageId || '') === String(messageId))
        : null;
      const g = match || (items.length === 1 ? items[0] : null);
      if (!g) continue;
      const body = String(g.text || g.textAsHtml || g.html || g.snippet || '');
      if (body) return body;
    } catch (e) { /* not this pipeline, or trigger not in scope */ }
  }
  return '';
}

// ── supplier index ──────────────────────────────────────────────────────────

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

  for (const group of byDomain.values()) {
    const tokens = group.records.map((s) => companyTokens(text(s.f['Supplier Name'])));
    group.sameCompany = tokens.every((t) => sameCompany(t, tokens[0]));
  }
  return { byAddress, byDomain };
}

/**
 * Two names are the same company when one token list is a leading run of the
 * other and the first tokens match exactly.
 *
 * Compared as TOKENS, never as concatenated characters. A character-prefix test
 * reads "java" as a prefix of "javana" and files a Javana Foods offer against
 * Java Distri — a real company, a real price, the wrong supplier on the record.
 */
function sameCompany(a, b) {
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short[0] !== long[0] || short[0].length < 3) return false;
  return short.every((t, i) => t === long[i]);
}

/**
 * Identity tokens: lowercased, punctuation split out, legal forms and
 * decoration dropped. Single characters go too, which is how the dotted legal
 * forms disappear without a pattern each — "B.V." splits to b + v, "S.A.R.L."
 * to s + a + r + l, and none survive.
 */
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
  const hits = rows.filter((s) => sameCompany(tokens, companyTokens(text(s.f['Supplier Name']))));

  // Several RECORDS for one company is one answer, not an ambiguity — that
  // conflation is what turned every colleague into a new supplier.
  const distinct = [];
  for (const h of hits) {
    const hTokens = companyTokens(text(h.f['Supplier Name']));
    if (!distinct.some((d) => sameCompany(companyTokens(text(d.f['Supplier Name'])), hTokens))) distinct.push(h);
  }
  return distinct;
}

// ── evidence harvesting ─────────────────────────────────────────────────────

function harvestAddresses(t) {
  const found = String(t).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const out = [];
  for (const raw of found) {
    const a = cleanAddress(raw);
    if (!a || NOT_A_PERSON.test(a)) continue;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/**
 * Company names stated in the text. Two shapes carry them reliably: a labelled
 * line ("Company: Halitlar Gida Ltd") and a signature line ending in a legal
 * form ("Java Distri B.V."). Anything looser reads marketing copy as identity.
 */
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
    // Strip a trailing comma or semicolon from a list, but never the final dot
    // of "S.R.L." — that dot is part of the company's name as printed.
    const s = String(v).replace(/[,;]+$/, '').trim();
    if (s && !out.includes(s) && !/akay/i.test(s)) out.push(s);
  }
}

/** "halitlar-gida.com.tr" -> "Halitlar Gida". Never a person's name. */
function companyFromDomain(domain) {
  if (!domain) return '';
  const bare = String(domain).replace(/\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i, '').replace(/\.[a-z]{2,}$/i, '');
  const sld = bare.split('.').pop() || '';
  if (sld.length < 2) return '';
  return sld.split(/[-_]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function describeEvidence() {
  const bits = [];
  if (statedAddress) bits.push(`address ${statedAddress}`);
  if (senderName) bits.push(`sender "${senderName}"`);
  if (envelopeFrom) bits.push(`envelope ${envelopeFrom}`);
  if (!bodyText) bits.push('no message body available');
  return bits.length ? bits.join(', ') : 'the message (no address or name on it)';
}

// ── small helpers ───────────────────────────────────────────────────────────

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
