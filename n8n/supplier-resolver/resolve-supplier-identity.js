/**
 * n8n Code node — "Resolve Supplier Identity"
 * Mode: Run Once for Each Item
 *
 * One resolver for all four ingestion pipelines. Replaces the four
 * near-identical "Resolve Supplier" / "Resolve WA Supplier" nodes, which drift
 * apart every time one of them is fixed.
 *
 * ── THE THREE FAILURES IT IS BUILT AROUND ──────────────────────────────────
 *
 * 1. A SECOND PERSON AT A COMPANY WE ALREADY TRADE WITH BECOMES A NEW SUPPLIER.
 *    The old domain index did this:
 *        if (byDomain.has(domain)) byDomain.set(domain, null);
 *    — a domain seen twice was treated as ambiguous and thrown away. But two
 *    records on halitlar.com are not an ambiguity, they are two colleagues.
 *    So the moment a supplier had a second contact on file, everyone else at
 *    that company resolved to nothing and was auto-created as a duplicate.
 *    The fix is to ask whether the records on a domain are the same COMPANY,
 *    not whether there is more than one of them. Genuinely different companies
 *    sharing a domain stay ambiguous and go to a person.
 *
 * 2. A SUPPLIER WHOSE DETAILS ARE IN THE EMAIL IS NOT CREATED.
 *    The old code found the real sender only behind a literal
 *    "-----Forwarded message-----" marker. Outlook forwards, reply chains and
 *    "please see below" all failed it, so fromAddress stayed offers@akay.ie,
 *    externalSender was false, and nothing was created or matched — even
 *    though the address was sitting in the body four lines down. Addresses are
 *    now harvested from the whole body, not just a marker block.
 *
 * 3. WHATSAPP OFFERS LAND WITH A BLANK SUPPLIER.
 *    The old WhatsApp resolver matched on phone digits and nothing else, and
 *    ignored the sender's display name, the group name and the message text —
 *    which routinely carry the company name, a website, or a signature with an
 *    address on it. Every one of those is evidence, and it was being discarded.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 * It never resolves to a company on weak evidence alone, and it never invents
 * a supplier named after a person. `createName` is a COMPANY name, taken from
 * a signature line or derived from the domain — because "John Smith" and
 * "Sales Team" as supplier records are how the base filled up with duplicates
 * carrying slightly wrong details in the first place.
 *
 * When nothing resolves, the answer is `confidence: 'none'` and no offer
 * should be created. An offer whose supplier is blank is an orphan: the price
 * is real and nobody can say who to buy it from.
 *
 * ── INPUT ───────────────────────────────────────────────────────────────────
 *   suppliers  the Fetch Suppliers snapshot, [{ id, fields }]
 *   evidence   { channel, fromAddress, envelopeFrom, senderName, subject,
 *                bodyText, senderNumber, groupName }
 *
 * Every field is optional. Give it what the channel has.
 */

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'hotmail.co.uk',
  'outlook.com', 'outlook.fr', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr',
  'live.com', 'live.co.uk', 'icloud.com', 'me.com', 'aol.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'gmx.de', 'web.de', 'mail.ru',
  'yandex.ru', 'qq.com', '163.com', 'sina.com', 'naver.com', 'zoho.com',
]);

// Our own addresses. The forwarder is never the supplier.
const OURS = /@akay\.ie$/i;

// Addresses that belong to a mail system rather than a company.
const NOT_A_PERSON = /^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|bounce|notifications?|automated)@/i;

// Words that carry no identity, dropped before two company names are compared.
// "Halitlar Gida Ltd" and "HALITLAR GIDA" are the same company; a WhatsApp
// group called "Java Distri — Offers" is the same company as "Java Distri".
//
// Deliberately NOT in here: trading, beverages, drinks, foods, distri, import,
// export, global, group, international. They look like noise and they are not.
// Dropping them collapses "Newport Global" and "Pika Trading" — two different
// companies that share a mail host — into one identity, which is the exact
// mistake this resolver exists to stop. Legal suffixes are safe to drop
// because no two companies differ only by one.
const NOISE = new Set([
  // legal form
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'plc',
  'gmbh', 'ag', 'bv', 'nv', 'sarl', 'sas', 'sa', 'srl', 'spa', 'oy', 'ab',
  'as', 'aps', 'kft', 'sp', 'zoo', 'doo', 'ltda', 'pty', 'pte', 'co', 'company',
  // subject / group-name decoration
  'offers', 'offer', 'stock', 'stocklist', 'list', 'prices', 'price', 'pricelist',
]);

