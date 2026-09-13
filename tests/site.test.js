// The re-confirm link, which is a GET that logs an enquiry — so it must only
// ever be built for a real Airtable record id.

import assert from 'node:assert/strict';
import { reconfirmUrl, absoluteUrl, SITE_URL } from '../src/lib/site.mjs';

let n = 0;
const eq = (a, b) => { assert.equal(a, b); n += 1; };

eq(reconfirmUrl('rec002EcNLmBaYVzr'),
  'https://akay-team.app.n8n.cloud/webhook/reconfirm?o=rec002EcNLmBaYVzr');

// A snapshot-built offer has a placeholder id, not an Airtable one. Linking it
// would send the buyer to the workflow's "link not valid" page for nothing.
eq(reconfirmUrl('snapshot-12'), '');
eq(reconfirmUrl(''), '');
eq(reconfirmUrl(null), '');
eq(reconfirmUrl(undefined), '');
// Right prefix, wrong length — the workflow's own guard would reject it too.
eq(reconfirmUrl('recTOOSHORT'), '');
eq(reconfirmUrl('rec002EcNLmBaYVzrEXTRA'), '');
// Nothing that could carry a quote or a second parameter into the endpoint.
eq(reconfirmUrl("rec002EcNLmBaYVz'"), '');
eq(reconfirmUrl('rec002EcNLmBaYV&c'), '');

eq(absoluteUrl('/about/'), `${SITE_URL}/about/`);
eq(absoluteUrl('about/'), `${SITE_URL}/about/`);
eq(absoluteUrl('https://example.com/x'), 'https://example.com/x');

console.log(`site: ${n} assertions passed`);
