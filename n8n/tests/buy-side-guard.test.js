const PRICE_RE = /(?:[€£$]|\b(?:eur|euros?|usd|gbp|aed|sgd)\b)\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*(?:[€£$]|\b(?:eur|euros?|usd|gbp|aed|sgd)\b)|\d+(?:[.,]\d+)?\s*\/\s*(?:btls?|bottles?|cs|cases?|ctns?|cartons?|pcs?|pieces?|pack|cans?|jars?|units?)\b/i;

// Deliberately NARROW. A missed offer costs more than a review line, so this
// only lists phrasings that are unmistakably buy-side. Notably absent:
// "do you have" / "do you need" / "looking for" - all three appear in genuine
// SELL messages ("Do you need Pilsner Urquell...").
const BUY_SIDE = /\b(?:i(?:'|’)?d\s+like\s+(?:a\s+)?(?:quote|quotation|price)|(?:please\s+|kindly\s+)?(?:send|share)\s+(?:me\s+|us\s+)?(?:a\s+|your\s+)?(?:quote|quotation|best\s+price)|what(?:'|’)?s\s+your\s+best\s+price|can\s+you\s+(?:do|beat|match)\b|(?:we\s+are|we're|i\s+am|i'm)\s+looking\s+to\s+buy|interested\s+in\s+buying|want\s+to\s+buy|request(?:ing)?\s+(?:a\s+)?quot)/i;

const SELL = [
  "HI Anil, any interest ?\n1250 cs Martini Bianco 6x1L original T2 \n33,60€/cs EXW Loendersloot on floor",
  "Do you need Pilsner Urquell\n500ml cans x1800 cases\nJune 2027 BBD \nEx bond Loendersloot \nEuro 14.00 T2\n6 loads available.",
  "KINDER SURPRISE GIRL / BOY 20G\n36 pcs / case\n0.715 EUR / pc EXW Romania",
  "RED BULL ENERGY DRINK 250ml - FTL offer\n24 pcs/tray\n0,84€ EXW RO",
  "TAKIS 90G\n18 pcs/box\nPrice 1,02€ EXW RO",
];
const BUY = [
  "Hi, I'd like a quote for Carlsberg Elephant (24 x 500ml) listed at EUR 13.55 per case.",
  "Can you do 5.95 EUR on the Absolut?",
  "Please send me your best price for Jameson 70cl, around EUR 18.00",
  "We are looking to buy 2 pallets, budget EUR 12.00/cs",
];

function classify(t){
  const hasPrice = t.length>0 && PRICE_RE.test(t);
  const buy = BUY_SIDE.test(t);
  return (hasPrice && !buy) ? 'Supplier Offer' : 'Other';
}
let fail=0;
console.log('--- SELL side (must stay Supplier Offer) ---');
for(const t of SELL){const r=classify(t);const ok=r==='Supplier Offer';if(!ok)fail++;
  console.log((ok?'PASS':'FAIL'),'|',r.padEnd(14),'|',t.split('\n')[0].slice(0,58));}
console.log('--- BUY side (must become Other) ---');
for(const t of BUY){const r=classify(t);const ok=r==='Other';if(!ok)fail++;
  console.log((ok?'PASS':'FAIL'),'|',r.padEnd(14),'|',t.split('\n')[0].slice(0,58));}
console.log(fail===0?'\nALL PASS':'\n'+fail+' FAILURES');
