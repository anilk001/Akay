// Committed brand alias map.
//
// 691 distinct brand strings come out of Airtable, and they are typed by hand
// across several ingestion paths, so the same brand arrives spelled several
// ways: "Dewars" and "Dewar's", "NIVEA" and "Nivea", "Chupa" and "Chupa Chups".
// Left alone, the first two collapse into one URL by accident and the third
// splits one brand across two pages.
//
// This map makes every such decision explicit and reviewable. The catalogue
// builder merges ONLY the pairs listed here; any other two brand names that
// happen to slugify the same emit a build warning and are kept apart with a
// numeric suffix, so a merge can never happen silently (§1 of the brief).
//
// Key: the raw Airtable brand string, lowercased and trimmed.
// Value: the canonical display name used for the page title, H1 and headings.

export const BRAND_ALIASES = {
  // Named in the brief
  'chupa': 'Chupa Chups',
  'dewars': "Dewar's",
  'ballantines': "Ballantine's",
  'moet & chandon': 'Moët & Chandon',

  // Same-slug collisions found in the live base (case and apostrophe variants).
  // Each pair is one brand, so merging is correct — it just has to be stated.
  'nivea': 'Nivea',
  'jack daniels': "Jack Daniel's",
  "lay's": "Lay's",

  'kitkat': 'KitKat',
  'got2b': 'Got2b',
  'nescafé': 'Nescafé',
  'william lawsons': "William Lawson's",

  // Accent-only variants. Transliterating for the slug (Nescafé -> nescafe)
  // makes these collide, so the correctly accented spelling is declared as
  // canonical and the unaccented one folds into it. The build warns on any
  // pair reaching this state that is not listed here, which is how these three
  // were found.
  'nescafe': 'Nescafé',
  'jagermeister': 'Jägermeister',
  'jägermeister': 'Jägermeister',
  'remy martin': 'Rémy Martin',
  'rémy martin': 'Rémy Martin',
  'gordons': "Gordon's",
  'grants': "Grant's",
  'bols creme de': 'Bols Creme de',
  'tullamore dew': 'Tullamore Dew',
  'hendricks': "Hendrick's",
};

// Resolve a raw Airtable brand string to its canonical display name.
// Unlisted brands pass through untouched — the map is an exception list, not a
// gatekeeper, so a new brand appears on the site without a code change.
export function canonicalBrand(raw) {
  const key = String(raw || '').trim();
  if (!key) return '';
  return BRAND_ALIASES[key.toLowerCase()] || key;
}
