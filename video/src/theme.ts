// Brand tokens lifted from the offers.akay.ie stylesheet so a rendered video and
// a rendered offer card cannot drift apart. If the site palette changes, change
// it here too — these are the same values as the :root block in index.astro.

export type ThemeName = 'paper' | 'night';

export type Theme = {
  paper: string;
  paper2: string;
  card: string;
  ink: string;
  inkSoft: string;
  muted: string;
  line: string;
  brass: string;
  brass2: string;
  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  neu: string;
  neuBg: string;
};

export const THEMES: Record<ThemeName, Theme> = {
  paper: {
    paper: '#F7F5F0', paper2: '#EFEDE4', card: '#FFFFFF',
    ink: '#17140F', inkSoft: '#41473F', muted: '#767E72', line: '#E4E0D4',
    brass: '#B4231F', brass2: '#D0362E',
    ok: '#0E7A3B', okBg: '#E2F0E5', warn: '#9A6A12', warnBg: '#F5E9CE',
    neu: '#5C6A78', neuBg: '#E9ECEF',
  },
  night: {
    paper: '#0C140F', paper2: '#081009', card: '#13201A',
    ink: '#F1EFE7', inkSoft: '#C6CEC4', muted: '#8A968A', line: '#243029',
    brass: '#EC5A52', brass2: '#F26E66',
    ok: '#5FC97E', okBg: '#123021', warn: '#E0B65C', warnBg: '#31280F',
    neu: '#9AA7B4', neuBg: '#1B2530',
  },
};

// The site's font stacks. Rendering happens in headless Chromium, which has no
// Hoefler Text or Segoe UI — the generic fallbacks at the end of each stack are
// what actually get used, and they are chosen to match the site's tone. To pin
// an exact webfont instead, see "Fonts" in video/README.md.
export const SERIF =
  '"Hoefler Text","Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Liberation Serif","DejaVu Serif",serif';
export const SANS =
  'system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,"Liberation Sans","DejaVu Sans",sans-serif';
export const MONO =
  'ui-monospace,"SF Mono","SFMono-Regular",Menlo,Consolas,"Liberation Mono","DejaVu Sans Mono",monospace';
