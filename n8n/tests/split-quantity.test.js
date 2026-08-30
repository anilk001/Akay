const QTY = /^(?:ftl|full\s*truck(?:load)?|\d[\d,. ]*\s*(?:cs|cases?|ctns?|cartons?|btls?|bottles?|pcs|pieces?|pal|pallets?|units?))\b/i;
const TERMS = /^(?:exw|ex\s*works?|fca|fob|cfr|cnf|cif|dap|ddp)\b/i;

function splitQuantityOLD(name) {
  const parts = String(name).split(/\s+[–—-]\s+/);
  const qty = [];
  while (parts.length > 1) {
    const tail = parts[parts.length - 1].trim();
    if (!QTY.test(tail) && !TERMS.test(tail)) break;
    qty.unshift(tail); parts.pop();
  }
  return { name: parts.join(' - ').trim(), qty: qty.join(' ') };
}

function splitQuantityNEW(name) {
  const parts = String(name).split(/\s+[–—-]\s+/);
  const qty = [];
  while (parts.length > 1) {
    const tail = parts[parts.length - 1].trim();
    if (!QTY.test(tail) && !TERMS.test(tail)) break;
    qty.unshift(tail); parts.pop();
  }
  let head = parts.join(' - ').trim();
  // NEW: a quantity stated BEFORE the product ("1250 cs Martini Bianco").
  // Same QTY vocabulary, so it needs an explicit unit word - a bare number
  // like "1000 Islands Vodka" is left alone.
  const lead = head.match(QTY);
  if (lead && head.slice(lead[0].length).trim()) {
    qty.unshift(lead[0].trim());
    head = head.slice(lead[0].length).trim();
  }
  return { name: head, qty: qty.join(' ') };
}

const cases = [
  "1250 cs Martini Bianco 6x1L original T2",
  "Hennessy VS GBX 6x70cl 40% - 1,250 cs",
  "Clase Azul Reposado Tequila 40% 70cl + GBX - EXW PLG - 1000 btls",
  "1000 Islands Vodka 70cl",
  "KINDER SURPRISE GIRL / BOY 20G",
  "Cristal 2016 NGBX (T2)",
  "24 bottles Jameson 70cl",
  "Palma Louca Beer 350ml",
  "500 pcs Toblerone 100g",
  "6x1L Martini Bianco",
];
console.log('INPUT'.padEnd(52), '| OLD name'.padEnd(40), '| NEW name');
console.log('-'.repeat(130));
for (const c of cases) {
  const o = splitQuantityOLD(c), n = splitQuantityNEW(c);
  const flag = o.name !== n.name ? '  <-- changed' : '';
  console.log(c.padEnd(52), '|', o.name.padEnd(38), '|', n.name + flag);
}
