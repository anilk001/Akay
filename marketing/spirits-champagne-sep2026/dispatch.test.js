// Tests for the September 2026 spirits dispatch filters and batching.
//
// Deliberately NOT wired into `npm test`: that suite gates the five-minute
// catalogue refresh, and a one-off campaign script has no business blocking a
// snapshot commit. Run it by hand before a send:
//
//   node marketing/spirits-champagne-sep2026/dispatch.test.js
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseCsv, normCountry, isExcludedCountry, applyFilters, reconcile,
  planBatches, replanTail, batchKey, buildPayload, buildConnectorPayload, loadCopy, verifyCopy,
  textToHtml, BATCH_SIZE, DEGRADED_BATCH_SIZE, RUN, FROM, REPLY_TO, SUBJECT,
  GREETING, FOOTER, PLACEHOLDER,
} from './dispatch.mjs';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed += 1; }
  catch (err) { console.error(`FAIL: ${name}\n  ${err.message}`); process.exitCode = 1; }
};

const HEADER = 'email,firstName,country,marketGroup,airtableId';
const row = (email, country = 'France', extra = '') =>
  `${email},Buyer,${country},Spirits,rec${email.replace(/\W/g, '')}${extra}`;

// -- CSV -------------------------------------------------------------------
test('parses a plain CSV into objects keyed by header', () => {
  const rows = parseCsv(`${HEADER}\n${row('a@b.com')}\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'a@b.com');
  assert.equal(rows[0].country, 'France');
  assert.equal(rows[0].marketGroup, 'Spirits');
});

test('handles quoted fields, embedded commas, doubled quotes and CRLF', () => {
  const csv = `${HEADER}\r\n"a@b.com","Smith, John","Côte d'Ivoire","Spirits, Wine",rec1\r\n"c@d.com","He said ""hi""",France,Spirits,rec2\r\n`;
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].firstName, 'Smith, John');
  assert.equal(rows[0].marketGroup, 'Spirits, Wine');
  assert.equal(rows[1].firstName, 'He said "hi"');
});

test('strips a UTF-8 BOM off the header', () => {
  const rows = parseCsv(`﻿${HEADER}\n${row('a@b.com')}\n`);
  assert.equal(rows[0].email, 'a@b.com');
});

test('ignores blank lines rather than emitting empty rows', () => {
  const rows = parseCsv(`${HEADER}\n${row('a@b.com')}\n\n\n`);
  assert.equal(rows.length, 1);
});

// -- country exclusion -----------------------------------------------------
test('normalises case, punctuation, spacing and accents', () => {
  assert.equal(normCountry('U.S.A.'), 'usa');
  assert.equal(normCountry('  United  States '), 'unitedstates');
  assert.equal(normCountry('Éire'), 'eire');
});

test('excludes the three countries and their obvious variants', () => {
  for (const c of ['Ireland', 'ireland', 'IE', 'IRL', 'Republic of Ireland', 'Éire',
    'USA', 'US', 'U.S.', 'U.S.A.', 'United States', 'united states of america',
    'Brazil', 'Brasil', 'BR', 'bra']) {
    assert.ok(isExcludedCountry(c), `${c} should be excluded`);
  }
});

test('keeps countries that merely look similar', () => {
  // Northern Ireland is the United Kingdom, and these are separate markets.
  for (const c of ['Northern Ireland', 'Iceland', 'Austria', 'Australia', 'France',
    'Brunei', 'Britain', 'United Kingdom', 'UK', '']) {
    assert.ok(!isExcludedCountry(c), `${c} should be kept`);
  }
});

// -- filters ---------------------------------------------------------------
test('applies the four filters in order and reconciles', () => {
  const rows = parseCsv([
    HEADER,
    row('keep1@b.com', 'France'),
    row('keep2@b.com', 'Spain'),
    row('drop@b.com', 'Ireland'),
    row('drop2@b.com', 'U.S.A.'),
    row('KEEP1@b.com', 'Germany'),        // duplicate of keep1, different case
    row('anil@akay.ie', 'Netherlands'),   // internal
    row('keep3@b.com', 'Italy'),
  ].join('\n'));

  const { counts, eligible } = applyFilters(rows);
  assert.equal(counts.fetched, 7);
  assert.equal(counts.suppressedBlocked, 0);
  assert.equal(counts.excludedCountry, 2);
  assert.equal(counts.duplicates, 1);
  assert.equal(counts.internalDropped, 1);
  assert.equal(counts.eligible, 3);
  assert.ok(reconcile(counts).identityHolds);
  assert.deepEqual(eligible.map((r) => r.email), ['keep1@b.com', 'keep2@b.com', 'keep3@b.com']);
});

test('the suppression guard catches every shape the export should have removed', () => {
  const rows = parseCsv([
    'email,firstName,country,marketGroup,airtableId,Status,Do Not Contact,Suppression Reason',
    'a@b.com,Buyer,France,Spirits,rec1,Active,,',
    'b@b.com,Buyer,France,Spirits,rec2,Inactive,,',
    'c@b.com,Buyer,France,Spirits,rec3,Active,true,',
    'd@b.com,Buyer,France,Spirits,rec4,Active,,hard bounce',
    'e@b.com,Buyer,France,Spirits,rec5,Active,checked,',
  ].join('\n'));
  const { counts } = applyFilters(rows);
  assert.equal(counts.suppressedBlocked, 4);
  assert.equal(counts.eligible, 1);
});

test('dedupe keeps the first occurrence, not the last', () => {
  const rows = parseCsv([HEADER,
    'first@b.com,Alice,France,Spirits,recA',
    'FIRST@b.com,Bob,Spain,Beer,recB'].join('\n'));
  const { eligible, counts } = applyFilters(rows);
  assert.equal(counts.duplicates, 1);
  assert.equal(eligible[0].firstName, 'Alice');
  assert.equal(eligible[0].airtableId, 'recA');
});

test('rows with no usable email are surfaced, never silently sent', () => {
  const rows = parseCsv([HEADER,
    'a@b.com,Buyer,France,Spirits,rec1',
    ',Buyer,France,Spirits,rec2',
    'not-an-email,Buyer,France,Spirits,rec3'].join('\n'));
  const { detail, counts } = applyFilters(rows);
  assert.equal(detail.invalid.length, 2);
  assert.equal(counts.eligible, 1);
});

test('eligible is sorted by email so batch membership is stable across runs', () => {
  const emails = ['zoe@b.com', 'adam@b.com', 'Mia@b.com', 'bob@b.com'];
  const a = applyFilters(parseCsv([HEADER, ...emails.map((e) => row(e))].join('\n'))).eligible;
  const b = applyFilters(parseCsv([HEADER, ...[...emails].reverse().map((e) => row(e))].join('\n'))).eligible;
  assert.deepEqual(a.map((r) => r.email), b.map((r) => r.email));
  assert.deepEqual(a.map((r) => r.email), ['adam@b.com', 'bob@b.com', 'mia@b.com', 'zoe@b.com']);
});

test('reconcile enforces both gates independently', () => {
  const ok = { fetched: 1381, suppressedBlocked: 0, excludedCountry: 28, duplicates: 31, internalDropped: 0, eligible: 1322 };
  assert.ok(reconcile(ok).identityHolds && reconcile(ok).countHolds);
  assert.ok(!reconcile({ ...ok, eligible: 1321 }).identityHolds);
  // Arithmetic can close on the wrong total - 1,322 is its own hard gate.
  const off = { ...ok, fetched: 1380, eligible: 1321 };
  assert.ok(reconcile(off).identityHolds);
  assert.ok(!reconcile(off).countHolds);
});

// -- batching --------------------------------------------------------------
const people = (n) => Array.from({ length: n }, (_, i) => ({ email: `u${String(i).padStart(4, '0')}@b.com` }));

test('plans 1,322 recipients into 14 batches, the last one short', () => {
  const batches = planBatches(people(1322));
  assert.equal(batches.length, 14);
  assert.equal(batches.reduce((a, b) => a + b.size, 0), 1322);
  assert.equal(batches[0].size, BATCH_SIZE);
  assert.equal(batches[13].size, 22);
  assert.equal(batches[0].key, `${RUN}-batch01`);
  assert.equal(batches[13].key, `${RUN}-batch14`);
});

test('every recipient lands in exactly one batch', () => {
  const all = people(1322);
  const seen = planBatches(all).flatMap((b) => b.emails);
  assert.equal(new Set(seen).size, 1322);
  assert.deepEqual(seen, all.map((p) => p.email));
});

test('the same input always yields the same batch keys and membership', () => {
  const a = planBatches(people(1322));
  const b = planBatches(people(1322));
  assert.deepEqual(a.map((x) => [x.key, x.emailsSha]), b.map((x) => [x.key, x.emailsSha]));
});

test('degraded batches use a separate key namespace', () => {
  // A re-formed 50 must never reuse batchNN: one idempotency key pointing at
  // two different payloads is how a double-send happens.
  assert.equal(batchKey(3, BATCH_SIZE), `${RUN}-batch03`);
  assert.equal(batchKey(3, DEGRADED_BATCH_SIZE), `${RUN}-b50-batch03`);
  assert.notEqual(batchKey(3, BATCH_SIZE), batchKey(3, DEGRADED_BATCH_SIZE));
});

test('replanning the tail at 50 leaves sent batches untouched and loses nobody', () => {
  const all = people(1322);
  const full = planBatches(all);
  const done = full.slice(0, 3);                       // 300 already accepted
  const tail = replanTail(all, done, DEGRADED_BATCH_SIZE);

  assert.equal(tail[0].n, 4);
  assert.equal(tail[0].key, `${RUN}-b50-batch04`);
  assert.equal(tail[0].emails[0], all[300].email);
  assert.equal(done.reduce((a, b) => a + b.size, 0) + tail.reduce((a, b) => a + b.size, 0), 1322);

  const seen = [...done, ...tail].flatMap((b) => b.emails);
  assert.equal(new Set(seen).size, 1322);
  assert.equal(new Set([...done, ...tail].map((b) => b.key)).size, done.length + tail.length);
});

// -- payload ---------------------------------------------------------------
test('builds one message per recipient - never a shared to array', () => {
  const copy = { subject: SUBJECT, text: 'x', html: '<p>x</p>' };
  const payload = buildPayload(['a@b.com', 'c@d.com'], copy);
  assert.equal(payload.length, 2);
  payload.forEach((m) => {
    assert.equal(m.to.length, 1, 'each message addresses exactly one recipient');
    assert.equal(m.from, FROM);
    assert.equal(m.reply_to, REPLY_TO);
    assert.equal(m.subject, SUBJECT);
    assert.ok(m.text && m.html, 'both parts are sent');
  });
  assert.deepEqual(payload.map((m) => m.to[0]), ['a@b.com', 'c@d.com']);
  assert.equal(JSON.stringify(payload).includes('bcc'), false);
});

test('the connector payload carries the same one-per-recipient rule', () => {
  const copy = { subject: SUBJECT, text: 'x', html: '<p>x</p>' };
  const payload = buildConnectorPayload(['a@b.com', 'c@d.com'], copy);
  assert.equal(payload.length, 2);
  payload.forEach((m) => {
    assert.equal(m.to.length, 1, 'each message addresses exactly one recipient');
    assert.deepEqual(m.replyTo, [REPLY_TO], 'the connector spells it replyTo, not reply_to');
    assert.equal(m.from, FROM);
  });
  assert.equal(/"bcc"|"cc"/i.test(JSON.stringify(payload)), false);
});

test('both transports send byte-identical content, only the envelope differs', () => {
  const copy = { subject: SUBJECT, text: 'body', html: '<p>body</p>' };
  const rest = buildPayload(['a@b.com'], copy)[0];
  const conn = buildConnectorPayload(['a@b.com'], copy)[0];
  assert.equal(rest.subject, conn.subject);
  assert.equal(rest.text, conn.text);
  assert.equal(rest.html, conn.html);
  assert.deepEqual(rest.to, conn.to);
  assert.equal(rest.reply_to, conn.replyTo[0]);
});

// -- copy ------------------------------------------------------------------
const withCopy = (body, fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-'));
  fs.writeFileSync(path.join(dir, 'email.txt'), body);
  try { fn(loadCopy(dir)); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

const GOOD = `Champagne and spirits, T2, ready to move this week.

Full list and prices: https://quote.akay.ie/?utm_campaign=spirits-champagne-sep2026

Reply with the lines you want and we will confirm allocation the same day.`;

test('refuses copy that still holds the paste marker', () => {
  withCopy(`${PLACEHOLDER}\n\nsome notes`, (copy) => {
    const { errors } = verifyCopy(copy);
    assert.ok(errors.some((e) => e.includes(PLACEHOLDER)));
  });
});

test('accepts the final copy and wraps it with the flat greeting and opt-out', () => {
  withCopy(GOOD, (copy) => {
    const { errors } = verifyCopy(copy);
    assert.deepEqual(errors, []);
    assert.ok(copy.text.startsWith(`${GREETING}\n`));
    assert.ok(copy.text.includes(FOOTER));
    assert.ok(copy.html.includes('STOP'));
    assert.equal(copy.htmlSource, 'derived from email.txt');
  });
});

test('flags merge tokens, firstName and off-domain links', () => {
  withCopy(`Hi {{first_name}}, see https://example.com/offers and firstName`, (copy) => {
    const { errors } = verifyCopy(copy);
    assert.ok(errors.some((e) => e.includes('merge tokens')));
    assert.ok(errors.some((e) => e.includes('firstName')));
    assert.ok(errors.some((e) => e.includes('outside akay.ie')));
  });
});

