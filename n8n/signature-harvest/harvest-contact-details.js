/**
 * n8n Code node — "Harvest Contact Details"
 * Workflow: Reply Signature Harvest — Akay
 * Mode: Run Once for All Items
 *
 * Offer emails go out from offers@akay.ie with reply_to ak@akay.ie, so the
 * bounce-backs, out-of-office notices and short replies all land in the mailbox
 * "Email Enquiry Intake — ak@akay.ie" already polls. That workflow throws them
 * away on purpose (NOISE_SUBJECT matches "out of office", "automatic reply"),
 * which is right for enquiries and wasteful for contact data: an out-of-office
 * is the one message that reliably carries a full signature block.
 *
 * This node reads those messages and fills BLANK fields on the matching
 * Contacts row. It never overwrites and it never guesses.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE (Anil, 2026-09-14):
 * use the details of the person we emailed; if the details belong to somebody
 * else, do not process the message at all.
 *
 * That rule exists because the richest source of signatures is also the most
 * dangerous one. A large share of out-of-office replies read "I am on leave
 * until the 20th, in my absence please contact Jane Murphy, jane@other.com,
 * +353 87 123 4567". Harvesting that writes Jane's name, company and phone onto
 * your buyer's record — a plausible-looking row that belongs to nobody, in the
 * table used for outreach. That is strictly worse than the blank it replaced,
 * because a blank is visibly missing and a wrong name is not.
 *
 * So the guard is deliberately blunt and fails closed. Two independent signals
 * reject the WHOLE message rather than the offending line:
 *   1. A handover phrase anywhere in the harvest region ("in my absence",
 *      "please contact", "will be handled by", ...).
 *   2. Any email address in the harvest region that is not the sender's own.
 * Either one means the text is about more than one person, and no amount of
 * per-line cleverness reliably tells whose phone number is whose.
 *
 * The cost of the blunt version is missed harvests. That is the right way round:
 * a missed harvest leaves a blank we already have, a wrong harvest corrupts a
 * row nobody will think to check.
 *
 * WHAT IT WILL AND WILL NOT WRITE
 *   Contact Name    <- From display name first, signature sign-off second
 *   Company         <- only a line carrying a real company suffix (Ltd, GmbH,
 *                      B.V., ...). Never derived from the email domain: that
 *                      turns gmail.com into "Gmail" and a personal address into
 *                      a fake employer.
 *   Phone (E.164)   <- only when it resolves to E.164 on evidence, using the
 *                      same never-guess rules as Contact Sync's norm().
 *
 * WHATSAPP IS DELIBERATELY NOT WRITTEN HERE.
 * A number in a signature is not proof of a WhatsApp account. Contact Sync
 * already establishes that properly by checking numbers against Whapi and
 * setting On WhatsApp / WhatsApp Chat ID from a real sighting. Writing a
 * harvested number into Phone (E.164) feeds that check, so the Monday sync
 * confirms WhatsApp instead of this node asserting it. Asserting it here would
 * put unverified numbers into the broadcast audience.
 *
 * INPUT (one item per candidate email, `json`): the Gmail node's own output,
 * consumed directly so there is no untyped mapper node between the mailbox and
 * the tested logic.
 *   from        From header, in any of the three shapes the Gmail node emits
 *               (object with .value[], object with .text, or a plain string)
 *   text        plain-text body      (snippet is used if absent)
 *   subject     subject line         (may be absent)
 *   fromEmail   explicit override, used by the tests and by a re-run harness
 *   fromName    explicit override
 *   body        explicit override of `text`
 *   dryRun      optional per-item override of DEFAULT_DRY_RUN
 *
 * Contacts are read from the "Contacts" node ($('Contacts').all()), fetched
 * once upstream, so matching happens in memory rather than one lookup per mail.
 *
 * Mail is read from the "Inbox Poll" node BY NAME, not from $input. The Contacts
 * fetch sits between the trigger and this node in the chain, so $input here is
 * the contact rows, not the messages - the same reason Email Enquiry Intake
 * reads $('ak@akay.ie Inbox') rather than its own input. $input is the fallback
 * so the node stays runnable (and testable) when fed messages directly.
 *
 * OUTPUT (one item per input item, order preserved):
 *   _action   'update' when there is something to write, otherwise 'skip'
 *   id        Contacts record id            (update only)
 *   fields    ONLY the blank fields now filled (update only)
 *   body      the PATCH payload, ready for the HTTP Request node (update only)
 *   reason    why it was skipped            (skip only)
 *   evidence  what matched, for the review log
 *
 * WHY `body` AND NOT THE AIRTABLE NODE.
 * The Airtable node maps a fixed set of columns, so a field this run did not
 * find would be sent as an empty string and would WIPE the value already in the
 * row - the exact opposite of this node's one promise. A PATCH carrying only
 * the keys that were actually resolved cannot do that. Client Self-Update
 * already writes this way for the same reason.
 */