const item = $input.item.json || {};
const ev = item.evidence || {};
const channel = String(ev.channel || '').toLowerCase();

const suppliers = (Array.isArray(item.suppliers) ? item.suppliers : [])
  .map((s) => ({ id: s.id || (s.fields || {}).id, f: s.fields || s }))
  .filter((s) => s.id);

const bodyText = String(ev.bodyText || '');
const senderName = String(ev.senderName || '').trim();
const groupName = String(ev.groupName || '').trim();

// The address the message claims to be from, ignoring our own forwarding
// envelope, plus every other address anywhere in the body. The stated one is
// tried first; the harvested ones are what rescue a forward that carried no
// marker.
const statedAddress = cleanAddress(ev.fromAddress);
const bodyAddresses = harvestAddresses(bodyText).filter((a) => a !== statedAddress);
const addresses = [statedAddress, ...bodyAddresses].filter(Boolean);

const evidenceUsed = [];
const indexes = buildIndexes(suppliers);

let result = null;

// ── 1. Exact address ────────────────────────────────────────────────────────
for (const addr of addresses) {
  const hit = indexes.byAddress.get(addr);
  if (hit) {
    result = resolved(hit, `email address ${addr}`, 'exact');
    evidenceUsed.push(addr === statedAddress ? 'sender address' : 'address found in the message body');
    break;
  }
}

// ── 2. Phone / WhatsApp number ──────────────────────────────────────────────
// Digits only, tolerating the trunk prefix that is dropped when a number is
// internationalised: Airtable holds "0871234567", WhatsApp reports
// "353871234567". Eight digits of overlap is the floor — six would let two
// unrelated suppliers share an identity, and the offer would be filed against
// the wrong company.
if (!result) {
  const numbers = [ev.senderNumber, ...harvestNumbers(bodyText)].map(digits).filter(Boolean);
  outer:
  for (const wanted of numbers) {
    for (const s of suppliers) {
      for (const field of ['WhatsApp', 'WhatsApp Chat ID', 'Phone', 'Phone (E.164)']) {
        if (sameNumber(digits(s.f[field]), wanted)) {
          result = resolved(s, `${field} number ${wanted}`, 'exact');
          evidenceUsed.push('phone number');
          break outer;
        }
      }
    }
  }
}

// ── 3. Domain — the colleague fix ───────────────────────────────────────────
if (!result) {
  for (const addr of addresses) {
    const domain = addr.split('@')[1];
    if (!domain || GENERIC_DOMAINS.has(domain)) continue;
    const group = indexes.byDomain.get(domain);
    if (!group) continue;

    if (group.sameCompany) {
      result = resolved(group.records[0], `domain ${domain} (${group.records.length} contact(s) on file for this company)`, 'strong');
      evidenceUsed.push('sender domain');
      break;
    }
    // Two genuinely different companies on one domain. Creating a third would
    // make it worse, and picking one would file the offer against the wrong
    // company, so this goes to a person.
    result = {
      supplierRecordId: null, supplierName: null,
      matchedVia: `domain ${domain} matches ${group.records.length} DIFFERENT suppliers`,
      confidence: 'none', ambiguous: true,
      candidates: group.records.map((s) => text(s.f['Supplier Name'])).filter(Boolean),
    };
    evidenceUsed.push('sender domain (ambiguous)');
    break;
  }
}

