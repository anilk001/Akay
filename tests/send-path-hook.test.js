/**
 * Tests for .claude/hooks/protect-send-path.mjs — client-facing mail goes
 * through Resend, never Gmail. The hook is EXECUTED as a subprocess.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'hooks', 'protect-send-path.mjs');
let pass = 0, fail = 0;
const run = (p) => { const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(p), encoding: 'utf8' }); return { code: r.status, stderr: r.stderr || '' }; };
function blocks(label, payload) { const { code, stderr } = run(payload); const ok = code === 2 && /Resend/.test(stderr); ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} | blocks: ${label}`); if (!ok) console.log(`       exit ${code}: ${stderr.slice(0, 160)}`); }
function allows(label, payload) { const { code, stderr } = run(payload); const ok = code === 0; ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} | allows: ${label}`); if (!ok) console.log(`       exit ${code}: ${stderr.slice(0, 160)}`); }

console.log('\n--- Offers to clients cannot leave through Gmail ---');
blocks('send_message to one client', { tool_name: 'mcp__Gmail__send_message', tool_input: { to: ['buyer@client-co.com'], subject: 'New Offer', body: 'Jameson 13.50' } });
blocks('send_message, "to" as a string', { tool_name: 'mcp__Gmail__send_message', tool_input: { to: 'buyer@client-co.com', subject: 'x', body: 'y' } });
blocks('one internal plus one external recipient', { tool_name: 'mcp__Gmail__send_message', tool_input: { to: ['ak@akay.ie'], cc: ['buyer@client-co.com'], body: 'y' } });
blocks('bcc list of clients', { tool_name: 'mcp__Gmail__send_message', tool_input: { to: 'offers@akay.ie', bcc: ['a@x.com', 'b@y.com'], body: 'y' } });
blocks('forward to a client', { tool_name: 'mcp__Gmail__forward', tool_input: { message_id: 'm1', to: ['buyer@client-co.com'] } });
blocks('lower-case tool prefix', { tool_name: 'mcp__gmail__send_message', tool_input: { to: ['buyer@client-co.com'], body: 'y' } });
blocks('recipients nested under an unexpected key', { tool_name: 'mcp__Gmail__send_message', tool_input: { message: { recipients: [{ email: 'buyer@client-co.com' }] } } });

console.log('\n--- What must still get through ---');
allows('internal mail to ak@akay.ie', { tool_name: 'mcp__Gmail__send_message', tool_input: { to: ['ak@akay.ie'], subject: 'note', body: 'y' } });
allows('a client address in the BODY, not the recipients', { tool_name: 'mcp__Gmail__send_message', tool_input: { to: ['ak@akay.ie'], body: 'buyer@client-co.com asked about Jameson' } });
allows('reply on a thread — correspondence, not a send', { tool_name: 'mcp__Gmail__reply', tool_input: { thread_id: 't1', body: 'Thanks, will revert.' } });
allows('a draft sends nothing', { tool_name: 'mcp__Gmail__create_draft', tool_input: { to: ['buyer@client-co.com'], body: 'y' } });
allows('reading and labelling', { tool_name: 'mcp__Gmail__label_thread', tool_input: { thread_id: 't1', label: 'Akay/Email-Done' } });
allows('Resend itself', { tool_name: 'mcp__Resend__send-email', tool_input: { to: ['buyer@client-co.com'], from: 'offers@akay.ie' } });
allows('malformed input is never a crash', { nonsense: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
