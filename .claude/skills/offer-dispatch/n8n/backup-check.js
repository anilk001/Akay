/**
 * n8n Code node — "Backup Check"
 * Mode: Run Once for All Items
 *
 * Brief §3: confirm a "Verified" Backup Registry entry dated today before any
 * dispatch proceeds. Missing backup means stop and flag, never proceed.
 *
 * Input: Backup Registry records (Airtable search). Today is compared in the
 * business's own timezone rather than UTC — a dispatch at 00:30 Irish time in
 * summer is still "today" locally but yesterday in UTC, and a correct backup
 * would be rejected.
 */

const TIMEZONE = 'Europe/Dublin';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date()); // en-CA yields YYYY-MM-DD

const records = $input.all().map((i) => i.json).filter((r) => r && (r.fields || r.id));

const verifiedToday = records.filter((r) => {
  const f = r.fields || r;
  const status = f['Status'] && typeof f['Status'] === 'object' ? f['Status'].name : f['Status'];
  if (String(status).toLowerCase() !== 'verified') return false;

  const raw = f['Backup Date'];
  if (!raw) return false;
  return String(raw).slice(0, 10) === today;
});

if (verifiedToday.length === 0) {
  const seen = records.slice(0, 5).map((r) => {
    const f = r.fields || r;
    const s = f['Status'] && typeof f['Status'] === 'object' ? f['Status'].name : f['Status'];
    return `${f['Backup Date'] || 'no date'} (${s || 'no status'})`;
  });

  return [{
    json: {
      backupOk: false,
      haltReason:
        `No Verified backup dated ${today} (${TIMEZONE}). Dispatch stopped — take a backup first. ` +
        (seen.length ? `Most recent entries: ${seen.join(', ')}.` : 'Backup Registry is empty.'),
    },
  }];
}

const chosen = verifiedToday[0];
const cf = chosen.fields || chosen;

return [{
  json: {
    backupOk: true,
    backupDate: today,
    backupRecordId: chosen.id || null,
    backupTables: cf['Tables Covered'] || '',
    note: `Verified backup for ${today} found${cf['Storage Location'] ? ' (' + cf['Storage Location'] + ')' : ''}.`,
  },
}];