/**
 * LIVE (Anil, 2026-09-14): harvested details are written straight to the
 * Contacts row, with no approval queue. The safety here is not a human check,
 * it is the two fail-closed guards above plus blanks-only writing: the worst
 * case is a wrong value in a field that was empty, never a good value replaced.
 * Set to true to have the node report what it would write and write nothing.
 */
const DEFAULT_DRY_RUN = false;

/** Handover phrases. Any hit rejects the message: the text names someone else. */
const HANDOVER = new RegExp([
  'in my absence', 'during my absence', 'while i am away', 'while i am out',
  'please contact', 'kindly contact', 'you (?:can|may) contact', 'instead contact',
  'contact my colleague', 'my colleague', 'will be handled by', 'handled by my',
  'for urgent (?:matters|enquiries|inquiries|issues)', 'in case of urgency',
  'reach out to', 'refer to', 'forwarded to', 'in meiner abwesenheit',
  'en mi ausencia', 'en mon absence', 'turn to my', 'speak to my',
].join('|'), 'i');

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Our own addresses are not "somebody else". Auto-responders routinely echo the
 * address they are replying to ("thank you for your email to offers@akay.ie"),
 * and a quoted original that slips past the boundary carries ak@akay.ie. Without
 * this the third-party guard would reject almost every message we harvest from.
 */
const OWN_DOMAINS = ['akay.ie'];
const isOurs = (e) => OWN_DOMAINS.indexOf(String(e).split('@')[1] || '') >= 0;

/** Company suffixes. A line must carry one of these to be read as a company. */
const COMPANY_SUFFIX = new RegExp(
  '(?:^|[\\s,.-])(?:ltd|limited|llc|l\\.l\\.c|inc|incorporated|corp|corporation|plc|' +
  'gmbh|mbh|ag|kg|ohg|b\\.?v|n\\.?v|s\\.?a|s\\.?a\\.?s|sarl|s\\.?r\\.?l|s\\.?p\\.?a|' +
  'srl|sl|s\\.?l|oy|oyj|ab|a/s|as|aps|sp\\.? z o\\.?o|z o\\.?o|s\\.?r\\.?o|kft|zrt|' +
  'd\\.?o\\.?o|d\\.?d|pty|pte|sdn bhd|bhd|cc|co|company|trading|distribution|' +
  'distributors?|group|holdings?|imports?|exports?|wholesale)(?:[\\s,.]|$)', 'i');

/** Lines that are never a company name even when they carry a suffix-ish word. */
const NOT_COMPANY = /^(?:sent from|get outlook|this e-?mail|disclaimer|confidential|please consider|p\.?s\.?\b|tel|phone|mobile|fax|email|e-mail|web|www\.|http)/i;

const PHONE_LABEL = /(?:^|\b)(?:tel|telephone|phone|mob|mobile|cell|cellular|whatsapp|wa|direct|office|m|t|p)\s*[.:\-]?\s*$/i;

