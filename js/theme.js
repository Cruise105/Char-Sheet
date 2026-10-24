// Each character carries its own look. These are the pieces a player mixes.

export const PRESETS = {
  night:   { name: 'Night',      page: '#121821', panel: '#1b2330', raise: '#253043', line: '#34425a', text: '#dde4ec', muted: '#93a1b3', accent: '#d0606c', dark: true },
  vellum:  { name: 'Vellum',     page: '#cfc6b4', panel: '#f6f0e3', raise: '#ebe2cf', line: '#b9ab8e', text: '#2a2118', muted: '#6c5f4b', accent: '#7a2c1e', dark: false },
  ember:   { name: 'Ember',      page: '#1a0f0c', panel: '#2a1813', raise: '#3a221a', line: '#5a3426', text: '#f2dfd2', muted: '#c49a85', accent: '#ef7b3c', dark: true },
  grove:   { name: 'Grove',      page: '#0f1a14', panel: '#17271e', raise: '#20352a', line: '#2f4b3b', text: '#dcebdd', muted: '#94b29d', accent: '#9fcf6a', dark: true },
  frost:   { name: 'Frost',      page: '#d5e1ea', panel: '#f3f8fb', raise: '#e1ecf3', line: '#a9bfcf', text: '#13263a', muted: '#4f6a82', accent: '#2a6fa8', dark: false },
  void:    { name: 'Void',       page: '#0d0b16', panel: '#18142a', raise: '#231d3b', line: '#3a3160', text: '#e6e0f7', muted: '#a39bc4', accent: '#b583ff', dark: true },
  sand:    { name: 'Desert',     page: '#c9a978', panel: '#f3e6cc', raise: '#e8d6b2', line: '#c2a273', text: '#2e2012', muted: '#735a3a', accent: '#a24b17', dark: false },
  blood:   { name: 'Bloodmoon',  page: '#140708', panel: '#220e10', raise: '#311518', line: '#4e2125', text: '#f1dcdc', muted: '#bf9393', accent: '#e23b3b', dark: true },
};

// Accent swatches tied to class flavor; players can also pick any color
export const CLASS_ACCENTS = [
  ['Artificer', '#c8873a'], ['Barbarian', '#c0392b'], ['Bard', '#c2569b'], ['Blood Hunter', '#8e1b2a'],
  ['Cleric', '#d9b44a'], ['Druid', '#5f9a43'], ['Fighter', '#8a96a3'], ['Monk', '#3fa6a0'],
  ['Paladin', '#e0c060'], ['Ranger', '#3f7f4d'], ['Rogue', '#6b6f78'], ['Sorcerer', '#d1495b'],
  ['Warlock', '#7d4fb3'], ['Wizard', '#3d6fc4'],
];

export const HEAD_FONTS = {
  alegreya: ['Alegreya', '"Alegreya", Georgia, serif'],
  cinzel: ['Cinzel', '"Cinzel", "Alegreya", serif'],
  fell: ['IM Fell English', '"IM Fell English", "Alegreya", serif'],
  uncial: ['Uncial Antiqua', '"Uncial Antiqua", "Alegreya", serif'],
  gothic: ['Grenze Gotisch', '"Grenze Gotisch", "Alegreya", serif'],
  eczar: ['Eczar', '"Eczar", "Alegreya", serif'],
};
export const BODY_FONTS = {
  sans: ['Alegreya Sans', '"Alegreya Sans", system-ui, sans-serif'],
  serif: ['Alegreya', '"Alegreya", Georgia, serif'],
};

export const FRAMES = {
  clean: 'Clean',
  parchment: 'Parchment',
  metal: 'Forged metal',
  arcane: 'Arcane',
  none: 'Borderless',
};

const hex = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (h, a) => { const c = hex(h) || [0, 0, 0]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
// Pick black or white text for a filled accent button
function inkFor(h) {
  const c = hex(h); if (!c) return '#fff';
  const L = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
  return lum > 0.4 ? '#141414' : '#ffffff';
}

// Apply a character's theme to an element as CSS variables
export function applyTheme(el, theme) {
  const t = theme || {};
  const p = PRESETS[t.preset] || PRESETS.night;
  const accent = hex(t.accent) ? t.accent : p.accent;
  const panelA = Math.min(100, Math.max(30, Number(t.panel) || 88)) / 100;
  const v = {
    '--page': p.page, '--panel': rgba(p.panel, panelA), '--panel-solid': p.panel,
    '--raise': rgba(p.raise, Math.min(1, panelA + 0.06)), '--line': p.line,
    '--text': p.text, '--muted': p.muted, '--ink': p.text,
    '--accent': accent, '--accent-soft': rgba(accent, p.dark ? 0.18 : 0.12), '--accent-ink': inkFor(accent),
    '--head': (HEAD_FONTS[t.head] || HEAD_FONTS.alegreya)[1],
    '--body': (BODY_FONTS[t.body] || BODY_FONTS.sans)[1],
    '--bg-blur': `${Math.max(0, Number(t.bg?.blur) || 0)}px`,
    '--bg-dim': String(Math.min(90, Math.max(0, Number(t.bg?.dim) || 0)) / 100),
  };
  for (const [k, val] of Object.entries(v)) el.style.setProperty(k, val);
  el.dataset.frame = FRAMES[t.frame] ? t.frame : 'clean';
  el.dataset.tone = p.dark ? 'dark' : 'light';
  return p;
}
