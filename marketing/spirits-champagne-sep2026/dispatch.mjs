#!/usr/bin/env node
//
// AKAY - Spirits & Champagne offer dispatch, September 2026.
//
// A one-off mailmerge to the spirits list over the Resend batch API. One email
// per recipient, never BCC. Safe to kill and re-run at any point: every batch
// carries a stable idempotency key and progress.json is written after each one.
//
// This script NEVER writes to Airtable. Bounces and unsubscribes are handled by
// the existing n8n workflow.
//
// Run book: README.md in this directory.
//
//   node dispatch.mjs --dry-run     parse, filter, reconcile, print. No send.
//   node dispatch.mjs --test        one email to ak@akay.ie.
//   node dispatch.mjs --send        the full run, resumable.
//   node dispatch.mjs --report      the section 8 summary from progress.json.
//
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';

const DIR = path.dirname(new URL(import.meta.url).pathname);

// -- campaign constants ----------------------------------------------------
// These are the brief, verbatim. Do not "improve" the subject or the footer.
export const RUN = 'spirits-champagne-sep2026';
export const FROM = 'Akay Ireland <offers@akay.ie>';
export const REPLY_TO = 'offers@akay.ie';
export const SUBJECT = 'Absolut, Aperol & Champagne — T2 ex Loendersloot';
// Flat greeting for everyone. firstName is read from the CSV and deliberately
// NOT used: a large share of that column holds inbox handles and generic
// salutations. Every recipient gets a byte-identical email except for `to`.
export const GREETING = 'Hello,';
export const FOOTER = "Reply STOP to this email and we'll take you off our offer list.";
export const TEST_RECIPIENT = 'ak@akay.ie';

export const EXPECTED_ELIGIBLE = 1322;
export const EXPECTED_FETCHED = 1381;       // "~1,381" - approximate, warn only
export const EXPECTED_EXCLUDED_COUNTRY = 28;
export const EXPECTED_DUPLICATES = 31;

export const PLACEHOLDER = '<<<PASTE FINAL COPY>>>';
export const BATCH_SIZE = 100;
export const DEGRADED_BATCH_SIZE = 50;
export const BATCH_PAUSE_MS = 2000;
export const MAX_ATTEMPTS_PER_BATCH = 5;
export const DEGRADE_AFTER_FAILURES = 2;    // timeouts or 5xx on one batch
export const REQUEST_TIMEOUT_MS = 60000;
export const ENDPOINT = 'https://api.resend.com/emails/batch';
export const EMAIL_ENDPOINT = 'https://api.resend.com/emails';

// Hosts a link in the copy may point at. The brief says every link goes to
// quote.akay.ie; the others are tolerated (with a warning) because Resend's own
// click tracking rewrites through track.akay.ie.
const LINK_PRIMARY = 'quote.akay.ie';
const LINK_ALLOWED = new Set(['quote.akay.ie', 'akay.ie', 'www.akay.ie', 'track.akay.ie']);

// Named third parties to surface at preflight so a human signs them off. This
// is NOT a blocklist - the brief itself puts "ex Loendersloot" in the subject
// (a bonded-warehouse location, not a supplier identity). Add supplier names
// here and the dry run will point at them.
const REVIEW_TERMS = ['Loendersloot'];

// -- country exclusion -----------------------------------------------------
// Ireland, USA, Brazil. Matched on an exact set after normalising away case,
// punctuation and spacing - so "U.S.A." and "Republic of Ireland" hit, and
// "Northern Ireland" (United Kingdom) correctly does not.
const EXCLUDED_COUNTRIES = new Set([
  'ireland', 'republicofireland', 'ie', 'irl', 'eire', 'ire',
  'usa', 'us', 'unitedstates', 'unitedstatesofamerica', 'america', 'usofa',
  'brazil', 'brasil', 'br', 'bra',
]);

export function normCountry(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // Eire with accent -> eire
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

export function isExcludedCountry(value) {
  return EXCLUDED_COUNTRIES.has(normCountry(value));
}

// -- CSV -------------------------------------------------------------------
// RFC4180-ish: quoted fields, embedded commas, doubled quotes, CRLF.
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"' && field === '') { quoted = true; i += 1; continue; }
    if (c === ',') { endField(); i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { endRow(); i += 1; continue; }
    field += c; i += 1;
  }
  if (field !== '' || row.length > 0) endRow();

  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ''));
  if (nonEmpty.length === 0) return [];

  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const o = {};
    header.forEach((h, n) => { o[h] = (r[n] ?? '').trim(); });
    return o;
  });
}

