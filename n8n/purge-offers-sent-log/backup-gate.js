/**
 * Backup Gate - the only thing between this workflow and irreversible
 * deletion of the dispatch audit trail.
 *
 * Offers Sent Log is how a dispatch is proven to have happened. The canonical
 * method says: DO NOT SAY IT WENT OUT until Offers Sent Log has N rows with
 * Dispatch Status=Sent. The Aperol 2026-07-27 partial send (449 BCCd, only 275
 * log rows) was caught by counting rows here. So a row is deleted ONLY when
 * todays Drive backup demonstrably contains it.
 *
 * Three conditions, all required:
 *   1. newest Backup Registry row is dated today (Europe/Dublin)
 *   2. its Status is Verified (not Flagged, not Failed)
 *   3. Offers Sent Log is named in its Tables Covered
 *
 * Condition 3 matters because Export Each Table continues past a failed table:
 * a backup can be Verified overall while this table is missing from it. Twice
 * already a dead table id silently dropped the nine tables after it, Offers
 * Sent Log among them.
 */

const RETENTION_DAYS = 30;
const MAX_PER_RUN = 2000;
const ABORT_IF_MORE_THAN = 25000;
const REQUIRED_TABLE = 'Offers Sent Log';

const first = $input.first();
const raw = first ? (first.json || {}) : {};
const f = raw.fields || raw;

const today = $now.setZone('Europe/Dublin').toFormat('yyyy-LL-dd');
const backupDate = String(f['Backup Date'] || '').slice(0, 10);
const status = String(f['Status'] || '');
const covered = String(f['Tables Covered'] || '');

const reasons = [];
if (!backupDate) reasons.push('no Backup Registry row could be read at all');
else if (backupDate !== today) reasons.push('newest backup is dated ' + backupDate + ', not today (' + today + ')');
if (status !== 'Verified') reasons.push('newest backup status is ' + (status || 'blank') + ', not Verified');
if (covered.indexOf(REQUIRED_TABLE) === -1) reasons.push(REQUIRED_TABLE + ' is not listed in that backups Tables Covered');

// Cutoff is an instant, not a date: Sent Date is a dateTime in Europe/Dublin.
const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();

// {Sent Date} alone is the non-empty test - a row with no Sent Date has no
// determinable age and is never purged. Draft / Ready to Send are pending work,
// not history, so they are excluded whatever their age.
const formula = 'AND({Sent Date}, IS_BEFORE({Sent Date}, DATETIME_PARSE("' + cutoff + '")), {Dispatch Status} != "Draft", {Dispatch Status} != "Ready to Send")';

return [{ json: {
  gateOk: reasons.length === 0,
  gateReason: reasons.join('; '),
  cutoff: cutoff,
  formula: formula,
  today: today,
  backupDate: backupDate,
  backupStatus: status,
  backupLocation: String(f['Storage Location'] || ''),
  retentionDays: RETENTION_DAYS,
  maxPerRun: MAX_PER_RUN,
  abortIfMoreThan: ABORT_IF_MORE_THAN,
} }];
