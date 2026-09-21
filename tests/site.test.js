// The re-confirm link, which is a GET that logs an enquiry — so it must only
// ever be built for a real Airtable record id.

import assert from 'node:assert/strict';
import { reconfirmOfferId, absoluteUrl, quoteUrl, SITE_URL, QUOTE_URL } from '../src/lib/site.mjs';

let n = 0;
const eq = (a, b) => { assert.equal(a, b); n += 1; };

eq(reconfirmOfferId('rec002EcNLmBaYVzr'), 'rec002EcNLmBaYVzr');

// A snapshot-built offer has a placeholder id, not an Airtable one. Linking it
// would send the buyer to the workflow's "link not valid" page for nothing.
eq(reconfirmOfferId('snapshot-12'), '');
eq(reconfirmOfferId(''), '');
eq(reconfirmOfferId(null), '');
eq(reconfirmOfferId(undefined), '');
// Right prefix, wrong length — the workflow's own guard would reject it too.
eq(reconfirmOfferId('recTOOSHORT'), '');
eq(reconfirmOfferId('rec002EcNLmBaYVzrEXTRA'), '');
// Nothing that could carry a quote or a second parameter into the endpoint.
eq(reconfirmOfferId("rec002EcNLmBaYVz'"), '');
eq(reconfirmOfferId('rec002EcNLmBaYV&c'), '');

// The Trade Desk lives on its own origin and routes on the hash, so every
// link into it has to carry a tab the app actually knows about — the ids come
// from the bundle in quote/ (see quote/README.md).
eq(quoteUrl('chat'), `${QUOTE_URL}/#chat`);
eq(quoteUrl('excel'), `${QUOTE_URL}/#excel`);
eq(quoteUrl(), `${QUOTE_URL}/#chat`);
eq(quoteUrl('#excel'), `${QUOTE_URL}/#excel`);
eq(quoteUrl('EXCEL'), `${QUOTE_URL}/#excel`);
// A tab that no longer exists opens the desk rather than a hash the app drops.
eq(quoteUrl('upload'), QUOTE_URL);
eq(quoteUrl(''), QUOTE_URL);
eq(quoteUrl(null), QUOTE_URL);

eq(absoluteUrl('/about/'), `${SITE_URL}/about/`);
eq(absoluteUrl('about/'), `${SITE_URL}/about/`);
eq(absoluteUrl('https://example.com/x'), 'https://example.com/x');

console.log(`site: ${n} assertions passed`);