test('warns, rather than fails, on an akay.ie link that is not quote.akay.ie', () => {
  withCopy(`${GOOD}\n\nCatalogue: https://akay.ie/`, (copy) => {
    const { errors, warnings } = verifyCopy(copy);
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('akay.ie')));
  });
});

test('surfaces the named warehouse in the subject for a human to sign off', () => {
  withCopy(GOOD, (copy) => {
    assert.ok(verifyCopy(copy).warnings.some((w) => w.includes('Loendersloot')));
  });
});

test('rejects an HTML part carrying a tracking pixel', () => {
  withCopy(GOOD, (copy) => {
    const pixelled = { ...copy, html: `${copy.html}<img src="https://akay.ie/pixel.gif" width="1">` };
    assert.ok(verifyCopy(pixelled).errors.some((e) => e.includes('tracking pixel')));
  });
});

test('identical copy hashes identically, changed copy does not', () => {
  let a, b;
  withCopy(GOOD, (c) => { a = c.hash; });
  withCopy(GOOD, (c) => { b = c.hash; });
  assert.equal(a, b, 'the --send copy guard needs a stable hash');
  withCopy(`${GOOD} `, (c) => assert.equal(c.hash, b, 'trailing whitespace is not a copy change'));
  withCopy(`${GOOD}\n\nPS.`, (c) => assert.notEqual(c.hash, b));
});

test('derived HTML escapes markup and links bare URLs', () => {
  const html = textToHtml('a <b> & c\n\nhttps://quote.akay.ie/x');
  assert.ok(html.includes('&lt;b&gt;') && html.includes('&amp;'));
  assert.ok(html.includes('<a href="https://quote.akay.ie/x"'));
  assert.ok(!html.includes('<img'));
});

console.log(`dispatch: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
