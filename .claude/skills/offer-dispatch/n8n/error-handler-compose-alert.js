/**
 * Turns an n8n Error Trigger payload into an alert that says what broke, where,
 * and what is now NOT happening as a result.
 *
 * WHY THIS EXISTS:
 * On 2026-07-30 the published Offer Dispatch workflow began carrying an expired
 * Airtable credential. Every 9am run failed on a 401 and stopped. Nothing
 * reported it, so for four days the business believed offers were going out
 * while nothing was sent, and it was only found by going looking. The failure was
 * never the problem - the SILENCE was.
 *
 * The consequence line matters more than the stack trace. "Airtable node failed"
 * is not actionable at 9am; "no offers went out today" is.
 *
 * NOTE: n8n fires error workflows for PRODUCTION executions only. Manual test
 * runs fail silently by design, which is why a workflow can look healthy when
 * run by hand and still be broken on its schedule - exactly what happened here.
 */

// Where alerts are sent. This declaration was missing, so every run of this
// handler threw "ALERT_TO is not defined" and no alert was ever delivered —
// the exact silent-failure mode this workflow exists to prevent. Restored
// 2026-08-05. (The Email Alert node also hardcodes ak@akay.ie as a backstop.)
const ALERT_TO = 'ak@akay.ie';

const CONSEQUENCE = {
  'Offer Dispatch — Akay': 'NO OFFERS WERE EMAILED. Clients received nothing on this run. The offer stays Live and in Ready to Send, so it can be retried once the cause is fixed.',
  'Daily Backup — Akay': 'NO VERIFIED BACKUP EXISTS FOR TODAY. Offer Dispatch checks for one before sending, so today\'s 9am dispatch will refuse to run until this succeeds.',
  'Backup — Export One Table': 'One table failed to export, so today\'s backup is incomplete and will not be marked Verified.',
  'Excel Offer Ingestion — Akay': 'Supplier price lists in Process_akay were NOT ingested. New offers are missing and the emails stay unlabelled, so a re-run should pick them up.',
  'Contact Sync — Google + WhatsApp → Airtable': 'Contacts are stale. Note this workflow has no request timeout on its Whapi pagination - if it hung rather than errored, it can hold the execution queue and delay the 6am backup and 9am dispatch.',
  'Link Offers To Products': 'Offers were not linked to Products this hour, so new offers stay invisible to price comparison. Self-corrects on the next hourly run.',
  'Supersede Supplier Price Lists': 'Superseded offers were NOT expired, so outdated prices may still be publicly listed and sendable.',
};

// Offer Dispatch has three very different failure shapes, and the audit of
// 2026-09-02 found this alert calling all of them "NO OFFERS WERE EMAILED":
// on 2026-08-31 (execution 28570) that line went out AFTER all 507 Heinz
// emails had been delivered, because only the Sent Log write had failed.
// Read the failing node and the message before deciding what to tell Anil.
const POST_SEND_NODES = /^(Write Sent Log|Dispatch Complete\?|Prepare Broadcast Marks|Mark Broadcasted|Clear Queue Flag|Write Clear Flag)$/;

function consequenceFor(wfName, node, message) {
  if (wfName === 'Offer Dispatch — Akay') {
    if (/some emails WERE sent/.test(message) || /Dispatch INCOMPLETE — [1-9]\d* sent/.test(message)) {
      return 'PARTIAL SEND. Some clients received the offer and some did not - the error line says how many. The offer stays Live with Queued for Dispatch cleared; Offers Sent Log shows who got it (Dispatch Status = Sent) and who failed. Fix the cause and re-queue: the Resend idempotency key stops anyone who already received it from getting it twice within 24 hours.';
    }
    if (POST_SEND_NODES.test(node)) {
      return 'THE EMAILS WERE ALREADY SENT. Only the bookkeeping after the send failed at "' + node + '". Check by hand that the offer is marked Broadcasted and Queued for Dispatch is unticked, and that Offers Sent Log has one row per recipient. Do NOT re-queue - the clients have the offer.';
    }
    if (/HALTED and sent nothing/.test(message)) {
      return 'NO OFFERS WERE EMAILED - the run stopped at a gate before sending. The reason is in the error line below. Queued for Dispatch has been cleared, so re-queue once the cause is fixed.';
    }
    return CONSEQUENCE[wfName];
  }
  return CONSEQUENCE[wfName] ||
    'Check what this workflow is responsible for - its scheduled work did not complete.';
}

const out = [];

for (const item of $input.all()) {
  const j = item.json || {};
  const wf = j.workflow || {};
  const ex = j.execution || {};
  const err = ex.error || {};

  const wfName = wf.name || '(unknown workflow)';
  const node = (err.node && err.node.name) || ex.lastNodeExecuted || '(unknown node)';
  const message = err.message || 'No error message returned.';
  const when = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const consequence = consequenceFor(wfName, node, message);

  // Credential and auth failures are called out separately because they are
  // silent by nature, survive every retry, and were the actual cause of the
  // four-day dispatch outage. A retry will not fix one.
  const isAuth = /401|403|unauthor|forbidden|credential|token|api key|expired/i.test(message);

  const lines = [
    wfName + ' FAILED',
    '',
    'What it means: ' + consequence,
    '',
    'Failed at node: ' + node,
    'Error: ' + message,
    'When: ' + when,
    'Execution: ' + (ex.id || 'n/a'),
  ];

  if (ex.url) lines.push('Open: ' + ex.url);

  if (isAuth) {
    lines.push(
      '',
      'THIS LOOKS LIKE A CREDENTIAL OR AUTH FAILURE.',
      'Re-running will not help. Check the credential on the failing node is not expired or revoked,',
      'and confirm the PUBLISHED version uses it - a fix saved only to the draft leaves production',
      'running the old credential, which is how the 30 July dispatch outage went unnoticed for four days.'
    );
  }

  lines.push(
    '',
    '---',
    'Automated alert from the Akay n8n error handler. Fires on production runs only;',
    'manual test executions do not trigger it.'
  );

  out.push({
    json: {
      to: ALERT_TO,
      subject: (isAuth ? '[AUTH] ' : '[FAILED] ') + wfName + ' - ' + when,
      body: lines.join('\n'),
      workflowName: wfName,
      isAuthFailure: isAuth,
    },
  });
}

return out;