const SIGNOFF = /^(?:kind(?:est)? regards|best regards|warm regards|regards|best wishes|best|sincerely|yours(?: sincerely| faithfully| truly)?|thanks(?: and regards)?|thank you|many thanks|cheers|mit freundlichen gr[uü][sß]+en|saludos|cordialement|met vriendelijke groet)\b[\s,.!-]*$/i;

/** Quoted-original boundary — same shape Email Enquiry Intake uses. */
const QUOTED = /\n(?:On .{5,120} wrote:|-{2,}\s*(?:Original|Forwarded) message\s*-{2,}|From:\s.+\n(?:Sent|Date):|_{10,}|-{10,}\s*\n\s*From:)/i;

const DIALLING = {
  ie: '353', irl: '353', ireland: '353',
  gb: '44', uk: '44', unitedkingdom: '44', greatbritain: '44', england: '44', scotland: '44', wales: '44',
  nl: '31', netherlands: '31', holland: '31',
  be: '32', belgium: '32', de: '49', germany: '49', fr: '33', france: '33',
  es: '34', spain: '34', it: '39', italy: '39', pt: '351', portugal: '351',
  pl: '48', poland: '48', cz: '420', czechia: '420', czechrepublic: '420',
  at: '43', austria: '43', ch: '41', switzerland: '41',
  dk: '45', denmark: '45', se: '46', sweden: '46', no: '47', norway: '47', fi: '358', finland: '358',
  lv: '371', latvia: '371', lt: '370', lithuania: '370', ee: '372', estonia: '372',
  gr: '30', greece: '30', bg: '359', bulgaria: '359', ro: '40', romania: '40', hu: '36', hungary: '36',
  hr: '385', croatia: '385', si: '386', slovenia: '386', sk: '421', slovakia: '421',
  cn: '86', china: '86', hk: '852', hongkong: '852', sg: '65', singapore: '65',
  my: '60', malaysia: '60', vn: '84', vietnam: '84', th: '66', thailand: '66',
  id: '62', indonesia: '62', ph: '63', philippines: '63', jp: '81', japan: '81',
  kr: '82', southkorea: '82', in: '91', india: '91', pk: '92', pakistan: '92',
  ae: '971', uae: '971', unitedarabemirates: '971', sa: '966', saudiarabia: '966',
  qa: '974', qatar: '974', kw: '965', kuwait: '965', om: '968', oman: '968', bh: '973', bahrain: '973',
  il: '972', israel: '972', tr: '90', turkey: '90', ru: '7', russia: '7', ua: '380', ukraine: '380',
  us: '1', usa: '1', unitedstates: '1', ca: '1', canada: '1',
  mx: '52', mexico: '52', br: '55', brazil: '55', ar: '54', argentina: '54',
  au: '61', australia: '61', nz: '64', newzealand: '64',
  za: '27', southafrica: '27', ng: '234', nigeria: '234', ke: '254', kenya: '254',
  eg: '20', egypt: '20', ma: '212', morocco: '212',
};

const IE_AREA = new Set(['21','22','23','24','25','26','27','28','29','41','42','43','44','45','46','47','49','51','52','53','56','57','58','59','61','62','63','64','65','66','67','68','69','71','74','90','91','93','94','95','96','97','98','99']);

function dialFor(raw) {
  const k = String(raw == null ? '' : raw).toLowerCase().replace(/[^a-z]/g, '');
  return k && DIALLING[k] ? DIALLING[k] : '';
}

function isIrishNational(nat) {
  if (/^8[35679]\d{7}$/.test(nat)) return true;
  if (/^1\d{7}$/.test(nat)) return true;
  return nat.length >= 7 && nat.length <= 9 && IE_AREA.has(nat.slice(0, 2));
}

