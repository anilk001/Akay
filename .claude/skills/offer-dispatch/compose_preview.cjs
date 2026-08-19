#!/usr/bin/env node
/**
 * Preview the exact email the "Offer Dispatch — Akay" workflow would send.
 *
 * Run:  node compose_preview.cjs dispatch.json
 *
 * dispatch.json is a JSON array of offer objects whose keys are Airtable FIELD
 * NAMES, exactly as the workflow's Airtable node returns them — see
 * fixtures/zentner-spirits-2026-08-19.json for a worked example. Every offer in
 * the file is treated as one dispatch group, which is what a shared Bundle ID
 * means downstream.
 *
 * The compose() run here is read straight out of n8n/compose-email.js, the file
 * that gets pasted into the node, so this preview cannot drift from what sends.
 * Neither the approver nor the client should be the first to read an offer mail.
 *
 * A halt is printed as HALT with the reason the workflow would report; that is a
 * refusal to send, not a preview failure, and the exit code is 1 so a script can
 * gate on it.
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('usage: node compose_preview.cjs <dispatch.json>');
  process.exit(2);
}

const src = fs.readFileSync(path.join(__dirname, 'n8n/compose-email.js'), 'utf8').split('// -- n8n glue')[0];
const compose = new Function(`${src}\nreturn compose;`)();

const offers = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(offers) || !offers.length) {
  console.error('dispatch file must be a non-empty JSON array of offer objects');
  process.exit(2);
}

// Mirror the shape "Gate Check" hands to Compose Email. Preview assumes the gate
// passed; the workflow re-checks it for real and will halt if it did not.
const gateItems = offers.map((fields, i) => ({
  gatePassed: true,
  offerId: fields.id || fields.recordId || `preview${i + 1}`,
  offerName: fields['Offer Name'] || `(offer ${i + 1})`,
  bondStatus: fields['Bond/Customs Status'] || '',
  offerFields: fields,
}));

const result = compose(gateItems, gateItems.map((g) => g.offerId));

if (!result.composed) {
  console.log(`HALT: ${result.haltReason}`);
  process.exit(1);
}

const rule = '='.repeat(78);
console.log(rule);
console.log(`SUBJECT: ${result.subject}`);
console.log(rule);
console.log('');
console.log(result.bodyTemplate);
console.log('');
console.log(rule);
console.log(`lines: ${result.bundleOfferIds.length}   bundle: ${result.isBundle}   note lines dropped: ${result.noteLinesDropped}`);
console.log(`List-Unsubscribe: ${result.listUnsubscribe}`);
const terms = result.bodyTemplate.match(/^Terms: .*$/gm) || [];
console.log(`Terms lines (${terms.length}): ${terms.map((t) => t.replace(/^Terms: /, '')).join(' | ') || '(none)'}`);
console.log(rule);
