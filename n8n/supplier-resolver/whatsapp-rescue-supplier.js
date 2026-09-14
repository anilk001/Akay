/**
 * n8n Code node — "Resolve WA Supplier"
 * Mode: Run Once for Each Item
 * Workflow: WhatsApp Offer Ingestion — Akay (Bn6Irz2Yx7MTRnKu)
 *
 * Sits immediately after "Resolve WA Supplier (Phone)" — the original node,
 * unchanged — and rescues the messages it could not identify.
 *
 * ── WHY A SECOND NODE RATHER THAN A REWRITE ───────────────────────────────
 * The phone-based node also carries the duplicate guard, the unparseable-type
 * check, the Skip Offer Ingestion / Blacklisted gates and the shape nodes 03
 * and 04 read. All of that is correct and none of it is what failed. Only the
 * identification failed, so only the identification is replaced — and this
 * node can ONLY turn an unknown supplier into a known one. It never overrides
 * a phone match, never revives a skipped or duplicate message, and never
 * downgrades anything.
 *
 * ── WHY IT HOLDS THE NAME "Resolve WA Supplier" ───────────────────────────
 * The "Create Offers?" gate reads
 *     $('Resolve WA Supplier').item.json.supplierKnown
 * by name. n8n does not rewrite a name inside Code node source or inside an IF
 * expression when a node is renamed, so a rescue node under any other name
 * would be invisible to the one gate that decides whether an offer is written
 * at all. The original therefore became "Resolve WA Supplier (Phone)" and this
 * node took the name the workflow already asks for.
 *
 * ── ISSUE 6: "uploads from WhatsApp are often created with a blank supplier" ─
 * The original matched on phone DIGITS and nothing else:
 *
 *     suppliers.find(s => sameNumber(digits(s.fields['WhatsApp']), wanted))
 *       || ... 'WhatsApp Chat ID' || ... 'Phone'
 *
 * A supplier messaging from a second handset, a sales phone not on the record,
 * or a group is a stranger to that test. Meanwhile the message itself routinely
 * carries the company name in the sender's display name, an address in the
 * signature, or the company written out in the text — all of it discarded.
 * Anil's read of this was right: the information is there.
 *
 * Evidence used, in order of how much it can be trusted:
 *   1. an email address in the message, against Suppliers.Email
 *   2. that address's domain, where every record on it is the same company
 *   3. the sender's display name, against Supplier Name
 *   4. a company line written out in the message text
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────
 * It never creates a supplier. On WhatsApp the sender is often a broadcast
 * list or a reseller forwarding someone else's stock, so a name in the text is
 * evidence of who is SPEAKING, not proof of who is SELLING. An unmatched
 * message stays unknown, keeps its review note, and the "Create Offers?" gate
 * still refuses to write an offer against it — which is right: an offer with a
 * blank supplier is a real price nobody can say who to buy from.
 *
 * Two different companies matching is not a match. It is written into the
 * review note by name so a person can settle it in seconds.
 */

const NOISE = new Set([
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'plc',
  'gmbh', 'ag', 'bv', 'nv', 'sarl', 'sas', 'sa', 'srl', 'spa', 'oy', 'ab',
  'as', 'aps', 'kft', 'sp', 'zoo', 'doo', 'ltda', 'pty', 'pte', 'co', 'company',
  'offers', 'offer', 'stock', 'stocklist', 'list', 'prices', 'price', 'pricelist',
]);

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'hotmail.co.uk',
  'outlook.com', 'outlook.fr', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr',
  'live.com', 'live.co.uk', 'icloud.com', 'me.com', 'aol.com',
  'protonmail.com', 'proton.me', 'gmx.com', 'gmx.de', 'web.de', 'mail.ru',
  'yandex.ru', 'qq.com', '163.com', 'sina.com', 'naver.com', 'zoho.com',
]);

const OURS = /@akay\.ie$/i;

const item = { ...($input.item.json || {}) };

// Already identified by phone, or not being parsed at all (duplicate, skipped,
// unparseable type, blocked supplier). Nothing to rescue either way.
if (item.supplierKnown === true || item.parseThis !== true) {
  return { json: item };
}

const suppliers = supplierRecords();
const senderName = String(item.senderName || '').trim();
const messageText = String(item.messageText || '');
// "sheetName" is the display name or number the original node already chose as
// the human label for this chat; on a group message it is the group's name.
const chatLabel = String(item.sheetName || '').trim();

let hit = null;
let via = '';
let candidates = [];

// 1 & 2. An address in the message, then its domain.
const addresses = harvestAddresses(messageText);
const indexes = buildIndexes(suppliers);

for (const addr of addresses) {
  const found = indexes.byAddress.get(addr);
  if (found) { hit = found; via = `email address ${addr} in the message`; break; }
}

if (!hit) {
  for (const addr of addresses) {
    const domain = addr.split('@')[1];
    if (!domain || GENERIC_DOMAINS.has(domain)) continue;
    const group = indexes.byDomain.get(domain);
    if (!group) continue;
    if (group.sameCompany) {
      hit = group.records[0];
      via = `domain ${domain} in the message (${group.records.length} contact(s) on file for this company)`;
    } else {
      candidates = group.records.map((s) => text(s.f['Supplier Name'])).filter(Boolean);
    }
    break;
  }
}

