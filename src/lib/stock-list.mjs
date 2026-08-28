// Where the build-time stock-list workbook lands, and what may go in it.
//
// Shared by the generator (scripts/build-stock-list.mjs) and the RFQ form that
// reveals the link, so the path can never drift between the two.

export const STOCK_LIST_PATH = '/downloads/akay-stock-list.xlsx';

// The ONLY columns permitted in the workbook, and the offer property each reads
// from. This is an allow-list, not a deny-list: a field added to the offer shape
// later cannot appear in the export unless someone adds it here deliberately.
// Every entry is on the brief's §0 safe list.
export const STOCK_LIST_COLUMNS = [
  ['Brand', 'brand', 22],
  ['Product', 'name', 46],
  ['Variants', 'variants', 26],
  ['Pack spec', 'spec', 26],
  ['Category', 'category', 15],
  ['Currency', 'currency', 10],
  ['Price', 'amount', 12],
  ['Price basis', 'priceBasis', 12],
  ['Price detail', 'priceDetail', 40],
  ['Availability', 'stockLabel', 16],
  ['Cases available', 'qty', 16],
  ['Customs status', 'tier', 16],
  ['Terms', 'terms', 22],
  ['Origin', 'origin', 16],
  ['MOQ', 'moq', 22],
  ['Lead time', 'leadTime', 18],
  ['Cases / pallet', 'casesPerPallet', 14],
  ['Pieces / pallet', 'piecesPerPallet', 14],
  ['Full truckload', 'fullTruckload', 14],
  ['Weight (kg)', 'weightKg', 12],
  ['CBM', 'cbm', 10],
  ['HS code', 'hsCode', 14],
  ['Best before', 'bbd', 14],
  ['EAN (unit)', 'eanUnit', 16],
  ['EAN (case)', 'eanCase', 16],
  ['Offer page', 'pageUrl', 44],
];
