/**
 * THIS FILE BELONGS IN `trade-desk-api`, NOT IN THIS REPO.
 *
 * It lives here because this is where the intake contract is written down and
 * tested (`../README.md`, `../../tests/instant-quote-intake.test.js`). Copy it
 * into the API, wire the one call described below, and keep the two in step —
 * the test in this repo runs a real Trade Desk response through it and then
 * through the n8n node, so a change on either side that breaks the contract
 * fails here rather than in production.
 *
 * WHAT IT DOES.
 * After `/api/upload-excel` has priced a buyer's list, it POSTs the upload, the
 * priced copy and the line detail to the n8n intake webhook. That is what turns
 * an Instant Quote from an anonymous download into an Enquiry record, and —
 * the part that pays for itself — turns every line we could not price into a
 * `Wanted` row and, on Monday, a buying brief.
 *
 * WHERE TO CALL IT.
 * In the upload handler, AFTER the response has gone to the buyer:
 *
 *     const result = await priceTheList(file);
 *     res.json(result);                       // the buyer never waits on us
 *     postToIntake({
 *       result,
 *       upload: { name: file.originalname, type: file.mimetype, buffer: file.buffer },
 *       quoted: { name: pricedName, type: pricedType, buffer: pricedBuffer },
 *       contact: req.body.contact || {},      // whatever the SPA collected
 *     });
 *
 * It never throws and never rejects: a logging call must not be able to break
 * a download the buyer already paid attention for. Failures are logged and
 * dropped. Fire it after the response, not before.
 *
 * WHAT IT DELIBERATELY DOES NOT SEND.
 * `marginPct`, `lineSaving`, `wholesalePriceBase` and `alternatives` stay in
 * the API. The buyer's own price and our selling price are both things the
 * buyer already sees, so logging them tells nobody anything new. A field named
 * `marginPct` is a different matter: it is rendered under "Line saving" in the
 * SPA and so is probably the buyer's saving percentage rather than ours, but
 * "probably" is not a good enough reason to copy a margin-shaped number into
 * Airtable and from there into a weekly email. Confirm what it means before
 * adding it, if it is ever wanted.
 *
 * ENV.
 *   AKAY_INTAKE_URL      defaults to the production webhook below
 *   AKAY_INTAKE_SECRET   optional; sent as X-Akay-Intake-Secret. The webhook is
 *                        public and creates Airtable records, so setting this
 *                        (and checking it in the n8n workflow) is worth doing
 *                        before the launch email goes out.
 *   AKAY_INTAKE_TIMEOUT_MS  defaults to 10000
 */

const INTAKE_URL =
  process.env.AKAY_INTAKE_URL || 'https://akay-team.app.n8n.cloud/webhook/instant-quote';
const TIMEOUT_MS = Number(process.env.AKAY_INTAKE_TIMEOUT_MS || 10000);

// The n8n node truncates at 200 lines too; sending more just makes a webhook
// payload nobody reads.
const MAX_LINES = 200;

/**
 * One row of `result.results` → one line in the intake payload.
 *
 * The single most important thing here is that an unmatched row carries NO
 * `matched` key. That absence is what the n8n node reads as "we had nothing to
 * sell them", and it is what creates the `Wanted` row.
 *
 * A low-confidence match (`needsReview`) still counts as matched, because we
 * did quote something against it — it travels with the flag so the desk can
 * see it, but it does not create demand. If you would rather chase those too,
 * change this to omit `matched` when `row.needsReview` is true; the n8n side
 * needs no change.
 */
function toLine(row) {
  const line = { description: str(row.description) || '(unnamed line)' };

  if (row.sourceRow !== undefined && row.sourceRow !== null) line.sourceRow = row.sourceRow;

  const qty = firstNumber(row.quantity, row.unitsOrdered);
  if (qty !== null) line.qty = qty;
  // "Cases" / "Bottles" — the n8n side maps this onto Wanted's Qty Unit.
  if (str(row.quantityBasis)) line.unit = str(row.quantityBasis);

  const m = row.match || null;
  if (m) {
    line.matched = [m.brand, m.productName, m.variant].filter(Boolean).join(' ').trim() || 'matched';
    if (str(m.brand)) line.brand = str(m.brand);
    if (m.volumeMl !== undefined && m.volumeMl !== null) line.volumeMl = m.volumeMl;
    if (row.needsReview) line.needsReview = true;
    if (str(m.matchMethod)) line.matchMethod = str(m.matchMethod);
    const price = priceLabel(row);
    if (price) line.price = price;
  }

  // The buyer's own €/unit, when their file carried one. On an unmatched line
  // this is the whole game: it is the difference between "somebody wants this"
  // and "somebody wants this at €22.50, and is buying it from someone else
  // today".
  const target = firstNumber(row.customerPriceBase);
  if (target !== null) line.target = target;

  if (str(row.note)) line.note = str(row.note);
  return line;
}

