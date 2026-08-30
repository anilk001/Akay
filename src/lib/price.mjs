// Display label for a normalized price basis ('case', 'bottle', 'piece', …)
// as parsed into offer.priceBasis by the data layer. Most offers price per
// case, but ~80 live lines price per bottle/piece/jar — hardcoding "/ case"
// mislabels those, so anywhere a price is captioned must go through this.
// An empty basis (bare Price Display fallback) gets no label: asserting a
// quantity we don't know is worse than showing just the figure.
export function basisLabel(basis = '') {
  if (!basis) return '';
  if (/case/.test(basis)) return '/ case';
  if (/pack/.test(basis)) return '/ pack';
  if (/btl|bottle/.test(basis)) return '/ btl';
  return '/ unit';
}

// Compact form for <title> and meta descriptions: "/case", "/btl", or ''.
export function basisSuffix(basis = '') {
  return basisLabel(basis).replace(/\s/g, '');
}