// Deliberately strict-ish but not clever. The export is supposed to have
// filtered these already, so anything that fails here means the CSV is wrong.
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i;
export const isValidEmail = (e) => EMAIL_RE.test(String(e ?? '').trim());
export const normEmail = (e) => String(e ?? '').trim().toLowerCase();

// -- filters, in the order section 4 sets out ------------------------------
export function applyFilters(rows) {
  const counts = {
    fetched: rows.length,
    suppressedBlocked: 0,
    excludedCountry: 0,
    duplicates: 0,
    internalDropped: 0,
  };
  const detail = { suppressed: [], invalid: [], internal: [], countries: new Map() };

  // 1. suppression guard - belt and braces. The CSV should already exclude
  //    these, so a non-zero count means the export is wrong: stop and report.
  const truthy = (v) => /^(true|yes|y|1|checked|x)$/i.test(String(v ?? '').trim());
  const step = [];
  for (const r of rows) {
    const status = String(r.status ?? r.Status ?? '').trim();
    const dnc = r.doNotContact ?? r['Do Not Contact'] ?? r.do_not_contact ?? '';
    const reason = String(r.suppressionReason ?? r['Suppression Reason'] ?? '').trim();
    const blocked =
      truthy(dnc) ||
      (status !== '' && status.toLowerCase() !== 'active') ||
      reason !== '';
    if (blocked) {
      counts.suppressedBlocked += 1;
      detail.suppressed.push({ email: r.email, status, dnc: String(dnc), reason });
      continue;
    }
    if (!isValidEmail(r.email)) {
      detail.invalid.push({ email: r.email, airtableId: r.airtableId });
      continue;
    }
    step.push(r);
  }

  // 2. country exclusion
  const afterCountry = [];
  for (const r of step) {
    if (isExcludedCountry(r.country)) {
      counts.excludedCountry += 1;
      const k = String(r.country ?? '').trim() || '(blank)';
      detail.countries.set(k, (detail.countries.get(k) ?? 0) + 1);
      continue;
    }
    afterCountry.push(r);
  }

  // 3. dedupe by email, lowercased and trimmed, keep the first occurrence
  const seen = new Set();
  const afterDedupe = [];
  for (const r of afterCountry) {
    const key = normEmail(r.email);
    if (seen.has(key)) { counts.duplicates += 1; continue; }
    seen.add(key);
    afterDedupe.push({ ...r, email: key });
  }

  // 4. drop internal addresses
  const eligible = [];
  for (const r of afterDedupe) {
    if (r.email.endsWith('@akay.ie')) {
      counts.internalDropped += 1;
      detail.internal.push(r.email);
      continue;
    }
    eligible.push(r);
  }

  counts.eligible = eligible.length;
  // Batch membership must be identical across runs, so sort on the normalised
  // address with a plain byte comparison - never localeCompare, which varies.
  eligible.sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
  return { counts, detail, eligible };
}

export function reconcile(counts) {
  const { fetched, suppressedBlocked, excludedCountry, duplicates, internalDropped, eligible } = counts;
  // Section 4 states the identity without the internal drop. That term is real,
  // so it is carried here; when it is zero this is exactly the brief's sum.
  const expected = fetched - suppressedBlocked - excludedCountry - duplicates - internalDropped;
  return {
    identityHolds: expected === eligible,
    expected,
    countHolds: eligible === EXPECTED_ELIGIBLE,
  };
}

export function formatReconciliation(counts) {
  const pad = (n) => String(n).padStart(6, ' ');
  const lines = [
    `fetched            ${pad(counts.fetched)}`,
    `suppressedBlocked  ${pad(counts.suppressedBlocked)}`,
    `excludedCountry    ${pad(counts.excludedCountry)}`,
    `duplicates         ${pad(counts.duplicates)}`,
  ];
  if (counts.internalDropped > 0) lines.push(`internalDropped    ${pad(counts.internalDropped)}`);
  lines.push(`eligible           ${pad(counts.eligible)}`);
  return lines.join('\n');
}

