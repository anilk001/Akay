/**
 * WHATSAPP OFFER BROADCAST - PLAN, 2026-09-04
 *
 * Picks the top Send-Eligible offer per client WhatsApp Segment and builds one
 * branded-card send plan per segment. Mirrors the manual WhatsApp broadcast
 * lists via Contacts.WhatsApp Segment (auto-tagged 2026-09-02).
 *
 * HARD RULES
 *  - Supplier segments are NEVER broadcast to: they are the people we buy from.
 *  - One message per contact per run: segments are walked most-specific first
 *    and a contact claimed by an earlier segment is skipped by later ones.
 *  - An offer is not re-sent to the same segment within COOLDOWN_DAYS
 *    (read from Offers.WA Broadcast Log, written by this workflow after a run).
 *  - Offer Target Countries / Excluded Countries are honoured against the
 *    contact Country, with the SAME asymmetry as the email dispatch workflow:
 *    an include-list excludes blank-country contacts, the exclude-list never
 *    does (cannot prove a blank is an excluded country).
 *  - MANUAL QUEUE (added 2026-09-04): ticking Offers.'Queued for WA
 *    Broadcast' forces that offer to the front of the next run, bypassing
 *    scoring AND the cooldown (manual intent wins). Blank 'WA Target
 *    Segments' = every client segment whose category mapping matches; named
 *    segments = exactly those lists, overriding the category mapping. The
 *    tick is cleared by the workflow after a successful real broadcast.
 *  - PILOT=true sends every planned card ONLY to PILOT_TO (Anil), with the
 *    real audience size stated in the caption. Nothing else is contacted and
 *    nothing is logged to Airtable until PILOT is set to false.
 *    LIVE since 2026-09-04 (Anil's go-ahead after pilot run 32369 delivered
 *    14/14 cards). Set PILOT back to true to pause real sends at any time.
 */
const PILOT = false;
const PILOT_TO = '353872382368@s.whatsapp.net'; // Anil (ak@akay.ie) own WhatsApp
const COOLDOWN_DAYS = 45;
const MAX_EXTRAS = 3;          // "Also live" caption lines under the main card
const MAX_SENDS_PER_RUN = 450; // hard safety cap across all segments
const SITE = 'https://offers.akay.ie';

const SPIRITS = ['Spirits', 'Champagne'];
const FMCG = ['Grocery', 'Confectionery', 'Toiletries', 'Soft Drinks', 'Other FMCG'];
// Priority order: most specific first, so a contact in both "Israel spirits"
// and "Spirits clients" gets the Israel pick, not two messages.
const SEGMENTS = [
  { name: 'Cognac clients',           cats: ['Spirits'], kw: 'cognac|brandy|hennessy|martell|courvoisier|remy|armagnac' },
  { name: 'Clients dubai spirits',    cats: SPIRITS },
  { name: 'Israel spirits',           cats: SPIRITS },
  { name: 'Spirits Clients Far East', cats: SPIRITS },
  { name: 'Duty Free',                cats: ['Spirits', 'Champagne', 'Beer', 'Confectionery'] },
  { name: 'Confectionery outside eu', cats: ['Confectionery'] },
  { name: 'Israel FMCG',              cats: FMCG },
  { name: 'FMCG Saudi',               cats: FMCG },
  { name: 'Russia Clients',           cats: null },
  { name: 'EU Spirits Clients',       cats: SPIRITS },
  { name: 'FMCG EU',                  cats: FMCG },
  { name: 'FMCG NON EU',              cats: FMCG },
  { name: 'Beers',                    cats: ['Beer'] },
  { name: 'Spirits clients',          cats: SPIRITS },
];

