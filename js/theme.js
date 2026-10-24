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
  abyss:   { name: 'Abyss',      page: '#071a1c', panel: '#0e2a2d', raise: '#153a3e', line: '#23545a', text: '#d6efee', muted: '#8fb9b7', accent: '#3fd0c4', dark: true },
  royal:   { name: 'Royal',      page: '#0b1230', panel: '#141d45', raise: '#1d2858', line: '#2f3d7a', text: '#e6e8f5', muted: '#9ea6cf', accent: '#e2b93b', dark: true },
  storm:   { name: 'Storm',      page: '#16191d', panel: '#20252b', raise: '#2a3038', line: '#3c4550', text: '#e3e7eb', muted: '#9aa4ae', accent: '#f2d43d', dark: true },
  plague:  { name: 'Plague',     page: '#0b0f0a', panel: '#141b12', raise: '#1d2619', line: '#2e3c27', text: '#dbe5d3', muted: '#93a487', accent: '#8bdc3f', dark: true },
  iron:    { name: 'Iron',       page: '#18191b', panel: '#232427', raise: '#2d2f33', line: '#44474d', text: '#e4e5e7', muted: '#9c9fa6', accent: '#b8c4cf', dark: true },
  dusk:    { name: 'Dusk',       page: '#1a1020', panel: '#261830', raise: '#322040', line: '#4a3158', text: '#f0e1ee', muted: '#b99cb8', accent: '#f08bb4', dark: true },
  deep:    { name: 'Deep Sea',   page: '#06142a', panel: '#0d2140', raise: '#142c53', line: '#22416f', text: '#dbe7f7', muted: '#8fa8c9', accent: '#4fb3ff', dark: true },
  blossom: { name: 'Blossom',    page: '#ead3d8', panel: '#fbf2f4', raise: '#f3e2e6', line: '#d6b2ba', text: '#3a1f27', muted: '#7d5a63', accent: '#b3405f', dark: false },
  fey:     { name: 'Feywild',    page: '#d9d2ea', panel: '#f6f3fc', raise: '#e9e3f6', line: '#bdb1d9', text: '#261d3d', muted: '#63587f', accent: '#6b46c1', dark: false },
  celestial: { name: 'Celestial', page: '#e8e0c8', panel: '#fffdf6', raise: '#f6f0de', line: '#d8c99a', text: '#2b2614', muted: '#6f6644', accent: '#a8841c', dark: false },
  meadow:  { name: 'Meadow',     page: '#cfe0c4', panel: '#f4f9ef', raise: '#e4efda', line: '#b0c99e', text: '#1d2a16', muted: '#56684b', accent: '#3f7f2f', dark: false },
  slate:   { name: 'Slate',      page: '#cfd3d8', panel: '#f7f8fa', raise: '#eaedf0', line: '#b8bfc8', text: '#1c2129', muted: '#5d6673', accent: '#2f5f8f', dark: false },
  tide:    { name: 'Tidepool',   page: '#cde5e3', panel: '#f2fbfa', raise: '#e0f1ef', line: '#a7cfca', text: '#12302d', muted: '#4d6f6b', accent: '#d0573f', dark: false },
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
