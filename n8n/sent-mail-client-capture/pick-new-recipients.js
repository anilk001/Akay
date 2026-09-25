/**
 * Sent Mail → Client Capture — "Pick New Recipients" Code node.
 *
 * Reads the mail ak@akay.ie SENT recently and returns every recipient who is
 * not yet known anywhere in the base, with the categories that mail was about.
 * Knowing is cheap to get wrong in the direction that matters: a missed client
 * costs a Pending Review row nobody created, a false one enrols a supplier or a
 * courier in the next spirits blast. So an address is dropped when it is:
 *
 *   - already a Client, or a Contact linked to one (case-insensitive email)
 *   - on a Supplier's email domain (free-mail domains excepted — a supplier on
 *     gmail.com says nothing about the next gmail.com address). A domain that
 *     is on a Client as well is a company that both buys and sells, common in
 *     the spirits trade, so there only the exact supplier addresses are
 *     skipped and a new colleague there still becomes a Client
 *   - on the IGNORE lists below
 *   - internal (@akay.ie) or a service/no-reply mailbox
 *   - one of more than MAX_RECIPIENTS on a single message — that is a
 *     broadcast, not a conversation with a client
 *
 * Categories come from the subject, attachment names and body, scored by
 * keyword (subject and file names weigh 3x). Anil's own sign-off is cut first
 * so a signature that lists every line we trade cannot tag everyone with
 * everything; quoted client text below it is kept, because what the client
 * asked for is the best evidence of what they buy. A category is kept when it
 * scores at least a third of the strongest one, so a spirits price list that
 * mentions Guinness once stays a spirits client. Nothing matched → no category,
 * never a guess: a blank field takes seconds to fill, a wrong one silently
 * mis-targets every offer after it.
 *
 * Output: ONE item { candidates, formula, summary }, or nothing when there is
 * nobody new — the scheduler simply fires again in 15 minutes.
 */
const MAX_RECIPIENTS = 10;

// People Anil emails who are not buyers (developer, accountant, lawyer …).
// Whole domains go in IGNORE_DOMAINS. Setting a wrongly added client to
// Inactive works too — any existing Clients row blocks re-adding — but
// DELETING one does not: the next run re-reads the same sent mail and
// adds them back.
const IGNORE_EMAILS = ['developerrasikul@gmail.com'];
const IGNORE_DOMAINS = [];
const INTERNAL_DOMAINS = ['akay.ie'];
const FREE_MAIL = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'gmx.de', 'gmx.net', 'mail.ru', 'yandex.ru', 'proton.me', 'protonmail.com', 'eircom.net', 'web.de', 'qq.com', '163.com'];
const SERVICE_DOMAINS = ['google.com', 'airtable.com', 'n8n.io', 'n8n.cloud', 'netlify.com', 'github.com', 'resend.com', 'resend.dev', 'stripe.com', 'paypal.com', 'docusign.net', 'dropbox.com', 'revenue.ie', 'linkedin.com', 'facebookmail.com', 'whatsapp.com', 'anthropic.com'];
const SERVICE_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|alerts?)([+._-]|$)/i;

// Interest Categories option → the Capsule Tag the offer sends select on.
// Both are real options in Clients (checked against the live schema 2026-09-25);
// writes go with typecast off, so an unknown value would fail the whole batch.
const CAPSULE_TAG = {
  Spirits: 'Indv spirits',
  Beer: 'Indv beers',
  Wine: 'Indv wines',
  Grocery: 'Indv groceries',
  Confectionery: 'Indv Confectionery',
  Toiletries: 'Indv toiletries',
  'Soft Drinks': 'Indv beverages',
  'Other FMCG': 'Indv perfumes & cosmetics',
};