/**
 * E.164 or nothing. Lifted from Contact Sync's norm() so a number harvested
 * here lands on exactly the key Contact Sync would have produced — otherwise
 * the same person ends up as two Contacts rows.
 */
function toE164(raw, knownCountry) {
  if (!raw && raw !== 0) return '';
  let s = String(raw).trim();
  let d = s.replace(/[^0-9]/g, '');
  if (!d) return '';
  if (s.startsWith('+')) return d.length >= 8 && d.length <= 15 ? '+' + d : '';
  if (s.startsWith('00')) { d = d.replace(/^0+/, ''); return d.length >= 8 && d.length <= 15 ? '+' + d : ''; }
  if (d.startsWith('0')) {
    const nat = d.replace(/^0+/, '');
    if (nat.length < 6 || nat.length > 12) return '';
    const known = dialFor(knownCountry);
    if (known) return '+' + known + nat;
    if (isIrishNational(nat)) return '+353' + nat;
    return '';
  }
  return '';
}

const norm = (e) => String(e == null ? '' : e).trim().toLowerCase();

/**
 * The Gmail node emits From in three different shapes depending on version and
 * on whether the header parsed cleanly. Same helper Email Enquiry Intake uses.
 */
function addr(x) {
  if (!x) return { email: '', name: '' };
  if (typeof x === 'string') {
    const m = x.match(/<([^>]+)>/);
    return { email: norm(m ? m[1] : x), name: m ? x.replace(/<[^>]+>/, '').replace(/"/g, '').trim() : '' };
  }
  const v = Array.isArray(x.value) ? x.value[0] : null;
  if (v) return { email: norm(v.address), name: v.name || '' };
  if (x.text) return addr(x.text);
  return { email: '', name: '' };
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const blank = (v) => v === null || v === undefined || String(v).trim() === '';

/** Everything above the quoted original — the part that is this sender's words. */
function harvestRegion(body) {
  const s = String(body == null ? '' : body);
  const i = s.search(QUOTED);
  return (i > 0 ? s.slice(0, i) : s).slice(0, 4000);
}

/** A display name must look like a person, not a mailbox or a slogan. */
function plausibleName(s) {
  const v = clean(s, 80);
  if (!v || v.length < 3 || v.length > 60) return '';
  if (v.indexOf('@') >= 0) return '';
  if (/\d/.test(v)) return '';
  if (NOT_COMPANY.test(v)) return '';
  if (COMPANY_SUFFIX.test(v)) return '';
  const words = v.split(/\s+/);
  if (words.length < 2 || words.length > 4) return '';
  if (!/^[\p{L}][\p{L}'’.-]*$/u.test(words[0])) return '';
  return v;
}

function nameFromSignoff(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!SIGNOFF.test(lines[i].trim())) continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cand = plausibleName(lines[j]);
      if (cand) return cand;
    }
  }
  return '';
}

function companyFrom(lines) {
  for (const raw of lines) {
    const line = clean(raw, 120);
    if (!line || line.length < 3 || line.length > 80) continue;
    if (NOT_COMPANY.test(line)) continue;
    if (line.indexOf('@') >= 0) continue;
    if (!COMPANY_SUFFIX.test(line)) continue;
    if (SIGNOFF.test(line)) continue;
    return line.replace(/^[\s,|•·-]+|[\s,|•·-]+$/g, '');
  }
  return '';
}

/**
 * Phone candidates, labelled ones first. A bare number sitting in prose is not
 * taken — order references and VAT numbers look exactly like phone numbers.
 */
function phoneFrom(lines, country) {
  const labelled = [];
  const plus = [];
  for (const raw of lines) {
    const line = String(raw);
    const m = line.match(/(?:^|\b)(tel|telephone|phone|mob|mobile|cell|whatsapp|wa|direct|office|m|t)\s*[.:\-]\s*(\+?[\d][\d\s().\-/]{6,22})/i);
    if (m) { labelled.push(m[2]); continue; }
    const p = line.match(/(?:^|[\s(])(\+\d[\d\s().\-]{7,20})(?=$|[\s,;)])/);
    if (p) plus.push(p[1]);
  }
  for (const cand of labelled.concat(plus)) {
    const e164 = toE164(cand.trim(), country);
    if (e164) return e164;
  }
  return '';
}

const out = [];
let contacts = [];
try { contacts = $('Contacts').all(); } catch (e) { contacts = []; }

const byEmail = {};
for (const it of contacts) {
  const j = (it && it.json) || {};
  const f = j.fields || j;
  const e = norm(f['Email']);
  if (e && !byEmail[e]) byEmail[e] = { id: j.id, f: f };
}

let mails;
try { mails = $('Inbox Poll').all(); } catch (e) { mails = $input.all(); }

for (const item of mails) {
  const j = (item && item.json) || {};
  const dryRun = j.dryRun === undefined ? DEFAULT_DRY_RUN : !!j.dryRun;
  const parsed = addr(j.from || j.From);
  const fromEmail = norm(j.fromEmail || parsed.email);
  const fromName = j.fromName || parsed.name;
  const rawBody = j.body !== undefined && j.body !== null ? j.body : (j.text || j.snippet || '');
  const push = (o) => out.push({ json: Object.assign({ fromEmail: fromEmail, dryRun: dryRun }, o) });

  if (!fromEmail) { push({ _action: 'skip', reason: 'no-sender' }); continue; }

  const hit = byEmail[fromEmail];
  if (!hit) { push({ _action: 'skip', reason: 'no-contact' }); continue; }

  const cur = hit.f;
  const wantName = blank(cur['Contact Name']) || norm(cur['Contact Name']) === fromEmail;
  const wantCompany = blank(cur['Company']);
  const wantPhone = blank(cur['Phone (E.164)']);
  if (!wantName && !wantCompany && !wantPhone) { push({ _action: 'skip', reason: 'nothing-missing' }); continue; }

  const region = harvestRegion(rawBody);

  // Guard 1 — the text hands off to somebody else.
  if (HANDOVER.test(region)) { push({ _action: 'skip', reason: 'handover-phrase' }); continue; }

  // Guard 2 — an address that is not the sender's own appears in the region.
  const others = (region.match(EMAIL_RE) || []).map(norm).filter((e) => e !== fromEmail && !isOurs(e));
  if (others.length) { push({ _action: 'skip', reason: 'third-party-email', evidence: others.slice(0, 3).join(', ') }); continue; }

  const lines = region.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '');
  const country = cur['Country'];

  const fields = {};
  const evidence = [];

  if (wantName) {
    const nm = plausibleName(fromName) || nameFromSignoff(lines);
    if (nm) { fields['Contact Name'] = nm; evidence.push('name'); }
  }
  if (wantCompany) {
    const co = companyFrom(lines);
    if (co) { fields['Company'] = co; evidence.push('company'); }
  }
  if (wantPhone) {
    const ph = phoneFrom(lines, country);
    if (ph) { fields['Phone (E.164)'] = ph; evidence.push('phone'); }
  }

  if (!Object.keys(fields).length) { push({ _action: 'skip', reason: 'nothing-found' }); continue; }

  push({
    _action: 'update',
    id: hit.id,
    fields: fields,
    body: JSON.stringify({ fields: fields, typecast: true }),
    evidence: evidence.join('+'),
  });
}

const upd = out.filter((o) => o.json._action === 'update').length;
console.log(
  'signature harvest: ' + out.length + ' message(s), ' + upd + ' with fillable details, ' +
  (out.length - upd) + ' skipped (' +
  ['no-contact', 'nothing-missing', 'handover-phrase', 'third-party-email', 'nothing-found', 'no-sender']
    .map((r) => r + '=' + out.filter((o) => o.json.reason === r).length).join(' ') + ')'
);

return out;