// 3 & 4. The sender's display name, the chat/group label, then a company line
//        written out in the message.
if (!hit && !candidates.length) {
  for (const candidate of [senderName, chatLabel, ...harvestCompanyLines(messageText)].filter(Boolean)) {
    const hits = matchByName(candidate, suppliers);
    if (hits.length === 1) {
      hit = hits[0];
      via = candidate === senderName
        ? `sender name "${candidate}"`
        : candidate === chatLabel ? `chat name "${candidate}"` : `company name "${candidate}" in the message`;
      break;
    }
    if (hits.length > 1) {
      candidates = hits.map((s) => text(s.f['Supplier Name'])).filter(Boolean);
      break;
    }
  }
}

// ── Nothing found: keep it unknown, but say what was looked at ──────────────
if (!hit) {
  const reason = candidates.length
    ? `AMBIGUOUS: the message matches ${candidates.length} suppliers (${candidates.join(', ')}) — link the Supplier by hand; no Offer created`
    : String(item.exceptionReason || `No supplier identified from ${senderNumberLabel()} — parsed for review, no Offer created`);
  console.log(`Resolve WA Supplier: not identified — ${reason}`);
  return { json: { ...item, supplierKnown: false, exceptionReason: reason, rescueTried: true, rescueCandidates: candidates } };
}

// ── Found: fill in exactly what a phone match would have filled in ──────────
const f = hit.f;
const profileDefaults = {
  ...(text(f['Default Currency']) ? { currency: text(f['Default Currency']) } : {}),
  ...(f['Main Warehouse'] ? { warehouse: f['Main Warehouse'] } : {}),
};

// The blocking gates the phone path applies must apply here too — identifying
// a supplier we have stopped trading with is not a reason to start again.
const BLOCKING = ['Blacklisted', 'Inactive', 'Archived'];
const status = text(f['Status']);
const skip = Boolean(f['Skip Offer Ingestion']);
if (skip || BLOCKING.includes(status)) {
  const name = text(f['Supplier Name']);
  console.log(`Resolve WA Supplier: identified ${name} by ${via}, but it is skipped/blocked — not parsed`);
  return { json: {
    ...item,
    parseThis: false,
    ingestStatus: 'Skipped',
    supplierRecordId: hit.id,
    supplierName: name,
    skipReason: skip
      ? `${name}: Skip Offer Ingestion is ticked — offers not parsed on price grounds (identified by ${via})`
      : `${name}: supplier Status is ${status} — offers not parsed (identified by ${via})`,
    rescueTried: true,
  } };
}

console.log(`Resolve WA Supplier: identified ${text(f['Supplier Name'])} by ${via}`);

return { json: {
  ...item,
  supplierKnown: true,
  supplierRecordId: hit.id,
  supplierName: text(f['Supplier Name']) || null,
  supplierValidityDays: Number(f['Default Validity Days']) || null,
  supplierTrust: text(f['Trust Score']) || null,
  profileDefaults,
  exceptionReason: undefined,
  rescueTried: true,
  rescuedVia: via,
} };

// ── helpers ────────────────────────────────────────────────────────────

function supplierRecords() {
  try {
    return $('Fetch Suppliers').all()
      .map((i) => ({ id: (i.json || {}).id, f: (i.json || {}).fields || i.json || {} }))
      .filter((s) => s.id);
  } catch (e) { return []; }
}

function senderNumberLabel() {
  const n = String(item.senderNumber || '').trim();
  return n ? `number ${n}, sender "${senderName || '(none)'}" or the message text` : 'the message';
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
  for (const group of byDomain.values()) {
    const tokens = group.records.map((s) => companyTokens(text(s.f['Supplier Name'])));
    group.sameCompany = tokens.every((t) => sameCompany(t, tokens[0]));
  }
  return { byAddress, byDomain };
}

/**
 * Two names are the same company when one token list is a leading run of the
 * other and the first tokens match exactly. Compared as TOKENS, never as
 * concatenated characters — a character-prefix test reads "java" as a prefix of
 * "javana" and files a Javana Foods offer against Java Distri.
 */
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
  const hits = rows.filter((s) => sameCompany(tokens, companyTokens(text(s.f['Supplier Name']))));
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
  const LABELLED = /^(?:company|supplier|firma|from)\s*[:\-]\s*(.+)$/i;
  const SUFFIXED = /^([A-Z0-9][\w&.,'’\- ]{2,60}?\s(?:Ltd|Limited|LLC|Inc|Corp|PLC|GmbH|AG|B\.?V\.?|N\.?V\.?|S\.?A\.?R\.?L\.?|S\.?A\.?|S\.?R\.?L\.?|S\.?P\.?A\.?|Oy|AB|A\/S|ApS|Kft|Pte|Pty|Ltda|Sp\.? z o\.?o\.?)\.?)\s*$/;
  for (const line of String(t).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const labelled = line.match(LABELLED);
    if (labelled) { push(labelled[1]); continue; }
    const suffixed = line.match(SUFFIXED);
    if (suffixed) push(suffixed[1]);
  }
  return out;

  function push(v) {
    const s = String(v).replace(/[,;]+$/, '').trim();
    if (s && !out.includes(s) && !/akay/i.test(s)) out.push(s);
  }
}

function cleanAddress(v) {
  const raw = String(v ?? '').trim().toLowerCase();
  const addr = raw.replace(/^mailto:/, '').replace(/[.,;>'"]+$/, '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(addr)) return '';
  if (OURS.test(addr)) return '';
  return addr;
}

function text(v) {
  const a = Array.isArray(v) ? v[0] : v;
  if (a === null || a === undefined) return '';
  return (typeof a === 'object' ? String(a.name ?? '') : String(a)).trim();
}