// -- copy ------------------------------------------------------------------
const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function textToHtml(text) {
  const blocks = text.trim().split(/\n{2,}/);
  const body = blocks.map((block) => {
    const html = escapeHtml(block)
      .replace(/(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g,
        '<a href="$1" style="color:#c8102e;">$1</a>')
      .replace(/\n/g, '<br>');
    return `      <p style="margin:0 0 16px;">${html}</p>`;
  }).join('\n');

  // Minimal on purpose: no images, no tracking pixels, no external CSS.
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px 16px;background:#ffffff;">
    <div style="max-width:600px;margin:0 auto;font:16px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;">
${body}
    </div>
  </body>
</html>
`;
}

export function loadCopy(dir = DIR) {
  const txtPath = path.join(dir, 'email.txt');
  if (!fs.existsSync(txtPath)) throw new Error(`missing ${txtPath}`);
  const bodyRaw = fs.readFileSync(txtPath, 'utf8');

  const htmlPath = path.join(dir, 'email.html');
  const htmlRaw = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const htmlIsReal = htmlRaw.trim() !== '' && !htmlRaw.includes(PLACEHOLDER);

  const body = bodyRaw.trim();
  const text = `${GREETING}\n\n${body}\n\n--\n${FOOTER}\n`;
  const html = htmlIsReal
    ? htmlRaw
    : textToHtml(`${GREETING}\n\n${body}\n\n--\n${FOOTER}`);

  return {
    subject: SUBJECT,
    text,
    html,
    htmlSource: htmlIsReal ? 'email.html' : 'derived from email.txt',
    hash: sha256(`${SUBJECT} ${text} ${html}`),
  };
}

export function verifyCopy(copy) {
  const errors = [], warnings = [];
  const all = `${copy.subject}\n${copy.text}\n${copy.html}`;

  if (all.includes(PLACEHOLDER)) {
    errors.push(`email.txt still holds the ${PLACEHOLDER} marker - paste the final copy (brief section 5).`);
  } else if (copy.text.trim().length < 120) {
    errors.push('the copy is suspiciously short - check email.txt holds the real body.');
  }
  if (!copy.text.includes(FOOTER)) errors.push('the opt-out footer is missing from the text part.');
  if (!copy.html.includes('STOP')) errors.push('the opt-out footer is missing from the HTML part.');
  if (!copy.text.startsWith(GREETING)) errors.push(`the text part must open with "${GREETING}".`);

  // Personalisation must not creep back in - the brief is explicit.
  const tokens = copy.text.match(/\{\{[^}]+\}\}/g);
  if (tokens) errors.push(`unreplaced merge tokens in the copy: ${[...new Set(tokens)].join(', ')}`);
  if (/\bfirstName\b/.test(all)) errors.push('the copy references firstName - the greeting is flat (brief section 5).');

  // Links
  const urls = [...all.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
  const hosts = new Set();
  for (const u of urls) {
    let host;
    try { host = new URL(u).hostname.toLowerCase(); } catch { errors.push(`unparseable URL: ${u}`); continue; }
    hosts.add(host);
    if (!LINK_ALLOWED.has(host)) errors.push(`link points outside akay.ie: ${u}`);
    else if (host !== LINK_PRIMARY) warnings.push(`link is on ${host}, not ${LINK_PRIMARY}: ${u}`);
  }
  if (urls.length === 0) warnings.push(`no links in the copy - the brief expects ${LINK_PRIMARY} links.`);

  // Tracking pixels
  if (/<img[^>]*(1x1|pixel|track|open)[^>]*>/i.test(copy.html)) {
    errors.push('the HTML looks like it carries a tracking pixel - only Resend click tracking is allowed.');
  }

  for (const term of REVIEW_TERMS) {
    if (new RegExp(term, 'i').test(all)) {
      warnings.push(`"${term}" appears in the email - confirm it is not a supplier identity (brief section 1).`);
    }
  }
  return { errors, warnings, hosts: [...hosts] };
}

// -- batching --------------------------------------------------------------
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function batchKey(n, size) {
  const nn = String(n).padStart(2, '0');
  // Size-100 batches use the key the brief specifies. Degraded batches get
  // their own namespace: reusing batchNN for a re-formed 50 would point one
  // idempotency key at two different payloads, which is how a double-send or a
  // silently-rejected batch happens.
  return size === BATCH_SIZE ? `${RUN}-batch${nn}` : `${RUN}-b${size}-batch${nn}`;
}

export function planBatches(eligible, startSize = BATCH_SIZE) {
  const batches = [];
  for (let i = 0; i < eligible.length; i += startSize) {
    const slice = eligible.slice(i, i + startSize);
    const n = batches.length + 1;
    batches.push({
      n,
      key: batchKey(n, startSize),
      size: slice.length,
      plannedSize: startSize,
      emails: slice.map((r) => r.email),
      emailsSha: sha256(slice.map((r) => r.email).join('\n')),
    });
  }
  return batches;
}

// Re-plan the tail at a smaller size after a degrade, keeping already-sent
// batches exactly as they were.
export function replanTail(eligible, done, newSize) {
  const sentCount = done.reduce((a, b) => a + b.size, 0);
  const tail = eligible.slice(sentCount);
  const batches = [];
  let n = done.length;
  for (let i = 0; i < tail.length; i += newSize) {
    const slice = tail.slice(i, i + newSize);
    n += 1;
    batches.push({
      n,
      key: batchKey(n, newSize),
      size: slice.length,
      plannedSize: newSize,
      emails: slice.map((r) => r.email),
      emailsSha: sha256(slice.map((r) => r.email).join('\n')),
    });
  }
  return batches;
}

export function buildPayload(emails, copy) {
  // One object per recipient - never a shared `to` array, which would BCC them
  // onto each other.
  return emails.map((email) => ({
    from: FROM,
    to: [email],
    reply_to: REPLY_TO,
    subject: copy.subject,
    text: copy.text,
    html: copy.html,
  }));
}

// -- Resend ----------------------------------------------------------------
class HttpError extends Error {
  constructor(status, body) {
    const shown = typeof body === 'string' ? body : JSON.stringify(body);
    super(`HTTP ${status}: ${String(shown).slice(0, 400)}`);
    this.status = status;
    this.body = body;
  }
}

async function resendPost(url, apiKey, payload, idempotencyKey) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const raw = await res.text();
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = raw; }
    if (!res.ok) throw new HttpError(res.status, body);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRetryable = (err) =>
  err?.name === 'AbortError' ||
  err?.status >= 500 ||
  err?.status === 429 ||
  err?.code === 'ECONNRESET' ||
  /fetch failed|network|socket/i.test(err?.message ?? '');

// -- progress --------------------------------------------------------------
function readProgress(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeProgress(file, progress) {
  // Write through a temp file so a kill mid-write cannot leave a truncated
  // progress.json - the one file that makes a re-run safe.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(progress, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// -- logging ---------------------------------------------------------------
const log = (...a) => console.log(...a);
const warn = (...a) => console.log('  !', ...a);
const fail = (msg) => { console.error(`\nSTOP: ${msg}\n`); process.exit(1); };

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

// -- preflight, shared by every mode ---------------------------------------
function preflight(opts) {
  const copy = loadCopy();
  const check = verifyCopy(copy);

  log(`\n${RUN}\n${'='.repeat(RUN.length)}\n`);
  log(`From:      ${FROM}`);
  log(`Reply-To:  ${REPLY_TO}`);
  log(`Subject:   ${SUBJECT}`);
  log(`HTML part: ${copy.htmlSource}`);
  log(`Copy hash: ${copy.hash.slice(0, 16)}`);

  if (check.warnings.length) {
    log('\nCopy warnings:');
    check.warnings.forEach((w) => warn(w));
  }
  if (check.errors.length) {
    log('\nCopy errors:');
    check.errors.forEach((e) => log(`  x ${e}`));
    fail('the email copy is not ready to send (brief section 5).');
  }

  if (!fs.existsSync(opts.csv)) {
    fail(`no recipient CSV at ${opts.csv}. Provide it or pass --csv <path> (brief section 3).`);
  }
  const csvRaw = fs.readFileSync(opts.csv, 'utf8');
  const inputHash = sha256(csvRaw);
  const rows = parseCsv(csvRaw);

  const expectedCols = ['email', 'firstName', 'country', 'marketGroup', 'airtableId'];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const missing = expectedCols.filter((c) => !cols.includes(c));
  if (missing.length) {
    fail(`the CSV is missing column(s): ${missing.join(', ')}. Expected ${expectedCols.join(', ')} (brief section 3). Do not re-derive the audience - tell Anil.`);
  }

  const { counts, detail, eligible } = applyFilters(rows);

  log(`\nCSV:       ${opts.csv}`);
  log(`sha256:    ${inputHash}`);
  log(`\nReconciliation\n--------------\n${formatReconciliation(counts)}\n`);

  if (detail.countries.size) {
    log('Countries excluded:');
    [...detail.countries.entries()].sort().forEach(([k, v]) => log(`  ${k}: ${v}`));
    log('');
  }

  // Section 4.1 - a non-zero suppression count means the export is wrong.
  if (counts.suppressedBlocked > 0) {
    log('Rows the suppression guard caught (the export should have excluded these):');
    detail.suppressed.slice(0, 20).forEach((s) =>
      log(`  ${s.email}  status=${s.status || '-'}  dnc=${s.dnc || '-'}  reason=${s.reason || '-'}`));
    if (detail.suppressed.length > 20) log(`  ... and ${detail.suppressed.length - 20} more`);
    fail(`${counts.suppressedBlocked} suppressed row(s) in the CSV. The export is wrong - stop and tell Anil (brief section 4.1).`);
  }

  if (detail.invalid.length) {
    log('Rows with a missing or invalid email address:');
    detail.invalid.slice(0, 20).forEach((s) => log(`  ${JSON.stringify(s.email)}  (${s.airtableId || 'no id'})`));
    fail(`${detail.invalid.length} row(s) have no valid email. The export should already exclude these - stop and tell Anil (brief section 3).`);
  }

  const rec = reconcile(counts);
  if (counts.internalDropped > 0) {
    warn(`${counts.internalDropped} @akay.ie address(es) dropped at step 4. Section 4's table has no line for this, so the brief's own arithmetic will not close - the identity below carries the term.`);
    detail.internal.forEach((e) => log(`      ${e}`));
  }
  if (Math.abs(counts.fetched - EXPECTED_FETCHED) > EXPECTED_FETCHED * 0.05) {
    warn(`fetched is ${counts.fetched}, the brief expects ~${EXPECTED_FETCHED}.`);
  }
  if (counts.excludedCountry !== EXPECTED_EXCLUDED_COUNTRY) {
    warn(`excludedCountry is ${counts.excludedCountry}, the brief expects ${EXPECTED_EXCLUDED_COUNTRY}.`);
  }
  if (counts.duplicates !== EXPECTED_DUPLICATES) {
    warn(`duplicates is ${counts.duplicates}, the brief expects ${EXPECTED_DUPLICATES}.`);
  }

  if (!rec.identityHolds) {
    fail(`the counts do not reconcile: ${counts.fetched} - ${counts.suppressedBlocked} - ${counts.excludedCountry} - ${counts.duplicates} - ${counts.internalDropped} = ${rec.expected}, but eligible is ${counts.eligible} (brief section 4).`);
  }
  if (!rec.countHolds) {
    fail(`eligible is ${counts.eligible}, and the hard gate is ${EXPECTED_ELIGIBLE} (brief section 4). Off by ${counts.eligible - EXPECTED_ELIGIBLE}. Do not send.`);
  }

  log(`Reconciled: ${counts.eligible} eligible, identity holds, matches the ${EXPECTED_ELIGIBLE} gate.`);
  return { copy, eligible, counts, inputHash };
}

// -- modes -----------------------------------------------------------------
async function doDryRun(opts) {
  const { eligible, copy } = preflight(opts);
  const batches = planBatches(eligible);
  log(`\nPlan: ${batches.length} batches of up to ${BATCH_SIZE}, ~${BATCH_PAUSE_MS / 1000}s apart.`);
  const first = batches[0], last = batches[batches.length - 1];
  log(`  first: ${first.key}  ${first.size} recipients  ${first.emails[0]} ... ${first.emails[first.emails.length - 1]}`);
  log(`  last:  ${last.key}  ${last.size} recipients  ${last.emails[0]} ... ${last.emails[last.emails.length - 1]}`);

  log(`\n--- text part ${'-'.repeat(50)}`);
  log(copy.text);
  log('-'.repeat(64));
  log('\nDry run only. Nothing was sent. Next: --test (brief section 7.2).\n');
}

async function doTest(opts) {
  const { copy, inputHash, counts } = preflight(opts);
  const apiKey = requireKey();
  const key = `${RUN}-test`;

  log(`\nSending ONE email to ${TEST_RECIPIENT} with key ${key} ...`);
  const body = await resendPost(ENDPOINT, apiKey, buildPayload([TEST_RECIPIENT], copy), key);
  const id = body?.data?.[0]?.id ?? null;

  const progress = readProgress(opts.progress) ?? {
    run: RUN, inputHash, eligible: counts.eligible, batchSize: BATCH_SIZE, batches: [],
  };
  progress.test = { to: TEST_RECIPIENT, key, resendId: id, copyHash: copy.hash, at: new Date().toISOString() };
  writeProgress(opts.progress, progress);

  log(`Sent. Resend id: ${id}`);
  log(`Recorded in ${opts.progress}.`);
  log('\nSTOP HERE. Anil reviews the received email before --send (brief section 7.2).\n');
}

async function doSend(opts) {
  const { copy, eligible, counts, inputHash } = preflight(opts);
  const apiKey = requireKey();
  const progress = readProgress(opts.progress);

  // Section 7 - refuse to start without a recorded test send.
  if (!progress?.test) {
    fail(`no test send recorded in ${opts.progress}. Run --test first and have Anil review it (brief section 7).`);
  }
  if (progress.test.copyHash !== copy.hash) {
    fail(`the copy has changed since the test send (${progress.test.copyHash.slice(0, 16)} -> ${copy.hash.slice(0, 16)}). What Anil approved is not what would go out. Re-run --test.`);
  }
  if (progress.inputHash !== inputHash) {
    fail(`recipients.csv has changed since the run started (${progress.inputHash.slice(0, 16)} -> ${inputHash.slice(0, 16)}). Batch NN would no longer mean the same recipients - stop and ask Anil (brief section 6).`);
  }

  progress.batches ??= [];
  const done = progress.batches.filter((b) => b.status === 'sent').sort((a, b) => a.n - b.n);

  // Rebuild the plan exactly as the earlier run formed it, then plan the rest.
  let batches;
  if (done.length) {
    const rebuilt = [];
    let offset = 0;
    done.forEach((d, idx) => {
      const slice = eligible.slice(offset, offset + d.size);
      rebuilt.push({
        n: idx + 1, key: d.key, size: slice.length, plannedSize: d.plannedSize ?? d.size,
        emails: slice.map((r) => r.email), emailsSha: sha256(slice.map((r) => r.email).join('\n')),
      });
      offset += d.size;
    });
    for (const [idx, b] of rebuilt.entries()) {
      if (done[idx].emailsSha && done[idx].emailsSha !== b.emailsSha) {
        fail(`batch ${b.n} (${b.key}) no longer covers the same recipients as when it was sent. Do not continue - tell Anil.`);
      }
    }
    const tailSize = done[done.length - 1].plannedSize ?? BATCH_SIZE;
    batches = [...rebuilt, ...replanTail(eligible, rebuilt, tailSize)];
    log(`\nResuming. Skipping ${done.length} batch(es) already marked sent:`);
    done.forEach((b) => log(`  batch ${b.n} (${b.key}) - ${b.count ?? b.size} recipients, sent ${b.at}`));
  } else {
    batches = planBatches(eligible);
    log(`\nStarting fresh: ${batches.length} batches.`);
  }

  log(`Test send: ${progress.test.to} at ${progress.test.at} (id ${progress.test.resendId}).`);
  const todo = batches.filter((b) => !progress.batches.some((p) => p.key === b.key && p.status === 'sent'));
  if (todo.length === 0) { log('\nNothing left to send - every batch is already marked sent.\n'); return; }
  const todoCount = todo.reduce((a, b) => a + b.size, 0);
  log(`\nAbout to send ${todoCount} emails across ${todo.length} batch(es), one per recipient.`);

  if (!opts.yes) {
    const a = await ask('\nHas Anil approved the test email? Type "sent" to proceed: ');
    if (a.toLowerCase() !== 'sent') fail('not confirmed. Nothing was sent.');
  }

  const started = Date.now();
  let currentSize = BATCH_SIZE;

  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    if (progress.batches.some((p) => p.key === batch.key && p.status === 'sent')) continue;

    let attempt = 0, retryables = 0, sent = false, lastErr = null;
    while (attempt < MAX_ATTEMPTS_PER_BATCH && !sent) {
      attempt += 1;
      try {
        log(`  batch ${String(batch.n).padStart(2, '0')} (${batch.key}) - ${batch.size} recipients, attempt ${attempt} ...`);
        const body = await resendPost(ENDPOINT, apiKey, buildPayload(batch.emails, copy), batch.key);
        const ids = (body?.data ?? []).map((d) => d.id);
        log(`     ok, ${ids.length} accepted`);
        progress.batches = progress.batches.filter((p) => p.key !== batch.key);
        progress.batches.push({
          n: batch.n, key: batch.key, count: batch.size, size: batch.size,
          plannedSize: batch.plannedSize, emailsSha: batch.emailsSha,
          status: 'sent', resendIds: ids, attempts: attempt, at: new Date().toISOString(),
        });
        writeProgress(opts.progress, progress);
        sent = true;
      } catch (err) {
        lastErr = err;
        log(`     failed - ${err.message}`);
        if (!isRetryable(err)) break;
        retryables += 1;
        // Section 6 - two timeouts or 5xx on one batch drops the REMAINDER to
        // 50. The current batch keeps its own key and payload: retrying it
        // unchanged is exactly what the idempotency key protects.
        if (retryables === DEGRADE_AFTER_FAILURES && currentSize !== DEGRADED_BATCH_SIZE) {
          currentSize = DEGRADED_BATCH_SIZE;
          warn(`two retryable failures on batch ${batch.n} - dropping to ${DEGRADED_BATCH_SIZE} per call for the remainder.`);
          progress.degradedAt = { batch: batch.n, to: DEGRADED_BATCH_SIZE, at: new Date().toISOString() };
        }
        await sleep(Math.min(2000 * 2 ** (attempt - 1), 30000));
      }
    }

    if (!sent) {
      progress.batches = progress.batches.filter((p) => p.key !== batch.key);
      progress.batches.push({
        n: batch.n, key: batch.key, count: batch.size, size: batch.size,
        plannedSize: batch.plannedSize, emailsSha: batch.emailsSha,
        status: 'failed', error: lastErr?.message ?? 'unknown', attempts: attempt,
        at: new Date().toISOString(),
      });
      writeProgress(opts.progress, progress);
      fail(`batch ${batch.n} (${batch.key}) failed after ${attempt} attempt(s): ${lastErr?.message}. Progress saved - re-run --send to resume from here.`);
    }

    // Re-plan the tail if we degraded mid-run.
    if (currentSize === DEGRADED_BATCH_SIZE && batches[i + 1] && batches[i + 1].plannedSize !== DEGRADED_BATCH_SIZE) {
      const sentSoFar = batches.slice(0, i + 1);
      batches = [...sentSoFar, ...replanTail(eligible, sentSoFar, DEGRADED_BATCH_SIZE)];
    }

    if (i < batches.length - 1) await sleep(BATCH_PAUSE_MS);
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  progress.finishedAt = new Date().toISOString();
  progress.elapsedSeconds = elapsed;
  writeProgress(opts.progress, progress);
  log(`\nDone. ${counts.eligible} recipients across ${progress.batches.filter((b) => b.status === 'sent').length} batches in ${elapsed}s.`);
  log('Next: --report (brief section 8), and watch the bounce rate - over 5% means stop.\n');
}

async function doReport(opts) {
  const progress = readProgress(opts.progress);
  if (!progress) fail(`no progress file at ${opts.progress}.`);
  const sent = (progress.batches ?? []).filter((b) => b.status === 'sent');
  const failed = (progress.batches ?? []).filter((b) => b.status !== 'sent');
  const ids = sent.flatMap((b) => b.resendIds ?? []);

  let events = null;
  if (opts.withStatus) {
    const apiKey = requireKey();
    events = new Map();
    log(`Polling ${ids.length} email(s) for delivery events - paced at 2/s, so roughly ${Math.ceil(ids.length / 2 / 60)} min.`);
    for (const [n, id] of ids.entries()) {
      try {
        const res = await fetch(`${EMAIL_ENDPOINT}/${id}`, { headers: { Authorization: `Bearer ${apiKey}` } });
        const body = await res.json();
        const ev = body?.last_event ?? 'unknown';
        events.set(ev, (events.get(ev) ?? 0) + 1);
      } catch {
        events.set('lookup_failed', (events.get('lookup_failed') ?? 0) + 1);
      }
      if (n % 100 === 99) log(`  ${n + 1}/${ids.length}`);
      await sleep(500);
    }
  }

  const bounced = events ? (events.get('bounced') ?? 0) : null;
  const complained = events ? (events.get('complained') ?? 0) : null;
  const rate = (n) => (n === null ? 'pending' : `${((n / Math.max(ids.length, 1)) * 100).toFixed(2)}%`);
  const lastSent = sent.length ? sent[sent.length - 1] : null;

  const lines = [
    `# ${RUN} - send report`,
    '',
    `Generated ${new Date().toISOString()}`,
    '',
    '## Send',
    '',
    `- Eligible recipients: ${progress.eligible}`,
    `- Accepted by Resend: ${ids.length}`,
    `- Batches sent: ${sent.length}`,
    `- Final batch size used: ${lastSent ? lastSent.count ?? lastSent.size : '-'}`,
    progress.degradedAt
      ? `- Degraded to ${progress.degradedAt.to} per call at batch ${progress.degradedAt.batch} (${progress.degradedAt.at})`
      : '- Batch size held at 100 throughout',
    `- Elapsed: ${progress.elapsedSeconds != null ? `${progress.elapsedSeconds}s` : 'incomplete'}`,
    `- Test send: ${progress.test ? `${progress.test.to} at ${progress.test.at} (${progress.test.resendId})` : 'none recorded'}`,
    '',
    '## Per batch',
    '',
    '| # | key | count | status | attempts | at |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[...(progress.batches ?? [])].sort((a, b) => a.n - b.n).map(
      (b) => `| ${b.n} | \`${b.key}\` | ${b.count ?? b.size} | ${b.status} | ${b.attempts ?? '-'} | ${b.at} |`),
    '',
  ];

  if (failed.length) {
    lines.push('## Failures', '');
    failed.forEach((b) => lines.push(`- batch ${b.n} (\`${b.key}\`): ${b.error} - ${b.attempts} attempt(s)`));
    lines.push('');
  }

  lines.push('## Bounces and complaints', '');
  if (events) {
    lines.push('| last_event | count |', '| --- | --- |');
    [...events.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => lines.push(`| ${k} | ${v} |`));
    lines.push('', `Bounce rate: ${rate(bounced)} - healthy is under 2%, over 5% means stop.`);
    lines.push(`Complaint rate: ${rate(complained)}.`);
    if (bounced !== null && ids.length && bounced / ids.length > 0.05) {
      lines.push('', '**BOUNCE RATE OVER 5% - stop and tell Anil. Do not send remaining batches.**');
    }
  } else {
    lines.push('Not polled. Re-run with `--report --with-status` once events have landed,');
    lines.push('or read them off the Resend dashboard.');
    lines.push('', 'Bounce watch: under 2% is healthy. **Over 5%, stop and tell Anil.**');
  }
  lines.push('', 'Bounces and unsubscribes are handled by the existing n8n workflow.',
    'This script wrote nothing to Airtable.', '');

  const out = path.join(DIR, 'report.md');
  fs.writeFileSync(out, `${lines.join('\n')}`);
  log(lines.join('\n'));
  log(`\nWritten to ${out}\n`);
}

