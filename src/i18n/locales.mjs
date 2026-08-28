// §6 — the languages the trust pages and category pages are published in.
//
// Chosen for the buyer base, not for coverage: Portuguese for Brazil and
// Lusophone Africa, Spanish for LatAm, Arabic for MENA, French for West Africa
// and the Maghreb. Catalogue rows stay in English throughout — product names
// are brand names, and translating "Absolut Vodka 12 x 100cl" helps nobody.

export const DEFAULT_LOCALE = 'en';

export const LOCALES = {
  en: { name: 'English', native: 'English', dir: 'ltr' },
  pt: { name: 'Portuguese', native: 'Português', dir: 'ltr' },
  es: { name: 'Spanish', native: 'Español', dir: 'ltr' },
  fr: { name: 'French', native: 'Français', dir: 'ltr' },
  ar: { name: 'Arabic', native: 'العربية', dir: 'rtl' },
};

// Locales that get their own URL prefix. English is served at the root.
export const TRANSLATED = Object.keys(LOCALES).filter((c) => c !== DEFAULT_LOCALE);

export function localePrefix(code) {
  return code === DEFAULT_LOCALE ? '' : `/${code}`;
}

export function localeHref(code, path) {
  return `${localePrefix(code)}${path}`;
}
