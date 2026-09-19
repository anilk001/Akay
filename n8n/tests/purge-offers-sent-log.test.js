/**
 * Tests for the "Purge — Offers Sent Log" Code nodes.
 *
 * Same harness as unmatched-demand-digest.test.js: the node source is executed
 * rather than re-typed, so the test cannot drift from what gets pasted into
 * n8n. `$now`, `$input` and `$()` are faked.
 *
 * This workflow deletes rows that prove client emails were sent, and a deleted
 * Airtable record is gone. So the assertions here are almost all of the form
 * "it must REFUSE to delete X" — the happy path is the cheap half. Every case
 * below is a way the purge could destroy something it should not have:
 *
 *   - a backup that is not today's, or Flagged, or does not cover this table
 *   - a row still queued to send (Draft / Ready to Send)
 *   - a row with no Sent Date, whose age cannot be established
 *   - a row inside the retention window
 *   - a candidate set so large the filter must be wrong
 *
 * These use synthetic fixtures only. Nothing here reads the live catalogue or
 * the snapshot, so a routine refresh cannot break it (see snapshot-safe-tests).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_SRC = join(HERE, '..', 'purge-offers-sent-log', 'backup-gate.js');
const BATCH_SRC = join(HERE, '..', 'purge-offers-sent-log', 'recheck-and-cap-batch.js');

const gateFn = new Function('$input', '$now', readFileSync(GATE_SRC, 'utf8'));
const batchFn = new Function('$input', '$', readFileSync(BATCH_SRC, 'utf8'));

const TODAY = '2026-09-19';
const NOW = { setZone: () => ({ toFormat: () => TODAY }) };

function inputOf(items) {
  return { first: () => items[0], all: () => items };
}

/** A Backup Registry row that should let the purge proceed. */
function goodBackup(over = {}) {
  return {
    json: {
      fields: Object.assign({
        'Backup Date': TODAY,
        Status: 'Verified',
        'Tables Covered': 'Suppliers, Products, Offers, Offers Sent Log, Invoices',
        'Storage Location': 'https://drive.google.com/drive/folders/abc123',
      }, over),
    },
  };
}

function runGate(backupRow) {
  return gateFn(inputOf([backupRow]), NOW)[0].json;
}

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}`);
    console.error(`  ${e.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- the gate

check('gate opens when backup is today, Verified and covers the table', () => {
  const g = runGate(goodBackup());
  assert.strictEqual(g.gateOk, true, 'expected the gate to open');
  assert.strictEqual(g.gateReason, '');
  assert.strictEqual(g.retentionDays, 30);
});

check('gate blocks on a backup that is not today', () => {
  const g = runGate(goodBackup({ 'Backup Date': '2026-09-18' }));
  assert.strictEqual(g.gateOk, false);
  assert.match(g.gateReason, /dated 2026-09-18, not today/);
});

check('gate blocks on a Flagged backup', () => {
  const g = runGate(goodBackup({ Status: 'Flagged' }));
  assert.strictEqual(g.gateOk, false);
  assert.match(g.gateReason, /status is Flagged, not Verified/);
});

check('gate blocks on a Failed backup', () => {
  const g = runGate(goodBackup({ Status: 'Failed' }));
  assert.strictEqual(g.gateOk, false);
});

check('gate blocks when Offers Sent Log is missing from Tables Covered', () => {
  // The exact 2026-08-03/04 failure: the backup ran and passed, but a dead
  // table id upstream meant this table was never in it.
  const g = runGate(goodBackup({ 'Tables Covered': 'Suppliers, Products, Offers' }));
  assert.strictEqual(g.gateOk, false);
  assert.match(g.gateReason, /Offers Sent Log is not listed/);
});

check('gate blocks when no registry row can be read at all', () => {
  const g = gateFn(inputOf([{ json: {} }]), NOW)[0].json;
  assert.strictEqual(g.gateOk, false);
  assert.match(g.gateReason, /no Backup Registry row/);
});

check('gate reports every failing condition, not just the first', () => {
  const g = runGate(goodBackup({ 'Backup Date': '2026-01-01', Status: 'Flagged', 'Tables Covered': '' }));
  assert.strictEqual(g.gateOk, false);
  assert.match(g.gateReason, /not today/);
  assert.match(g.gateReason, /not Verified/);
  assert.match(g.gateReason, /not listed/);
});

check('formula excludes pending states and requires a Sent Date', () => {
  const { formula } = runGate(goodBackup());
  assert.match(formula, /\{Sent Date\}/, 'must test Sent Date for non-emptiness');
  assert.match(formula, /IS_BEFORE/);
  assert.match(formula, /\{Dispatch Status\} != "Draft"/);
  assert.match(formula, /\{Dispatch Status\} != "Ready to Send"/);
});

// ------------------------------------------------------- the re-check node

const GATE_OUT = {
  cutoff: '2026-08-20T00:00:00.000Z',
  maxPerRun: 2000,
  abortIfMoreThan: 25000,
};
const fakeGate = () => ({ first: () => ({ json: GATE_OUT }) });

function row(id, sentDate, dispatchStatus) {
  return { json: { id, fields: { 'Log ID': `log-${id}`, 'Sent Date': sentDate, 'Dispatch Status': dispatchStatus } } };
}

function runBatch(rows, gateOver = {}) {
  const g = Object.assign({}, GATE_OUT, gateOver);
  return batchFn(inputOf(rows), () => ({ first: () => ({ json: g }) }));
}

check('re-check keeps an old, terminal row', () => {
  const out = runBatch([row('rec1', '2026-07-01T10:00:00.000Z', 'Sent')]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].json.recordId, 'rec1');
});

