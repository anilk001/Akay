// The email pattern shared by Offer Dispatch (Build Recipients) and the Ad-hoc
// Bulk Broadcast template (Build Batches) must match what Resend itself
// accepts for `to`, no stricter and no looser. Cases are the real addresses
// from the 2026-09-08 Lotus send.  node n8n/tests/resend-email-regex.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', 'offer-dispatch');
for (const file of ['build-recipients.js', 'bulk-broadcast-build-batches.js']) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8');
  const m = code.match(/const RESEND_EMAIL = (\/.*\/);/);
  assert(m, file + ' must define RESEND_EMAIL');
  const re = eval(m[1]);

  const accept = [
    "alan.o'brien@barrys.ie",        // apostrophe: Resend returned 200 (id 4d08184d)
    'hemal.sankla@gmail.com',
    'biuro@mielniczek.bydgoszcz.pl',
    'first+tag@sub.example.co.uk',
    'a-alansari@live.com',
  ];
  const reject = [
    'info@organic',                  // no TLD: caused batch 3's 422
    'grosshandel@medivon.d',         // one-letter TLD: batch 5's 422
    'nfisher@saputocheese',          // no TLD: batch 20's 422
    '.leading@dot.com',
    'double..dot@example.com',
    'trailing.@example.com',
    'no-at-sign.example.com',
    'space in@example.com',
  ];
  for (const e of accept) assert(re.test(e), file + ' must accept ' + e);
  for (const e of reject) assert(!re.test(e), file + ' must reject ' + e);
  console.log('ok  ' + file + ': ' + accept.length + ' accepted, ' + reject.length + ' rejected');
}
console.log('\nresend email regex tests passed');
