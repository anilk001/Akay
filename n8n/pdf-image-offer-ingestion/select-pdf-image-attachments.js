/**
 * n8n Code node — "Select PDF/Image Attachments"
 * Mode: Run Once for All Items
 *
 * PDF/image branch of offer ingestion (Anil, 2026-08-04). Emits ONE item per
 * PDF or image attachment. Spreadsheets are the Excel workflow's job.
 *
 * SIZE DETECTION FIXED 2026-08-27. The 25 KB inline-logo floor had never
 * fired once. This workflow runs binaryMode "separate", so binary.data is the
 * literal string "filesystem-v2" and binary.fileSize is a HUMAN string like
 * "6.57 kB". Number("6.57 kB") is NaN and base64Bytes("filesystem-v2") is 0,
 * so size resolved to 0 and the guard required size > 0. Every signature logo
 * was therefore sent to Claude vision, returned zero offers, and tripped the
 * silent-loss guard — labelling the thread Needs-Review for no reason
 * (execution 25305: image001.png, 6,573 B, Pika Trading). Size now reads
 * binary.bytes first, then parses the fileSize string, then falls back to
 * base64 length.
 *
 * INLINE-NAME HEURISTIC: imageNNN.png (Outlook/Word embedded) and
 * UUID-named images are skipped when under 100 KB. The size bound matters —
 * a genuine price-list photo or screenshot is far larger, so a real offer
 * named this way is still kept.
 *
 * NO-OP SENTINEL: when a message has attachments but NONE survive selection,
 * one item with kind 'none' is emitted instead of nothing. Emitting nothing
 * would leave the chain with zero items, so no node downstream would run, the
 * thread would never be labelled, and the Gmail Trigger filter
 * (-label:Akay/PDF-Done) would re-pick the same mail EVERY MINUTE forever.
 * The sentinel is routed by "Anything to Parse?" straight to Mark PDF Done:
 * no Claude call, no Airtable write, no review flag. Body-only offers are the
 * Email Body Ingestion workflow's job and are unaffected.
 *
 * Also parses the (possibly forwarded) sender out of the email body: offers
 * arrive forwarded into ak@akay.ie / offers@akay.ie, so the envelope sender is
 * the forwarder and the real supplier sits in the "From:" line under the
 * forward marker.
 *
 * BODY TEXT NOW TRAVELS WITH THE ATTACHMENT (2026-09-17). Until now the body
 * was read here only to recover the forwarded sender and was then thrown away,
 * so the Claude vision nodes saw the attachment and nothing else. That is how
 * two Mainline Marketing offers were priced off the RRP on 2026-09-17: the
 * attachments were product photos / retail screenshots carrying only a consumer
 * price, while the trade price sat in the body the model never saw —
 *
 *     RRP £31.99 each              <- the only price in the image
 *     Take ALL DEAL @ £5.00 each   <- the real cost, body text only
 *
 * L'Oreal serum went in at £31.99 (sell £33.59 against a true £5.25) and the
 * Nivea gift set at £15.00 against a true £4.50. The prompt already said "never
 * a retail/RRP price"; with only the photo in hand the model had no other
 * number to give. `bodyText` closes that gap, and the prompt now states that
 * the email text outranks the attachment on price.
 */

const PDF_EXT = /\.pdf\s*$/i;
const IMAGE_OK_EXT = /\.(jpe?g|png|gif|webp)\s*$/i;
const IMAGE_BAD_EXT = /\.(tiff?|bmp|heic|svg|ico)\s*$/i;
const SPREADSHEET = /\.(xlsx|xlsm|xltx|xls|csv|tsv)\s*$/i;
const PDF_MIME = /application\/pdf/i;
const IMAGE_OK_MIME = /^image\/(jpe?g|png|gif|webp)/i;
const MIN_IMAGE_BYTES = 25 * 1024;
const INLINE_MAX_BYTES = 100 * 1024;
// Body text handed to the vision model alongside the attachment. 6 KB is far
// more than any real offer body and still small next to the 64k token budget.
const BODY_MAX_CHARS = 6000;
// Our own signature block + legal footer, which every forwarded offer carries
// twice over. Pure noise to the model, and it mentions prices ("Prices and
// availability quoted are subject to..."), so it is cut rather than sent.
const AKAY_SIGNATURE = /\[image: AKAY\][\s\S]*?written confirmation\./gi;
// Mailchimp/Outlook spacer runs: zero-width and soft-hyphen padding used to
// stretch preview text. Strips to nothing useful and eats the character budget.
const SPACER_CHARS = /[\u00AD\u034F\u200B-\u200D\u2060\uFEFF]/g;
const INLINE_NAME = [
  /^image\d{3,4}\.(png|jpe?g|gif|webp)$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i,
  /(logo|signature|banner|footer|icon|avatar)/i,
];

const out = [];
const skippedAll = [];