function requireKey() {
  const key = process.env.RESEND_API_KEY;
  if (!key) fail('RESEND_API_KEY is not set. Export it in the shell - never write it to a file (brief section 2).');
  return key;
}

// -- entry -----------------------------------------------------------------
export function parseArgs(argv) {
  const opts = {
    mode: null,
    csv: path.join(DIR, 'recipients.csv'),
    progress: path.join(DIR, 'progress.json'),
    yes: false,
    withStatus: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.mode = 'dry-run';
    else if (a === '--test') opts.mode = 'test';
    else if (a === '--send') opts.mode = 'send';
    else if (a === '--report') opts.mode = 'report';
    else if (a === '--csv') { i += 1; opts.csv = path.resolve(argv[i]); }
    else if (a === '--progress') { i += 1; opts.progress = path.resolve(argv[i]); }
    else if (a === '--yes') opts.yes = true;
    else if (a === '--with-status') opts.withStatus = true;
    else if (a === '--help' || a === '-h') opts.mode = 'help';
    else fail(`unknown argument: ${a}`);
  }
  return opts;
}

const USAGE = `
${RUN} - offer dispatch

  node dispatch.mjs --dry-run    parse, filter, reconcile, print. No send.
  node dispatch.mjs --test       one email to ${TEST_RECIPIENT}.
  node dispatch.mjs --send       the full run to the ${EXPECTED_ELIGIBLE}, resumable.
  node dispatch.mjs --report     the send summary. Add --with-status to poll Resend.

  --csv <path>       default: ./recipients.csv beside this script
  --progress <path>  default: ./progress.json beside this script
  --yes              skip the interactive approval prompt on --send
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.mode || opts.mode === 'help') { log(USAGE); process.exit(opts.mode ? 0 : 1); }
  if (opts.mode === 'dry-run') return doDryRun(opts);
  if (opts.mode === 'test') return doTest(opts);
  if (opts.mode === 'send') return doSend(opts);
  if (opts.mode === 'report') return doReport(opts);
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((err) => { console.error(`\nSTOP: ${err.stack ?? err.message}\n`); process.exit(1); });
}
