/**
 * n8n Code node — "Build Recipients"   (Offer Dispatch — Akay, dAYMAj6mZD3hTV4T)
 * Mode: Run Once for All Items
 *
 * SOURCE OF TRUTH: repo .claude/skills/offer-dispatch/n8n/build-recipients.js.
 * Edit the repo file, run `node test-nodes.cjs`, then paste — never edit here.
 *
 * What changed vs the version live before 2026-08-18 — see PATCH.md in the repo:
 *   1. Group selection is deterministic. It used to take gateAll[0], i.e.
 *      whichever record Airtable happened to return first, so with several
 *      offers queued the one that got sent was arbitrary and an unlucky offer
 *      could be starved indefinitely. The oldest Offer Date now wins.
 *   2. The groups left queued are counted and named, so the approval mail can
 *      say so. One run sends ONE group; that was true before and invisible.
 *
 * Everything else — the client filters, the No Mailing suppression, the
 * duplicate-email dedupe, the bundle audience assertion — is unchanged.
 *
 * Added 2026-08-20 (Anil: "send to Indv Spirits excluding Ireland & USA"):
 *   3. Excluded Countries — an OPT-OUT country list, read from the new Offers
 *      field of the same name. Target Countries is include-only, so "everywhere
 *      except Ireland and USA" was inexpressible: blank sent to them anyway,
 *      and enumerating the other 95 countries dropped all 440 blank-country
 *      clients. A blank client Country is NEVER excluded here.
 *   4. foldCountry() now folds USA/US/United States/United States of America
 *      to one token, and Ireland/Eire/IRL/ROI to another. Without this,
 *      Excluded Countries "USA" folded to "usa" and did NOT match the 16
 *      clients whose Country reads "United States" — the exclusion would have
 *      silently failed on every one of them.
 *   5. normaliseEmail() strips a trailing , ; or . before validating. 164
 *      Clients rows store "info@barrique.de," and the old regex ACCEPTED them
 *      (a comma is neither \s nor @), so malformed addresses reached Resend
 *      and bounced. Stripping first also lets the dedupe see "a@b.com" and
 *      "a@b.com," as one address.
 */

const NO_MAILING_TAG = 'no mailing';

const gateAll = $('Gate Check').all().map((i) => i.json).filter((g) => g.gatePassed);
if (!gateAll.length) {
  return [{ json: { recipientCount: 0, recipients: [], halt: true, haltReason: 'No gate-passed offers reached Build Recipients' } }];
}

// ── Choose ONE dispatch group, deterministically ────────────────────────────
// A group is one Bundle ID, or a single un-bundled offer. Oldest Offer Date
// first so a queued offer cannot be passed over run after run.
const groups = new Map();
for (const g of gateAll) {
  const key = (g.offerFields || {})['Bundle ID'] || `__single__${g.offerId}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(g);
}

const ranked = [...groups.entries()]
  .map(([key, offers]) => ({
    key,
    offers,
    oldest: offers
      .map((o) => String((o.offerFields || {})['Offer Date'] || '9999-99-99'))
      .sort()[0],
    label: key.startsWith('__single__') ? offers[0].offerName : `bundle "${key}"`,
  }))
  .sort((a, b) => (a.oldest === b.oldest ? a.offers[0].offerId.localeCompare(b.offers[0].offerId) : a.oldest.localeCompare(b.oldest)));

const chosen = ranked[0];
const bundleMembers = chosen.offers;
const gate = bundleMembers[0];
const bundleId = (gate.offerFields || {})['Bundle ID'] || null;
const deferredGroups = ranked.slice(1).map((r) => r.label);

if (bundleMembers.length > 1) {
  const AUDIENCE_KEYS = ['Target Capsule Tags', 'Target Countries', 'Excluded Countries', 'Bond/Customs Status', 'Match Interest Category', 'Category'];
  for (const k of AUDIENCE_KEYS) {
    const vals = new Set(bundleMembers.map((m) => JSON.stringify((m.offerFields || {})[k] ?? null)));
    if (vals.size > 1) {
      return [{ json: { offerId: gate.offerId, bundleOfferIds: bundleMembers.map((m) => m.offerId), recipientCount: 0, recipients: [], halt: true, haltReason: `Bundle "${bundleId}" members disagree on ${k}` } }];
    }
  }
}

const offerFields = gate.offerFields || {};
const offerBond = gate.bondStatus;
const bundleOfferIds = bundleMembers.map((m) => m.offerId);

const targetTags = parseList(offerFields['Target Capsule Tags']);
const targetCountries = parseList(offerFields['Target Countries']).map(foldCountry);
const excludedCountries = parseList(offerFields['Excluded Countries']).map(foldCountry);
const matchCategory = Boolean(offerFields['Match Interest Category']);
const offerCategory = normalise(offerFields['Category']);

if (matchCategory && !offerCategory) {
  return [{ json: { offerId: gate.offerId, bundleOfferIds, recipientCount: 0, recipients: [], halt: true, haltReason: 'Match Interest Category ticked but offer has no Category' } }];
}
if (targetTags.includes(NO_MAILING_TAG)) {
  return [{ json: { offerId: gate.offerId, bundleOfferIds, recipientCount: 0, recipients: [], halt: true, haltReason: 'Target Capsule Tags contains No Mailing — cannot target an opt-out tag' } }];
}

const clients = $input.all().map((i) => i.json);
const recipients = [];
const excluded = [];
const seenEmail = new Map();
let suppressedNoMailing = 0;
let suppressedExcludedCountry = 0;

for (const rec of clients) {
  const f = rec.fields || rec;
  const name = f['Client Name'] || '(unnamed)';
  const email = normaliseEmail(f['Email']);
  const tags = toArray(f['Capsule Tags']).map(normalise);

  if (tags.includes(NO_MAILING_TAG)) { suppressedNoMailing++; excluded.push({ name, reason: 'No Mailing' }); continue; }
  if (f['Do Not Contact']) { excluded.push({ name, reason: 'Do Not Contact' }); continue; }

  // Status is now the single active/inactive field (Active checkbox removed 2026-08-05)
  const statusVal = f['Status'] && typeof f['Status'] === 'object' ? f['Status'].name : f['Status'];
  if (statusVal !== 'Active') { excluded.push({ name, reason: `Status = ${statusVal ?? 'blank'}` }); continue; }
  if (!email) { excluded.push({ name, reason: 'no valid email' }); continue; }

  if (targetTags.length) {
    if (!tags.length) { excluded.push({ name, reason: 'no Capsule Tags' }); continue; }
    if (!targetTags.some((t) => tags.includes(t))) { excluded.push({ name, reason: 'tags mismatch' }); continue; }
  }
  if (targetCountries.length) {
    const country = foldCountry(f['Country']);
    if (!country || !targetCountries.includes(country)) { excluded.push({ name, reason: `Country "${f['Country'] || 'blank'}" not in targets` }); continue; }
  }
  // Opt-out country list. A BLANK client Country is deliberately NOT excluded:
  // a blank is not evidence of being in an excluded country, and treating it as
  // one silently removed 440 of 1,307 clients on the Indv spirits segment.
  if (excludedCountries.length) {
    const country = foldCountry(f['Country']);
    if (country && excludedCountries.includes(country)) {
      suppressedExcludedCountry++;
      excluded.push({ name, reason: `Country "${f['Country']}" is on the offer's Excluded Countries list` });
      continue;
    }
  }
  if (matchCategory) {
    const interests = toArray(f['Interest Categories']).map(normalise);
    if (!interests.length || !interests.includes(offerCategory)) { excluded.push({ name, reason: 'category mismatch' }); continue; }
  }
  const exclusions = toArray(f['Excluded Bond Status']).map(normalise);
  if (offerBond && exclusions.includes(normalise(offerBond))) { excluded.push({ name, reason: `Excluded Bond ${offerBond}` }); continue; }
  if (seenEmail.has(email)) { excluded.push({ name, reason: `duplicate email` }); continue; }
  seenEmail.set(email, name);

  recipients.push({ clientId: rec.id, clientName: name, email, country: f['Country'] || '', firstName: firstNameOf(name) });
}