for (const item of $input.all()) {
  const g = item.json || {};
  const body = String(g.text || g.textAsHtml || g.html || g.snippet || '');
  const envelope = extractEmail(g.from ?? g.From ?? '');
  const forwarded = forwardedSender(body);
  const effective = (forwarded && forwarded.address) || envelope.address || '';
  const meta = {
    sourceMessageId: g.id || g.messageId || null,
    threadId: g.threadId || null,
    subject: g.subject || g.Subject || '',
    fromAddress: effective,
    envelopeFrom: envelope.address || '',
    senderName: (forwarded && forwarded.name) || envelope.name || '',
    senderDomain: (effective.split('@')[1] || '').toLowerCase(),
    externalSender: Boolean(effective) && /@/.test(effective) && !/@akay\.ie$/i.test(effective),
    // Goes to the Claude nodes as context. Anil's own note above a forward
    // ("Put 10% mark up on this") is deliberately kept, so the whole body is
    // passed rather than only the part below the forward marker.
    bodyText: trimBody(body),
  };

  const skipped = [];
  let kept = 0;

  for (const [binaryKey, binary] of Object.entries(item.binary || {})) {
    const name = String((binary && binary.fileName) || binaryKey).trim();
    const mime = String((binary && binary.mimeType) || '').trim();
    const size = binarySize(binary);

    if (SPREADSHEET.test(name)) { skipped.push(name + ' (spreadsheet — Excel workflow)'); continue; }

    let kind = null;
    if (PDF_EXT.test(name) || PDF_MIME.test(mime)) kind = 'document';
    else if (IMAGE_OK_EXT.test(name) || IMAGE_OK_MIME.test(mime)) kind = 'image';
    else if (IMAGE_BAD_EXT.test(name)) { skipped.push(name + ' (unsupported image format)'); continue; }
    else { skipped.push(name); continue; }

    if (kind === 'image') {
      if (size > 0 && size < MIN_IMAGE_BYTES) {
        skipped.push(name + ' (' + size + ' B — inline logo)');
        continue;
      }
      if (looksInline(name) && (size === 0 || size < INLINE_MAX_BYTES)) {
        skipped.push(name + ' (embedded/signature image' + (size ? ', ' + size + ' B' : '') + ')');
        continue;
      }
    }

    out.push({
      json: { ...meta, binaryKey, fileName: name, mimeType: mime, kind, noParse: false },
      binary: { [binaryKey]: binary },
    });
    kept++;
  }

  if (kept === 0 && skipped.length) {
    out.push({ json: { ...meta, binaryKey: null, fileName: '', mimeType: '', kind: 'none', noParse: true, skippedNames: skipped.join(', ') } });
  }
  if (skipped.length) skippedAll.push(...skipped);
}

if (skippedAll.length) console.log('Select PDF/Image: skipped: ' + skippedAll.join(', '));
return out;

function trimBody(raw) {
  let t = String(raw || '')
    .replace(/\r/g, '')
    .replace(AKAY_SIGNATURE, '\n')
    .replace(SPACER_CHARS, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length > BODY_MAX_CHARS) t = t.slice(0, BODY_MAX_CHARS).trim() + '\n[...body truncated]';
  return t;
}

function binarySize(b) {
  if (!b) return 0;
  const n = Number(b.bytes);
  if (Number.isFinite(n) && n > 0) return n;
  const p = parseFileSize(b.fileSize);
  if (p > 0) return p;
  return base64Bytes(b.data);
}

function parseFileSize(v) {
  const m = String(v ?? '').trim().match(/^([\d.,]+)\s*(B|kB|KB|MB|GB)$/i);
  if (!m) return 0;
  const n = Number(String(m[1]).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  const u = m[2].toLowerCase();
  const mult = u === 'b' ? 1 : u === 'kb' ? 1024 : u === 'mb' ? 1048576 : 1073741824;
  return Math.round(n * mult);
}

function looksInline(n) { return INLINE_NAME.some((r) => r.test(n)); }

function base64Bytes(b64) {
  const s = String(b64 || '');
  if (!s || s === 'filesystem-v2') return 0;
  return Math.floor(s.length * 3 / 4);
}

function extractEmail(raw) {
  if (raw && typeof raw === 'object') {
    const v = Array.isArray(raw.value) ? raw.value[0] : null;
    if (v && v.address) return { address: String(v.address).trim().toLowerCase(), name: String(v.name || '').trim() };
    return parseAddr(String(raw.text || raw.html || ''));
  }
  return parseAddr(String(raw));
}

function parseAddr(s) {
  const m = String(s).match(/<([^>]+)>/);
  const address = (m ? m[1] : String(s)).trim().toLowerCase();
  let name = '';
  const nm = String(s).match(/^\s*"?([^"<]+?)"?\s*</);
  if (nm) name = nm[1].trim();
  return { address, name };
}

function forwardedSender(text) {
  const src = String(text);
  const fwd = src.match(/-{2,}\s*(?:Forwarded|Original)\s*message\s*-{2,}/i)
           || src.match(/Begin forwarded message:/i);
  if (!fwd || fwd.index === undefined) return null;
  const header = src.slice(fwd.index, fwd.index + 800);
  const m = header.match(/\n\s*\*?\s*From:\s*\*?\s*(.*?)([^\s<>"]+@[^\s<>"]+\.[a-z]{2,})/i);
  if (!m) return null;
  const address = m[2].toLowerCase().replace(/[.,;>]+$/, '');
  if (/@akay\.ie$/i.test(address)) return null;
  const name = String(m[1] || '').replace(/[<"]/g, '').replace(/[-–\s]+$/, '').trim();
  return { address, name };
}