const af = it => { const j = (it && it.json) || {}; return { id: j.id, f: (j.fields || j) }; };
const selName = v => { if (v === null || v === undefined) return ''; if (typeof v === 'object') return String(v.name != null ? v.name : ''); return String(v); };
const selArr = v => { const a = Array.isArray(v) ? v : (v ? [v] : []); return a.map(selName).filter(Boolean); };
const fold = c => {
  const s = String(c || '').toLowerCase().replace(/[^a-z]/g, '');
  const map = { usa: 'unitedstates', us: 'unitedstates', unitedstatesofamerica: 'unitedstates',
    uk: 'unitedkingdom', greatbritain: 'unitedkingdom', england: 'unitedkingdom', scotland: 'unitedkingdom',
    holland: 'netherlands', thenetherlands: 'netherlands', eire: 'ireland', irl: 'ireland',
    czechrepublic: 'czechia', russianfederation: 'russia', uae: 'unitedarabemirates', dubai: 'unitedarabemirates',
    southkorea: 'korea', republicofkorea: 'korea' };
  return map[s] || s;
};
const csvCountries = s => String(s || '').split(',').map(x => fold(x)).filter(Boolean);
const clip = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1).trim() + '\u2026' : s; };

const now = Date.now();
const today = new Date().toISOString().slice(0, 10);