return [{ json: {
  offerId: gate.offerId, bundleOfferIds, offerBond, targetTags, targetCountries, excludedCountries, matchCategory,
  offerCategory: offerFields['Category'] || null, recipientCount: recipients.length, recipients,
  excludedCount: excluded.length, suppressedNoMailing, suppressedExcludedCountry, excluded,
  groupLabel: chosen.label, deferredGroupCount: deferredGroups.length, deferredGroups,
  summary: `${recipients.length} recipient(s) from ${clients.length} clients; ${excluded.length} excluded (${suppressedNoMailing} No Mailing)` +
    (targetTags.length ? `; tags: ${targetTags.join(', ')}` : '; all tags') +
    (targetCountries.length ? `; countries: ${targetCountries.join(', ')}` : '; all countries') +
    (excludedCountries.length ? `; EXCLUDING ${excludedCountries.join(', ')} (${suppressedExcludedCountry} client(s) removed)` : '') +
    (deferredGroups.length ? `; ${deferredGroups.length} other queued group(s) NOT in this run: ${deferredGroups.join(', ')}` : '')
} }];

function parseList(raw) { return String(raw ?? '').split(/[,;\n]/).map(normalise).filter(Boolean); }
function foldCountry(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[.\s_-]/g, '');
  const ALIASES = {
    prchina:'china', cn:'china', roc:'taiwan', tw:'taiwan',
    // Every spelling of these two must fold to ONE token, or an Excluded
    // Countries entry misses by spelling alone. "United States" is what the
    // Clients table actually stores; "USA" is what a trader types.
    usa:'unitedstates', us:'unitedstates', unitedstatesofamerica:'unitedstates', america:'unitedstates',
    eire:'ireland', irl:'ireland', ie:'ireland', republicofireland:'ireland', roi:'ireland',
  };
  return ALIASES[s] || s;
}
function normalise(v) { const s = v && typeof v === 'object' ? v.name : v; return String(s ?? '').trim().toLowerCase(); }
function normaliseEmail(raw) {
  // Strip a trailing , ; or . BEFORE validating: 164 Clients rows store the
  // address with a trailing comma and the old regex accepted them, so the
  // malformed address reached Resend and bounced.
  const s = String(raw ?? '').trim().toLowerCase().replace(/[,;.]+$/, '');
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}
function toArray(v) { if (!v) return []; return (Array.isArray(v) ? v : [v]).map(x => x && typeof x === 'object' ? x.name : x).filter(Boolean); }
function firstNameOf(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.includes('@')) return '';
  const first = s.replace(/^(mr|mrs|ms|miss|dr|sig|sr|sra)\.?\s+/i, '').split(/\s+/)[0] || '';
  if (first.length < 2 || first.length > 20 || !/^[\p{L}][\p{L}''-]*$/u.test(first)) return '';
  if (/^(sales|info|admin|office|purchasing|team|accounts|export|import|contact)$/i.test(first)) return '';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