const KEYWORDS = {
  Spirits: ['spirits', 'whisky', 'whiskey', 'scotch', 'bourbon', 'single malt', 'vodka', 'gin', 'rum', 'tequila', 'mezcal', 'cognac', 'brandy', 'liqueur', 'armagnac', 'vermouth', 'hennessy', 'jameson', 'johnnie walker', 'jack daniel', 'jim beam', 'chivas', 'ballantine', 'famous grouse', 'dewar', 'glenfiddich', 'glenlivet', 'glenmorangie', 'macallan', 'laphroaig', 'ardbeg', 'bowmore', 'talisker', 'absolut', 'smirnoff', 'grey goose', 'belvedere', 'ciroc', 'bacardi', 'captain morgan', 'havana club', 'kraken', 'malibu', 'baileys', 'martell', 'remy martin', 'courvoisier', 'jagermeister', 'jägermeister', 'aperol', 'campari', 'martini', 'bombay sapphire', 'tanqueray', "gordon's", 'gordons gin', 'hendrick', 'monkey 47', 'patron', 'don julio', 'jose cuervo', 'frangelico', 'disaronno', '70cl'],
  Beer: ['beer', 'beers', 'lager', 'lagers', 'ale', 'stout', 'cider', 'pilsner', 'heineken', 'carlsberg', 'guinness', 'corona', 'budweiser', 'stella artois', 'peroni', 'amstel', 'desperados', 'tuborg', 'estrella', 'kronenbourg', 'grolsch', 'san miguel', 'coors', "beck's", 'becks', 'hoegaarden', 'leffe', 'moretti', 'asahi', 'kirin', 'tiger beer', 'warsteiner', 'krombacher', 'paulaner', 'erdinger', 'magners', 'strongbow', 'somersby', 'kopparberg', 'carling', "tennent's", 'tennents', 'harp lager'],
  Wine: ['wine', 'wines', 'champagne', 'champagnes', 'prosecco', 'cava', 'rosé', 'moet', 'moët', 'veuve clicquot', 'dom perignon', 'laurent-perrier', 'freixenet', 'sauvignon', 'merlot', 'chardonnay', 'cabernet', 'pinot', 'rioja', 'malbec', 'shiraz', '75cl'],
  'Soft Drinks': ['soft drink', 'soft drinks', 'energy drink', 'energy drinks', 'red bull', 'monster energy', 'coca-cola', 'coca cola', 'coke', 'pepsi', 'fanta', 'sprite', '7up', '7-up', 'schweppes', 'lucozade', 'fever-tree', 'fever tree', 'tropicana', 'san pellegrino', 'mineral water', 'juice', 'juices'],
  Confectionery: ['confectionery', 'chocolate', 'chocolates', 'sweets', 'candy', 'biscuits', 'cadbury', 'snickers', 'twix', 'kinder bueno', 'kinder joy', 'kinder surprise', 'ferrero', 'nutella', 'haribo', 'toblerone', 'milka', 'lindt', 'kitkat', 'kit kat', "m&m's", 'maltesers', 'oreo', 'mars bar', 'bounty'],
  Grocery: ['grocery', 'groceries', 'food', 'foods', 'coffee', 'tea', 'nescafe', 'nescafé', 'lavazza', 'pasta', 'rice', 'sunflower oil', 'olive oil', 'cooking oil', 'vegetable oil', 'cereal', 'cereals', "kellogg's", 'kelloggs', 'heinz', 'pringles', 'crisps', 'snacks', 'flour', 'sugar', 'noodles', 'baby food', 'infant formula', 'aptamil'],
  Toiletries: ['toiletries', 'shampoo', 'shower gel', 'deodorant', 'deodorants', 'toothpaste', 'detergent', 'detergents', 'washing powder', 'laundry', 'soap', 'nivea', 'colgate', 'gillette', 'head & shoulders', 'head and shoulders', 'pantene', 'ariel', 'persil', 'lynx', 'rexona', 'oral-b', 'sudocrem', 'razors'],
  'Other FMCG': ['perfume', 'perfumes', 'fragrance', 'fragrances', 'cosmetics'],
};