// ── 4. Company name, from the display name, the group name or the body ──────
if (!result) {
  const names = [senderName, groupName, ...harvestCompanyLines(bodyText), String(ev.subject || '')]
    .map((n) => String(n || '').trim())
    .filter(Boolean);

  for (const candidate of names) {
    const hits = matchByName(candidate, suppliers);
    if (hits.length === 1) {
      result = resolved(hits[0], `company name "${candidate}"`, 'strong');
      evidenceUsed.push(candidate === senderName ? 'sender display name'
        : candidate === groupName ? 'WhatsApp group name'
        : 'company name in the message');
      break;
    }
    if (hits.length > 1) {
      result = {
        supplierRecordId: null, supplierName: null,
        matchedVia: `company name "${candidate}" matches ${hits.length} suppliers`,
        confidence: 'none', ambiguous: true,
        candidates: hits.map((s) => text(s.f['Supplier Name'])).filter(Boolean),
      };
      evidenceUsed.push('company name (ambiguous)');
      break;
    }
  }
}

if (!result) {
  result = { supplierRecordId: null, supplierName: null, matchedVia: 'no match', confidence: 'none', ambiguous: false, candidates: [] };
}

// ── Should a supplier be created? ───────────────────────────────────────────
// Only on COMPANY-level identity, and never while a match is merely ambiguous:
// an ambiguity is resolved by a person, not by adding a third record to it.
const createDomain = addresses.map((a) => a.split('@')[1]).find((d) => d && !GENERIC_DOMAINS.has(d)) || '';
const createEmail = addresses.find((a) => a.split('@')[1] === createDomain) || addresses[0] || '';
const companyFromBody = harvestCompanyLines(bodyText)[0] || '';
const createName = companyFromBody || companyFromDomain(createDomain) || '';

const needCreate = Boolean(
  !result.supplierRecordId && !result.ambiguous && createEmail && createName
);

const note = result.supplierRecordId
  ? `Supplier resolved by ${result.matchedVia}.`
  : result.ambiguous
    ? `NEEDS ATTENTION: supplier is ambiguous — ${result.matchedVia}: ${result.candidates.join(', ')}. Link the right one by hand; no supplier was created.`
    : needCreate
      ? `No existing supplier matched; creating "${createName}" from ${createEmail}.`
      : `NEEDS ATTENTION: no supplier could be identified from ${describeEvidence()}. Link the Supplier by hand — without it this offer has no supplier email, country or trust level.`;

return {
  json: {
    ...result,
    channel,
    needCreate,
    createName,
    createEmail,
    createDomain,
    statedAddress,
    addressesSeen: addresses,
    evidenceUsed,
    note,
  },
};

// ── helpers ─────────────────────────────────────────────────────────────────

function resolved(s, via, confidence) {
  return {
    supplierRecordId: s.id,
    supplierName: text(s.f['Supplier Name']) || null,
    validityDays: numOrNull(s.f['Default Validity Days']),
    defaultCurrency: text(s.f['Default Currency']) || null,
    defaultMargin: numOrNull(s.f['Default Margin %']),
    trustScore: text(s.f['Trust Score']) || null,
    status: text(s.f['Status']) || null,
    skipIngestion: Boolean(s.f['Skip Offer Ingestion']),
    matchedVia: via,
    confidence,
    ambiguous: false,
    candidates: [],
  };
}

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

  // A domain is usable when every record on it is the same company.
  for (const group of byDomain.values()) {
    const tokens = group.records.map((s) => companyTokens(text(s.f['Supplier Name'])));
    group.sameCompany = tokens.every((t) => sameCompany(t, tokens[0]));
  }
  return { byAddress, byDomain };
}

/**
 * Two company names are the same company when one name's identity tokens are a
 * leading run of the other's: ['halitlar'] and ['halitlar','gida'] agree,
 * ['halitlar','gida'] and ['halitlar','gida'] agree.
 *
 * Compared as TOKENS, never as concatenated characters. A character-prefix
 * test reads "java" as a prefix of "javana" and files a Javana Foods offer
 * against Java Distri — a real company, a real price, and the wrong supplier
 * on the record. Whole tokens cannot do that.
 *
 * The first token must match exactly and be at least three characters, so a
 * name made only of legal forms ("Ltd") matches nothing at all.
 */