/** "17.95 EUR/btl" — our selling price, exactly as the buyer already saw it. */
function priceLabel(row) {
  const price = firstNumber(row.wholesalePrice);
  if (price === null) return '';
  const currency = str(row.wholesaleCurrency);
  const basis = str(row.wholesaleBasis).replace(/^Per\s+/i, '');
  return [price, currency].filter(Boolean).join(' ') + (basis ? `/${basis}` : '');
}

/**
 * Build the webhook payload from a Trade Desk pricing result. Exported on its
 * own so it can be asserted without a network call — which is how the test in
 * this repo checks that a real API response still produces the `Wanted` rows
 * the buying brief depends on.
 */
export function buildIntakePayload({ result = {}, upload = {}, quoted = {}, contact = {} } = {}) {
  const summary = result.summary || {};
  const rows = Array.isArray(result.results) ? result.results : [];

  const payload = {
    // Whatever the SPA collected. All optional: the n8n node logs an
    // unattributable list rather than dropping it, so a buyer who gives no
    // details still produces demand we can act on.
    email: str(contact.email).toLowerCase(),
    name: str(contact.name),
    company: str(contact.company),
    phone: str(contact.phone),
    country: str(contact.country),
    note: str(contact.note),

    fileName: str(upload.name) || 'buying-list.xlsx',
    fileType: str(upload.type) || 'application/octet-stream',
    file: base64(upload.buffer),

    quotedFileName: str(quoted.name),
    quotedFileType: str(quoted.type),
    quotedFile: base64(quoted.buffer),

    lines: rows.slice(0, MAX_LINES).map(toLine),

    summary: {
      lineCount: numberOrNull(summary.totalRows),
      matchedCount: numberOrNull(summary.matchedRows),
      needsReviewCount: numberOrNull(summary.needsReviewRows),
      comparableCount: numberOrNull(summary.comparableRows),
      total: numberOrNull(summary.totalWholesaleValue),
      currency: str(summary.currency),
      // Both already shown to the buyer on screen.
      buyerTotal: numberOrNull(summary.totalCustomerValue),
      savingPct: numberOrNull(summary.savingPct),
    },

    // The webhook's honeypot. A real caller always sends it empty.
    company_website: '',
  };

  // Drop the keys we have nothing for, so the audit copy on the Enquiry record
  // is the payload as sent rather than a wall of empty strings.
  for (const key of Object.keys(payload)) {
    if (payload[key] === '' || payload[key] === null) delete payload[key];
  }
  for (const key of Object.keys(payload.summary)) {
    if (payload.summary[key] === '' || payload.summary[key] === null) delete payload.summary[key];
  }
  return payload;
}

/**
 * POST the payload. Resolves to `{ ok, status, body }` and NEVER rejects —
 * call it after the buyer's response has gone out and ignore the result, or
 * await it if you want the outcome in your own logs.
 */
export async function postToIntake(args = {}) {
  let payload;
  try {
    payload = buildIntakePayload(args);
  } catch (err) {
    return fail('payload', err);
  }

  if (!payload.file) {
    // Both halves of the intake need the buyer's file, and the webhook would
    // reject it anyway. Say so here rather than spending a round trip.
    return { ok: false, status: 0, error: 'no upload buffer to send' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.AKAY_INTAKE_SECRET) {
      headers['X-Akay-Intake-Secret'] = process.env.AKAY_INTAKE_SECRET;
    }
    const res = await fetch(INTAKE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      console.warn(`[intake] webhook returned ${res.status}: ${body.slice(0, 300)}`);
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return fail('post', err);
  } finally {
    clearTimeout(timer);
  }
}

function fail(stage, err) {
  // A failed log must never look like a failed quote. Warn and move on.
  console.warn(`[intake] ${stage} failed: ${(err && err.message) || err}`);
  return { ok: false, status: 0, error: String((err && err.message) || err) };
}

function str(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The first of several candidates that is a real number. */
function firstNumber(...values) {
  for (const v of values) {
    const n = numberOrNull(v);
    if (n !== null) return n;
  }
  return null;
}

function base64(buffer) {
  if (!buffer) return '';
  if (typeof buffer === 'string') return buffer;
  return Buffer.from(buffer).toString('base64');
}