// Country from a country-code TLD only. A .com says nothing, so it says nothing.
const TLD_COUNTRY = {
  ie: 'Ireland', uk: 'United Kingdom', nl: 'Netherlands', be: 'Belgium', de: 'Germany', fr: 'France', es: 'Spain', pt: 'Portugal', it: 'Italy', at: 'Austria', ch: 'Switzerland', pl: 'Poland', cz: 'Czech Republic', sk: 'Slovakia', hu: 'Hungary', ro: 'Romania', bg: 'Bulgaria', gr: 'Greece', cy: 'Cyprus', mt: 'Malta', dk: 'Denmark', se: 'Sweden', no: 'Norway', fi: 'Finland', ee: 'Estonia', lv: 'Latvia', lt: 'Lithuania', lu: 'Luxembourg', si: 'Slovenia', hr: 'Croatia', rs: 'Serbia', md: 'Moldova', ua: 'Ukraine', ge: 'Georgia', am: 'Armenia', ru: 'Russia', tr: 'Turkey', il: 'Israel', ae: 'United Arab Emirates', sa: 'Saudi Arabia', qa: 'Qatar', kw: 'Kuwait', om: 'Oman', bh: 'Bahrain', jo: 'Jordan', lb: 'Lebanon', eg: 'Egypt', ma: 'Morocco', ng: 'Nigeria', gh: 'Ghana', ke: 'Kenya', za: 'South Africa', in: 'India', pk: 'Pakistan', cn: 'China', hk: 'Hong Kong', sg: 'Singapore', my: 'Malaysia', th: 'Thailand', vn: 'Vietnam', ph: 'Philippines', jp: 'Japan', kr: 'South Korea', au: 'Australia', nz: 'New Zealand', ca: 'Canada', mx: 'Mexico', br: 'Brazil', ar: 'Argentina', cl: 'Chile',
};

function flat(item) { const j = (item && item.json) || {}; return j.fields ? Object.assign({ id: j.id }, j.fields) : j; }
function normEmail(e) { return e ? String(e).trim().toLowerCase() : ''; }
function domainOf(e) { const i = e.lastIndexOf('@'); return i > 0 ? e.slice(i + 1) : ''; }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function items(name) { try { return $(name).all(); } catch (e) { return []; } }

const PATTERNS = {};
Object.keys(KEYWORDS).forEach(function (cat) {
  PATTERNS[cat] = KEYWORDS[cat].map(function (k) {
    // Letter-boundaries rather than \b, so "rosé", "m&m's" and "7up" behave.
    return { k: k, re: new RegExp('(^|[^\\p{L}\\p{N}])' + escRe(k) + '(?=$|[^\\p{L}\\p{N}])', 'giu') };
  });
});

/** Anil's sign-off to the start of the quoted thread (or the end) is his, not the client's. */
function stripSignature(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let inSig = false;
  for (const line of lines) {
    const t = line.trim();
    if (/^(on .{4,200} wrote:|-{2,} ?(original|forwarded) message ?-{2,}|from: .+@.+)$/i.test(t) || /^>/.test(t)) inSig = false;
    else if (/^(-- ?|kind regards,?|best regards,?|regards,?|many thanks,?|thanks,?|br,?|cheers,?|anil khetan)$/i.test(t)) inSig = true;
    if (!inSig) out.push(line);
  }
  return out.join('\n');
}

function scoreCategories(parts) {
  const scores = {};
  const hits = {};
  parts.forEach(function (p) {
    const text = String(p.text || '');
    if (!text) return;
    Object.keys(PATTERNS).forEach(function (cat) {
      PATTERNS[cat].forEach(function (pat) {
        const n = (text.match(pat.re) || []).length;
        if (!n) return;
        scores[cat] = (scores[cat] || 0) + Math.min(n, 5) * p.weight;
        hits[cat] = hits[cat] || [];
        if (hits[cat].indexOf(pat.k) < 0) hits[cat].push(pat.k);
      });
    });
  });
  const top = Math.max(0, ...Object.values(scores));
  const categories = Object.keys(scores)
    .filter(function (c) { return scores[c] >= top / 3; })
    .sort(function (a, b) { return scores[b] - scores[a] || a.localeCompare(b); });
  return { categories: categories, scores: scores, hits: hits };
}

function addressesOf(field) {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  const out = [];
  list.forEach(function (f) {
    if (f && Array.isArray(f.value)) f.value.forEach(function (v) { if (v && v.address) out.push({ address: v.address, name: v.name || '' }); });
    else if (typeof f === 'string') f.split(',').forEach(function (s) {
      const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/) || s.match(/^\s*()([^\s<>]+@[^\s<>]+)\s*$/);
      if (m) out.push({ address: m[2], name: m[1] || '' });
    });
  });
  return out;
}