check('re-check NEVER deletes a Draft row, however old', () => {
  const out = runBatch([row('rec1', '2025-01-01T10:00:00.000Z', 'Draft')]);
  assert.strictEqual(out.length, 0, 'a Draft row must never be purged');
  assert.strictEqual(out.length === 0, true);
});

check('re-check NEVER deletes a Ready to Send row, however old', () => {
  const out = runBatch([row('rec1', '2025-01-01T10:00:00.000Z', 'Ready to Send')]);
  assert.strictEqual(out.length, 0, 'a queued row must never be purged');
});

check('re-check NEVER deletes a row with no Sent Date', () => {
  const out = runBatch([row('rec1', '', 'Sent'), row('rec2', null, 'Sent')]);
  assert.strictEqual(out.length, 0, 'age cannot be established, so it must be kept');
});

check('re-check NEVER deletes a row with an unparseable Sent Date', () => {
  const out = runBatch([row('rec1', 'not-a-date', 'Sent')]);
  assert.strictEqual(out.length, 0);
});

check('re-check NEVER deletes a row inside the retention window', () => {
  const out = runBatch([row('rec1', '2026-09-18T10:00:00.000Z', 'Sent')]);
  assert.strictEqual(out.length, 0, 'newer than the cutoff must be kept');
});

check('re-check treats the cutoff instant itself as still protected', () => {
  const out = runBatch([row('rec1', GATE_OUT.cutoff, 'Sent')]);
  assert.strictEqual(out.length, 0, 'a row exactly at the cutoff is not yet older than it');
});

check('re-check keeps rows with a blank Dispatch Status', () => {
  // ~2,990 of the oldest rows carry no Dispatch Status. They are history, not
  // pending work, so they are purgeable — only Draft/Ready to Send are not.
  const out = runBatch([row('rec1', '2026-07-01T10:00:00.000Z', '')]);
  assert.strictEqual(out.length, 1);
});

check('re-check skips rows with no record id', () => {
  const out = runBatch([{ json: { fields: { 'Sent Date': '2026-07-01T10:00:00.000Z', 'Dispatch Status': 'Sent' } } }]);
  assert.strictEqual(out.length, 0);
});

check('re-check caps the batch at maxPerRun and reports the remainder', () => {
  const rows = [];
  for (let i = 0; i < 25; i++) rows.push(row(`rec${i}`, '2026-07-01T10:00:00.000Z', 'Sent'));
  const out = runBatch(rows, { maxPerRun: 10 });
  assert.strictEqual(out.length, 10, 'batch must be capped');
  assert.strictEqual(out[0].json._candidateTotal, 25);
  assert.strictEqual(out[0].json._remainingAfter, 15);
});

check('re-check throws rather than delete above the abort ceiling', () => {
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(row(`rec${i}`, '2026-07-01T10:00:00.000Z', 'Sent'));
  assert.throws(
    () => runBatch(rows, { abortIfMoreThan: 10 }),
    /Purge aborted: 12 rows matched/,
    'a runaway candidate set must abort, not truncate silently'
  );
});

check('re-check counts each skip reason separately', () => {
  const out = runBatch([
    row('a', '2026-07-01T10:00:00.000Z', 'Sent'),
    row('b', '', 'Sent'),
    row('c', '2026-09-18T10:00:00.000Z', 'Sent'),
    row('d', '2026-07-01T10:00:00.000Z', 'Draft'),
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].json._skippedNoDate, 1);
  assert.strictEqual(out[0].json._skippedTooNew, 1);
  assert.strictEqual(out[0].json._skippedPending, 1);
});

check('re-check returns nothing on empty input without throwing', () => {
  const out = runBatch([]);
  assert.strictEqual(out.length, 0);
});

check('re-check tolerates already-flattened rows (no .fields wrapper)', () => {
  const out = runBatch([
    { json: { id: 'rec1', 'Log ID': 'log-1', 'Sent Date': '2026-07-01T10:00:00.000Z', 'Dispatch Status': 'Sent' } },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].json.recordId, 'rec1');
});

if (process.exitCode) {
  console.error(`\npurge-offers-sent-log: ${passed} passed, failures above.`);
} else {
  console.log(`purge-offers-sent-log: ${passed} passed`);
}
