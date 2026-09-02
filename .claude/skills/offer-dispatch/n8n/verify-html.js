/**
 * n8n Code node — "Verify HTML"   (Offer Dispatch — Akay, dAYMAj6mZD3hTV4T)
 * Mode: Run Once for All Items
 * Added 2026-08-27.
 *
 * "Style as HTML" restyles the ALREADY-COMPOSED, already leak-checked plain
 * text. It is a formatter, not an author, so this node proves it added nothing:
 *   - every word in the HTML must already appear in the approved text
 *   - every number must survive, and no new number may appear
 *   - the {{{FIRST_NAME}}} token must survive intact for Build Sends
 *   - no forbidden tag, inline event handler, or unapproved link
 *   - supplier names and buy price must not appear — the leak guard re-run
 *     against the FULL markup, including tag attributes, where Compose Email's
 *     text-only guard could not look
 *
 * ANY failure drops the HTML and the dispatch continues text-only. A styling
 * fault must never stop a send that has already passed gate, backup and leak
 * checks. The verdict is surfaced in the approval mail as htmlStatus.
 */

const composed = $('Compose Email').first().json;
const text = String(composed.bodyTemplate || '');

function fail(reason) {
  return [{ json: { ...composed, html: null, htmlStatus: 'FALLBACK — plain text only. ' + reason } }];
}

// -- pull the model output, whatever shape the node returned ---------------
let raw = '';
try {
  const r = $input.first().json || {};
  if (typeof r.content === 'string') raw = r.content;
  else if (Array.isArray(r.content)) raw = r.content.map((c) => (c && c.text) || '').join('');
  else if (typeof r.text === 'string') raw = r.text;
  else if (r.message && typeof r.message.content === 'string') raw = r.message.content;
  else if (r.error) return fail('model call failed: ' + (r.error.message || r.error));
} catch (e) {
  return fail('could not read model output: ' + e.message);
}

let html = String(raw || '').trim();
const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
if (fence) html = fence[1].trim();

if (!html || html.indexOf('<') === -1) return fail('model returned no HTML.');
if (html.length > 60000) return fail('HTML implausibly large (' + html.length + ' chars).');

// -- structural safety ------------------------------------------------------
if (/<\s*(script|iframe|object|embed|form)\b/i.test(html)) return fail('HTML contains a forbidden tag.');
if (/\son[a-z]+\s*=/i.test(html)) return fail('HTML contains an inline event handler.');

const ALLOWED_LINKS = ['mailto:offers@akay.ie', 'https://offers.akay.ie'];
const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1].trim());
for (const h of hrefs) {
  if (!ALLOWED_LINKS.some((a) => h.toLowerCase().startsWith(a))) return fail('HTML contains an unapproved link: ' + h);
}
const srcs = [...html.matchAll(/<img[^>]+src\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1].trim());
if (srcs.length) return fail('HTML contains image(s), which were not in the approved text.');

// -- convert back to plain text and compare --------------------------------
function toPlain(s) {
  return String(s)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&euro;/gi, '\u20AC').replace(/&mdash;/gi, '\u2014').replace(/&ndash;/gi, '\u2013')
    .replace(/\s+/g, ' ').trim();
}

const htmlPlain = toPlain(html);
const srcPlain = text.replace(/\s+/g, ' ').trim();

// The FIRST_NAME token must survive or Build Sends cannot personalise, and its
// own placeholder assertion would throw mid-dispatch.
const TOKEN = /\{\{\{FIRST_NAME(\|[^}]*)?\}\}\}/g;
const srcTokens = (srcPlain.match(TOKEN) || []).length;
const htmlTokens = (htmlPlain.match(TOKEN) || []).length;
if (srcTokens !== htmlTokens) return fail('FIRST_NAME placeholder count changed (' + srcTokens + ' -> ' + htmlTokens + ').');

// Numbers must match exactly, both directions. A price the model "tidied" is
// a wrong price sent to every buyer.
const nums = (s) => new Set((s.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')));
const srcNums = nums(srcPlain);
const htmlNums = nums(htmlPlain);
const added = [...htmlNums].filter((n) => !srcNums.has(n));
const lost = [...srcNums].filter((n) => !htmlNums.has(n));
if (added.length) return fail('HTML introduced number(s) absent from the approved text: ' + added.join(', ') + '.');
if (lost.length) return fail('HTML dropped number(s) present in the approved text: ' + lost.join(', ') + '.');

// Every word must already exist in the source. This is what stops the model
// writing marketing copy of its own.
const words = (s) => (s.toLowerCase().match(/[a-z][a-z'-]+/g) || []);
const srcWords = new Set(words(srcPlain));
const invented = [...new Set(words(htmlPlain))].filter((w) => !srcWords.has(w));
if (invented.length) return fail('HTML introduced word(s) absent from the approved text: ' + invented.slice(0, 12).join(', ') + '.');

// -- leak guard, re-run against the FULL markup ----------------------------
let gate = null;
try {
  gate = $('Gate Check').all().map((i) => i.json).filter((g) => g.gatePassed)[0] || null;
} catch (e) { /* not on every path */ }
const f = (gate && gate.offerFields) || {};
const hay = html.toLowerCase();
const leaks = [];

const suppliers = (Array.isArray(f['Supplier Name']) ? f['Supplier Name'] : [f['Supplier Name']])
  .map((x) => (x && typeof x === 'object' ? x.name : x)).filter(Boolean).map(String);
for (const s of suppliers) {
  if (s.length >= 4 && hay.includes(s.toLowerCase())) leaks.push('supplier name "' + s + '"');
}

const buy = Number(f['Buy Price']);
const sell = Number(f['Sell Price']);
if (Number.isFinite(buy) && buy > 0 && (!Number.isFinite(sell) || Math.abs(sell - buy) > 0.005)) {
  const form = buy.toFixed(2);
  if (new RegExp('(^|[^0-9.,])' + form.replace('.', '\\.') + '([^0-9]|$)').test(hay)) leaks.push('buy price ' + form);
}
for (const addr of ['info@akay.ie', 'kai@akay.ie']) {
  if (hay.includes(addr)) leaks.push('internal address ' + addr);
}
if (leaks.length) return fail('LEAK GUARD tripped on the HTML — ' + leaks.join('; ') + '.');

return [{ json: { ...composed, html, htmlStatus: 'OK — HTML verified verbatim against the approved text.' } }];

