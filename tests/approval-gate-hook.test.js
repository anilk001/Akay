/**
 * Tests for .claude/hooks/protect-airtable-fields.mjs.
 *
 * The hook is the only control standing between an assistant and the two
 * approval gates, so the cases below are written as the ways past it that have
 * actually been tried or are plausible: a different MCP server, a different
 * argument shape, a batch where only the third record carries the tick, and
 * the string "true" instead of a boolean.
 *
 * The hook is EXECUTED as a subprocess, exactly as Claude Code runs it.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'protect-airtable-fields.mjs');

let pass = 0;
let fail = 0;

function run(payload) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { code: r.status, stderr: r.stderr || '' };
}

function blocks(label, payload) {
  const { code, stderr } = run(payload);
  const ok = code === 2 && /HUMAN-ONLY/.test(stderr);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | blocks: ${label}`);
  if (!ok) console.log(`       exit ${code}, stderr: ${stderr.slice(0, 200)}`);
}

function allows(label, payload) {
  const { code, stderr } = run(payload);
  const ok = code === 0;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | allows: ${label}`);
  if (!ok) console.log(`       exit ${code}, stderr: ${stderr.slice(0, 200)}`);
}

const OFFERS = { baseId: 'appaDSdZkAE9PGkjT', tableId: 'tbljBgWrnIMZzkSAr' };

console.log('\n--- The tick is refused however it is written ---');

blocks('create_record with a boolean tick', {
  tool_name: 'mcp__airtable__create_record',
  tool_input: { ...OFFERS, fields: { 'Product Name': 'Jameson 70cl', 'Listing Approved': true } },
});

blocks('update_records, tick on the second record only', {
  tool_name: 'mcp__airtable__update_records',
  tool_input: {
    ...OFFERS,
    records: [
      { id: 'rec1', fields: { 'Margin %': 0.05 } },
      { id: 'rec2', fields: { 'Listing Approved': true } },
    ],
  },
});

blocks('the other Airtable MCP server (capital A, different tool name)', {
  tool_name: 'mcp__Airtable__update_records_for_table',
  tool_input: { ...OFFERS, records: [{ id: 'rec1', fields: { 'Listing Approved': 1 } }] },
});

blocks('the string "true" rather than a boolean', {
  tool_name: 'mcp__airtable__create_record',
  tool_input: { ...OFFERS, fields: { 'Listing Approved': 'true' } },
});

blocks('an argument shape the hook has never seen', {
  tool_name: 'mcp__airtable__create_records_for_table',
  tool_input: { ...OFFERS, recordsToCreate: [{ cells: { 'Listing Approved': true } }] },
});

blocks('lower-cased / differently spaced field name', {
  tool_name: 'mcp__airtable__create_record',
  tool_input: { ...OFFERS, fields: { ' listing approved ': true } },
});

blocks('Gate 2: Send Approval Status set to Approved', {
  tool_name: 'mcp__airtable__update_records',
  tool_input: { ...OFFERS, records: [{ id: 'rec1', fields: { 'Send Approval Status': 'Approved' } }] },
});

blocks('Send Approval Status as an Airtable select object', {
  tool_name: 'mcp__airtable__update_records',
  tool_input: { ...OFFERS, records: [{ id: 'rec1', fields: { 'Send Approval Status': { name: 'Approved' } } }] },
});

console.log('\n--- What must still get through ---');

allows('every other field on the offer', {
  tool_name: 'mcp__airtable__update_records',
  tool_input: {
    ...OFFERS,
    records: [{ id: 'rec1', fields: { 'Margin %': 0.08, 'Auto Expiry Days': 30, Status: 'Live', 'Offer Approval Status': 'Approved' } }],
  },
});

allows('UNticking — how a mistake gets undone', {
  tool_name: 'mcp__airtable__update_records',
  tool_input: { ...OFFERS, records: [{ id: 'rec1', fields: { 'Listing Approved': false } }] },
});

allows('Send Approval Status moved to Rejected', {
  tool_name: 'mcp__airtable__update_records',
  tool_input: { ...OFFERS, records: [{ id: 'rec1', fields: { 'Send Approval Status': 'Rejected' } }] },
});

allows('reading records that happen to carry the field', {
  tool_name: 'mcp__airtable__list_records',
  tool_input: { ...OFFERS, filterByFormula: '{Listing Approved}' },
});

allows('a non-Airtable tool', {
  tool_name: 'Edit',
  tool_input: { file_path: '/home/user/Akay/src/data/airtable.mjs', new_string: "'Listing Approved': true" },
});

allows('malformed hook input is never a crash', { not: 'a tool call' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
