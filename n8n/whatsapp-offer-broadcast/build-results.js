/**
 * Aggregates per-send results across every loop iteration (each run of the
 * Send WhatsApp node holds exactly one item, at its own runIndex), matches
 * them back to the Expand Sends order, and prepares:
 *  - Offers.WA Broadcast Log updates (only segments with >=1 delivered send,
 *    never in PILOT mode; entries older than 120 days pruned on write)
 *  - the run summary email
 */
const plans = $('Plan Broadcast').all().map(i => i.json);
const sends = $('Expand Sends').all().map(i => i.json);
const results = [];
for (let r = 0; r < sends.length + 5; r++) {
  let its;
  try { its = $('Send WhatsApp').all(0, r); } catch (e) { break; }
  if (!its || !its.length) break;
  for (const it of its) results.push(it.json);
}
const okAt = i => {
  const j = results[i];
  if (!j) return false;
  if (j.error) return false;
  return !!(j.sent === true || j.message || j.id);
};
const bySeg = {};
for (let i = 0; i < sends.length; i++) {
  const s = sends[i];
  if (!bySeg[s.segment]) bySeg[s.segment] = { ok: 0, fail: 0, failSamples: [] };
  if (i < results.length && okAt(i)) bySeg[s.segment].ok++;
  else {
    bySeg[s.segment].fail++;
    const j = results[i] || {};
    if (bySeg[s.segment].failSamples.length < 3) {
      bySeg[s.segment].failSamples.push(s.name + ' (' + s.to + '): ' + String((j.error && (j.error.message || j.error)) || 'no response').slice(0, 140));
    }
  }
}
const nowMs = Date.now();
const updatesById = {};
const lines = [];
let totalOk = 0, totalFail = 0;
const pilot = plans.length && plans[0].pilot;
for (const p of plans) {
  const st = bySeg[p.segment] || { ok: 0, fail: 0, failSamples: [] };
  totalOk += st.ok; totalFail += st.fail;
  lines.push('\u2022 ' + p.segment + ' \u2192 "' + p.offerHeadline + '"' + (p.queuedPick ? ' [manually queued]' : '') + ' \u00b7 planned ' + p.plannedCount + ', sent ' + st.ok + ', failed ' + st.fail + (pilot ? ' (PILOT: delivered to Anil only)' : ''));
  for (const fs of st.failSamples) lines.push('    failed: ' + fs);
  if (!pilot && st.ok > 0) {
    if (!updatesById[p.offerId]) {
      const kept = String(p.existingLog || '').split('\n').map(s => s.trim()).filter(Boolean).filter(l => {
        const d = Date.parse((l.split('|')[1] || ''));
        return isNaN(d) ? true : (nowMs - d) / 86400000 <= 120;
      });
      updatesById[p.offerId] = kept;
    }
    updatesById[p.offerId].push(p.logLine);
  }
}
const updates = [];
for (const id of Object.keys(updatesById)) updates.push({ id, log: updatesById[id].join('\n') });
const subject = (pilot ? '[PILOT] ' : '') + 'WhatsApp offer broadcast: ' + totalOk + ' sent' + (totalFail ? ', ' + totalFail + ' FAILED' : '') + ' across ' + plans.length + ' segment(s)';
const text = 'WhatsApp Offer Broadcast \u2014 run summary (' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC)\n'
  + (pilot ? '\nPILOT MODE IS ON: every card below was sent only to your own WhatsApp for review.\nFlip PILOT to false in the "Plan Broadcast" node to go live to the real segments.\n' : '')
  + '\n' + lines.join('\n')
  + '\n\nTotals: ' + totalOk + ' delivered, ' + totalFail + ' failed.'
  + (updates.length ? '\nOffer broadcast log updated on ' + updates.length + ' offer(s).' : '\nNo Airtable log written' + (pilot ? ' (pilot).' : '.'))
  + '\n\nSegments with nothing to send are simply absent above (no fresh eligible offer in cooldown window, or no reachable contacts).';
return [{ json: { subject, text, updates, totalOk, totalFail } }];