function sameCompany(a, b) {
  if (!a.length || !b.length) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short[0] !== long[0] || short[0].length < 3) return false;
  return short.every((t, i) => t === long[i]);
}

/**
 * The identity tokens of a company name: lowercased, punctuation split out,
 * legal forms and decoration dropped.
 *
 * Single characters go too, which is how the dotted legal forms disappear
 * without needing a pattern each: "B.V." splits to b + v, "S.A.R.L." to
 * s + a + r + l, and none of them survive.
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

/** Every address in the text that could belong to a supplier. */
function harvestAddresses(text) {
  const found = String(text).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const out = [];
  for (const raw of found) {
    const a = cleanAddress(raw);
    if (!a || OURS.test(a) || NOT_A_PERSON.test(a)) continue;
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/** Phone numbers in a signature: at least 9 digits, optionally +-prefixed. */
function harvestNumbers(text) {
  return (String(text).match(/\+?\d[\d\s().-]{8,}\d/g) || []).slice(0, 10);
}

/**
 * Company names stated in the text. Two shapes carry them reliably: a labelled
 * line ("Company: Halitlar Gida Ltd") and a signature line ending in a legal
 * suffix ("Java Distri B.V."). Anything looser reads marketing copy as an
 * identity, so it is left alone.
 */
function harvestCompanyLines(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const LABELLED = /^(?:company|from company|supplier|firma|société|empresa)\s*[:\-]\s*(.+)$/i;
  const SUFFIXED = /^([A-Z0-9][\w&.,'’\- ]{2,60}?\s(?:Ltd|Limited|LLC|Inc|Corp|PLC|GmbH|AG|B\.?V\.?|N\.?V\.?|S\.?A\.?R\.?L\.?|S\.?A\.?|S\.?R\.?L\.?|S\.?P\.?A\.?|Oy|AB|A\/S|ApS|Kft|Pte|Pty|Ltda|Sp\.? z o\.?o\.?)\.?)\s*$/;

  for (const line of lines) {
    const labelled = line.match(LABELLED);
    if (labelled) { push(labelled[1]); continue; }
    const suffixed = line.match(SUFFIXED);
    if (suffixed) push(suffixed[1]);
  }
  return out;

  function push(v) {
    // Strip a trailing comma or semicolon from a list, but never the final
    // dot of "S.R.L." — that dot is part of the company's name as printed.
    const s = String(v).replace(/[,;]+$/, '').trim();
    if (s && !out.includes(s) && !OURS.test(s) && !/akay/i.test(s)) out.push(s);
  }
}

/** "halitlar-gida.com.tr" -> "Halitlar Gida". Never a person's name. */
function companyFromDomain(domain) {
  if (!domain) return '';
  const MULTI_PART_TLD = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i;
  const bare = String(domain).replace(MULTI_PART_TLD, '').replace(/\.[a-z]{2,}$/i, '');
  const sld = bare.split('.').pop() || '';
  if (sld.length < 2) return '';
  return sld
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function describeEvidence() {
  const bits = [];
  if (statedAddress) bits.push(`address ${statedAddress}`);
  if (ev.senderNumber) bits.push(`number ${ev.senderNumber}`);
  if (senderName) bits.push(`sender "${senderName}"`);
  if (groupName) bits.push(`group "${groupName}"`);
  return bits.length ? bits.join(', ') : 'the message (no address, number or name on it)';
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

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function digits(v) { return String(v ?? '').replace(/\D/g, ''); }

function sameNumber(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  for (const x of nationalForms(a)) {
    for (const y of nationalForms(b)) {
      const [shorter, longer] = x.length < y.length ? [x, y] : [y, x];
      if (shorter.length >= 8 && longer.endsWith(shorter)) return true;
    }
  }
  return false;
}

function nationalForms(n) {
  const forms = new Set([n]);
  if (n.startsWith('00')) forms.add(n.slice(2));
  if (n.startsWith('0')) forms.add(n.replace(/^0+/, ''));
  return [...forms].filter(Boolean);
}
