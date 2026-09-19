const c = $('Compose Email').first().json;
const v = $('Verify HTML').first().json;
const rec = $('Build Recipients').first().json;

const FIRST_NAME_TOKEN = /\{\{\{FIRST_NAME(\|[^}]*)?\}\}\}/g;
const body = String(c.bodyTemplate).replace(FIRST_NAME_TOKEN, 'there');
const resumeUrl = String($execution.resumeUrl || '').trim();
if (!resumeUrl) throw new Error('No $execution.resumeUrl available — cannot build approval links');
// n8n resume URLs already carry ?signature=... so the flag must be appended with &
const sep = resumeUrl.includes('?') ? '&' : '?';
const approveUrl = resumeUrl + sep + 'approved=true';
const declineUrl = resumeUrl + sep + 'approved=false';

const targeting = (rec.targetTags && rec.targetTags.length ? 'Tags: ' + rec.targetTags.join(', ') : 'Tags: ALL (no restriction)')
  + ' | ' + (rec.targetCountries && rec.targetCountries.length ? 'Countries: ' + rec.targetCountries.join(', ') : 'Countries: ALL (no restriction)')
  + (rec.excludedCountries && rec.excludedCountries.length ? ' | Excluding: ' + rec.excludedCountries.join(', ') : '');
const deferred = (rec.deferredGroups && rec.deferredGroups.length) ? '\nSTILL QUEUED, NOT IN THIS RUN: ' + rec.deferredGroups.join(', ') : '';
// Offers that failed Gate Check. The run no longer dies on them (see
// gate-check.js), so they have to be visible HERE — before you approve —
// rather than only in a red execution nobody reads.
const skipped = (rec.skippedOffers && rec.skippedOffers.length)
  ? '\nSKIPPED BY THE GATE (not in this email, still queued): '
    + rec.skippedOffers.map((s) => '"' + s.offerName + '" — ' + (s.failures || []).join('; ')).join('  |  ')
  : '';
const trimmed = c.noteLinesDropped ? '\nPublic Note lines dropped as duplicates: ' + c.noteLinesDropped : '';

const summary = 'Read the email below before approving - this is exactly what ' + rec.recipientCount + ' client(s) will receive.\n\n'
  + 'GROUP: ' + (rec.groupLabel || '(single offer)') + '\n'
  + 'TARGETING: ' + targeting + '\n'
  + 'RECIPIENTS: ' + rec.recipientCount + ' (' + rec.excludedCount + ' excluded, ' + rec.suppressedNoMailing + ' via No Mailing)' + deferred + skipped + trimmed + '\n'
  + 'SENDING IN: ' + Math.ceil((rec.recipientCount || 0) / 100) + ' Resend batch(es) of up to 100\n'
  + 'HTML STYLING: ' + (v.htmlStatus || 'not run');

const text = summary
  + '\n\nAPPROVE & SEND: ' + approveUrl
  + '\nDECLINE: ' + declineUrl
  + '\n\n======== SUBJECT ========\n' + c.subject
  + '\n\n===== PLAIN TEXT VERSION =====\n' + body
  + '\n==============================\n\nApprove to send this to all ' + rec.recipientCount + ' eligible clients now, or Decline to hold it. Links expire after 3 days.';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let clientHtml = v.html ? String(v.html).replace(FIRST_NAME_TOKEN, 'there') : '';
const m = clientHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (m) clientHtml = m[1];

const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1A202C;max-width:720px;">'
  + '<pre style="white-space:pre-wrap;font-family:inherit;background:#F7FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:12px;">' + esc(summary) + '</pre>'
  + '<p style="margin:16px 0;">'
  + '<a href="' + esc(approveUrl) + '" style="display:inline-block;background:#2563EB;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;margin-right:12px;">Approve &amp; Send to ' + rec.recipientCount + ' clients</a>'
  + '<a href="' + esc(declineUrl) + '" style="display:inline-block;background:#E2E8F0;color:#1A202C;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">Decline</a>'
  + '</p>'
  + '<p style="color:#4A5568;">Subject clients will see: <strong>' + esc(c.subject) + '</strong></p>'
  + '<p style="color:#4A5568;margin:16px 0 4px 0;">===== WHAT CLIENTS SEE =====</p>'
  + (clientHtml || '<pre style="white-space:pre-wrap;font-family:inherit;">' + esc(body) + '</pre>')
  + '<p style="color:#4A5568;margin:16px 0 4px 0;">===== END =====</p>'
  + '<p style="color:#718096;font-size:12px;">Links expire after 3 days; the dispatch is then held automatically. Sent via Resend by the Offer Dispatch workflow.</p>'
  + '</div>';

return [{ json: {
  payload: {
    from: 'Akay Irl Ltd <offers@akay.ie>',
    to: ['ak@akay.ie'],
    subject: 'Approval needed: ' + c.subject,
    text,
    html,
  },
  idempotencyKey: 'approval-' + $execution.id,
  approveUrl,
  declineUrl,
  recipientCount: rec.recipientCount,
} }];