// ---- what the base already knows ----
const known = {};
const clientDomains = {};
items('Clients Keys').map(flat).forEach(function (c) {
  const e = normEmail(c.Email); if (!e) return;
  known[e] = 'client';
  const d = domainOf(e);
  if (d && FREE_MAIL.indexOf(d) < 0 && !clientDomains[d]) clientDomains[d] = c['Client Name'] || e;
});
items('Contacts Keys').map(flat).forEach(function (c) { const e = normEmail(c.Email); if (e && !known[e]) known[e] = 'contact'; });
const supplierDomains = {};
items('Supplier Emails').map(flat).forEach(function (s) {
  String(s.Email || '').split(/[,;\s]+/).map(normEmail).forEach(function (e) {
    if (!e) return;
    known[e] = known[e] || 'supplier';
    const d = domainOf(e); if (d && FREE_MAIL.indexOf(d) < 0) supplierDomains[d] = s['Supplier Name'] || d;
  });
});

// ---- walk the sent mail ----
const byEmail = {};
const counts = { messages: 0, broadcasts: 0, known: 0, internal: 0, service: 0, supplier: 0, ignored: 0, candidates: 0 };
for (const it of items('Sent Mail')) {
  const m = it.json || {};
  counts.messages++;
  const to = addressesOf(m.to).concat(addressesOf(m.cc), addressesOf(m.bcc));
  const seen = {};
  const recips = to.filter(function (r) { const e = normEmail(r.address); if (!e || seen[e]) return false; seen[e] = true; return true; });
  if (recips.length > MAX_RECIPIENTS) { counts.broadcasts++; continue; }

  const date = m.date ? String(m.date).slice(0, 10) : '';
  const subject = String(m.subject || '');
  const files = (Array.isArray(m.attachments) ? m.attachments : []).map(function (a) { return (a && (a.filename || a.fileName)) || ''; }).join(' ');
  const body = stripSignature(m.text || '');

  recips.forEach(function (r) {
    const e = normEmail(r.address);
    const d = domainOf(e);
    if (known[e]) { counts[known[e] === 'supplier' ? 'supplier' : 'known']++; return; }
    if (INTERNAL_DOMAINS.indexOf(d) >= 0) { counts.internal++; return; }
    if (SERVICE_LOCAL.test(e.split('@')[0]) || SERVICE_DOMAINS.some(function (s) { return d === s || d.endsWith('.' + s); })) { counts.service++; return; }
    if (IGNORE_EMAILS.indexOf(e) >= 0 || IGNORE_DOMAINS.indexOf(d) >= 0) { counts.ignored++; return; }
    if (supplierDomains[d] && !clientDomains[d]) { counts.supplier++; return; }

    const c = byEmail[e] || (byEmail[e] = { email: e, name: '', firstDate: date, lastDate: date, subjects: [], parts: [], messageIds: [] });
    const name = String(r.name || '').replace(/^["']|["']$/g, '').trim();
    if (name && normEmail(name) !== e && !c.name) c.name = name;
    if (date && (!c.lastDate || date > c.lastDate)) c.lastDate = date;
    if (date && (!c.firstDate || date < c.firstDate)) c.firstDate = date;
    if (subject && c.subjects.indexOf(subject) < 0) c.subjects.push(subject);
    if (m.id) c.messageIds.push(m.id);
    c.parts.push({ text: subject + ' ' + files, weight: 3 }, { text: body, weight: 1 });
  });
}

const candidates = Object.keys(byEmail).sort().map(function (e) {
  const c = byEmail[e];
  const d = domainOf(e);
  const s = scoreCategories(c.parts);
  const tld = d.split('.').pop();
  return {
    email: e,
    name: c.name || e,
    domain: d,
    country: TLD_COUNTRY[tld] || '',
    categories: s.categories,
    capsuleTags: s.categories.map(function (k) { return CAPSULE_TAG[k]; }).filter(Boolean),
    evidence: s.categories.map(function (k) { return k + ': ' + s.hits[k].slice(0, 4).join(', '); }),
    sameCompanyAs: clientDomains[d] || '',
    lastDate: c.lastDate,
    subjects: c.subjects.slice(0, 3),
    messageIds: c.messageIds.slice(0, 5),
  };
});
counts.candidates = candidates.length;
console.log('sent-mail capture: ' + JSON.stringify(counts));
if (!candidates.length) return [];

function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
const ors = candidates.map(function (c) { return 'LOWER({Email})="' + esc(c.email) + '"'; });
const formula = ors.length === 1 ? ors[0] : 'OR(' + ors.join(',') + ')';
return [{ json: { candidates: candidates, formula: formula, summary: counts } }];