// ---- offers ----
const offers = [];
for (const it of $('Fetch Offers').all()) {
  const { id, f } = af(it);
  const cat = selName(f['Category']);
  const headline = String(f['Public Product Description'] || f['Product Name'] || '').trim();
  const priceStr = String(f['Price Per Unit & Case'] || f['Price Display'] || '').trim();
  if (!headline || !priceStr) continue; // nothing presentable to a buyer
  const dt = f['Offer Date'] ? Date.parse(f['Offer Date']) : 0;
  const days = dt ? (now - dt) / 86400000 : 999;
  let score = 0;
  if (days <= 3) score += 30; else if (days <= 7) score += 20; else if (days <= 14) score += 10; else if (days > 60) score -= 10;
  if (f['Featured']) score += 40;
  if (f['Is Cheapest']) score += 25;
  if (f['Cheaper By 5%+']) score += 15;
  if (Number(f['Stock Cases']) > 0) score += 5;
  // segment|YYYY-MM-DD lines written by this workflow after each real run
  const logLines = String(f['WA Broadcast Log'] || '').split('\n').map(s => s.trim()).filter(Boolean);
  const sentTo = {};
  for (const line of logLines) {
    const p = line.split('|');
    if (p.length < 2) continue;
    const age = (now - Date.parse(p[1])) / 86400000;
    if (!isNaN(age) && age <= COOLDOWN_DAYS) sentTo[p[0]] = true;
  }
  offers.push({ id, cat, headline, priceStr, score, sentTo, logRaw: String(f['WA Broadcast Log'] || ''),
    queued: !!f['Queued for WA Broadcast'],
    waSegs: String(f['WA Target Segments'] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    spec: String(f['Public Spec'] || '').trim(),
    stockDisplay: String(f['Stock Display'] || '').trim(),
    stockCases: Number(f['Stock Cases']) || 0,
    terms: String(f['Public Terms'] || '').trim(),
    bond: selName(f['Bond/Customs Status']),
    moq: String(f['MOQ'] || '').trim(),
    lead: String(f['Lead Time'] || '').trim(),
    featured: !!f['Featured'], cheapest: !!(f['Is Cheapest'] || f['Cheaper By 5%+']),
    target: csvCountries(f['Target Countries']),
    excluded: csvCountries(f['Excluded Countries']) });
}

// ---- contacts ----
const contacts = [];
for (const it of $('Fetch WA Contacts').all()) {
  const { id, f } = af(it);
  const to = String(f['WhatsApp Chat ID'] || '').trim();
  if (!to || to.indexOf('@g.us') >= 0) continue; // individuals only, never group chats
  contacts.push({ id, to, name: String(f['Contact Name'] || '').trim(),
    country: fold(f['Country']), segs: selArr(f['WhatsApp Segment']) });
}

// ---- plan ----
const claimed = {};
let planned = 0;
const out = [];
for (const seg of SEGMENTS) {
  const kwRe = seg.kw ? new RegExp(seg.kw, 'i') : null;
  const segLc = seg.name.toLowerCase();
  const catOk = o => (!seg.cats || seg.cats.indexOf(o.cat) >= 0) && (!kwRe || kwRe.test(o.headline));
  // Queued offers come first: they bypass scoring and the cooldown, and an
  // explicit WA Target Segments entry also bypasses the category mapping.
  const queuedHere = offers.filter(o => o.queued && (o.waSegs.length ? o.waSegs.indexOf(segLc) >= 0 : catOk(o))).sort((a, b) => b.score - a.score);
  const scored = offers.filter(o => !o.queued && !o.sentTo[seg.name] && catOk(o)).sort((a, b) => b.score - a.score);
  const pool = queuedHere.concat(scored);
  if (!pool.length) continue;
  const top = pool[0];
  const extras = pool.slice(1, 1 + MAX_EXTRAS);

  const audience = contacts.filter(c => {
    if (claimed[c.to]) return false;
    if (c.segs.indexOf(seg.name) < 0) return false;
    if (top.target.length && (!c.country || top.target.indexOf(c.country) < 0)) return false;
    if (top.excluded.length && c.country && top.excluded.indexOf(c.country) >= 0) return false;
    return true;
  });
  if (!audience.length) continue;

  let recips = audience.map(c => ({ to: c.to, name: c.name }));
  if (planned + recips.length > MAX_SENDS_PER_RUN) recips = recips.slice(0, Math.max(0, MAX_SENDS_PER_RUN - planned));
  if (!recips.length) continue;
  for (const r of recips) claimed[r.to] = true;
  planned += recips.length;

  // card fields (never empty: gm drawText rejects empty strings)
  const priceParts = top.priceStr.split('\u00b7').map(s => s.trim());
  const badge = top.featured ? 'TRADER PICK' : (top.cheapest ? 'SHARP PRICE' : '');
  const stockLine = (top.stockDisplay || 'Enquire for availability') + (top.stockCases ? ' \u00b7 ' + top.stockCases.toLocaleString('en-IE') + ' cases' : '');
  const termsLine = [top.terms, top.bond].filter(Boolean).join(' \u00b7 ');

  const capLines = ['*' + top.headline + '*'];
  if (top.spec) capLines.push(top.spec);
  capLines.push('*' + top.priceStr + '*');
  capLines.push('Stock: ' + stockLine);
  if (termsLine) capLines.push(termsLine);
  const mq = [top.moq ? 'MOQ: ' + top.moq : '', top.lead ? 'Lead time: ' + top.lead : ''].filter(Boolean).join(' \u00b7 ');
  if (mq) capLines.push(mq);
  if (extras.length) {
    capLines.push('');
    capLines.push('Also live:');
    for (const e of extras) capLines.push('\u2022 ' + clip(e.headline, 45) + ' \u2014 ' + e.priceStr.split('\u00b7')[0].trim());
  }
  capLines.push('');
  capLines.push('Reply here to book stock or ask for the full list.');
  capLines.push('All live offers: ' + SITE);
  let caption = capLines.join('\n');

  let finalRecips = recips;
  if (PILOT) {
    caption = '[PILOT \u00b7 ' + seg.name + ' \u00b7 would send to ' + recips.length + ' contact(s)]\n\n' + caption;
    finalRecips = [{ to: PILOT_TO, name: 'PILOT (Anil)' }];
  }

  out.push({ json: {
    segment: seg.name, pilot: PILOT, offerId: top.id, offerHeadline: top.headline, queuedPick: !!top.queued,
    plannedCount: recips.length, recipients: finalRecips,
    existingLog: top.logRaw, logLine: seg.name + '|' + today,
    headline: clip(top.headline, 58) || ' ',
    specLine: clip(top.spec, 90) || ' ',
    priceMain: clip(priceParts[0] || top.priceStr, 34) || ' ',
    priceSub: clip(priceParts[1] || '', 40) || ' ',
    stockLine: clip(stockLine, 44) || ' ',
    termsLine: clip(termsLine, 46) || ' ',
    badge: badge || ' ',
    caption
  } });
}
console.log('planned ' + out.length + ' segment card(s), ' + planned + ' real recipient(s), ' + out.filter(o => o.json.queuedPick).length + ' from the manual queue' + (PILOT ? ' [PILOT: all sends go to Anil only]' : ''));
return out;
