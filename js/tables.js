// Class tables: the book's per-level columns (Sneak Attack, Rages, Ki Points, spell slots…).
// A class or subclass entry holds table: [{ name, sheet, vals: [20 cells] }].
// A blank cell means "same as the level above", so only the levels where something changes need filling in.
// Level, Proficiency Bonus and Features are drawn from the rest of the entry.
import * as L from './library.js';

export const LEVELS = 20;
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th'];
export const ord = n => ORD[n - 1] || String(n);
export const profAt = lvl => 2 + Math.floor((lvl - 1) / 4);

// The value a column has at a level, carrying blank cells down from the level above
export function cellAt(col, lvl) {
  const v = col?.vals || [];
  for (let i = Math.min(lvl, LEVELS) - 1; i >= 0; i--) if (String(v[i] ?? '').trim() !== '') return String(v[i]).trim();
  return '';
}
export const blankCol = () => ({ name: '', sheet: true, vals: Array(LEVELS).fill('') });

// Every column a character has, at their level in that class: [{ cls, sub, level, name, value, sheet }]
export function valuesFor(c) {
  const out = [];
  for (const k of c.classes || []) {
    const lvl = Number(k.level) || 0; if (lvl < 1) continue;
    for (const src of [L.get(k.clsId), L.get(k.subId)]) {
      for (const col of src?.table || []) {
        if (!col.name?.trim()) continue;
        out.push({ cls: k.name || L.get(k.clsId)?.name || '', from: src.name, level: lvl, name: col.name.trim(), value: cellAt(col, lvl), sheet: col.sheet !== false });
      }
    }
  }
  return out;
}

// {Sneak Attack} in feature text and reminders becomes this character's value ("3d6").
// Names that aren't a column are left alone.
export function fillTokens(c, text) {
  if (!text || !text.includes('{')) return text || '';
  const vals = valuesFor(c);
  if (!vals.length) return text;
  const map = new Map();
  for (const v of vals) if (!map.has(v.name.toLowerCase())) map.set(v.name.toLowerCase(), v.value || '—');
  return text.replace(/\{([^{}]{1,40})\}/g, (m, n) => map.get(n.trim().toLowerCase()) ?? m);
}

// The book-style table for the Library and the info buttons
export function tableHtml(e, esc) {
  const cols = (e.table || []).filter(x => x.name?.trim());
  const isClass = e.type === 'class';
  if (!cols.length && !isClass) return '';
  const feats = lvl => {
    const fs = (e.features || []).filter(f => Number(f.lvl) === lvl).map(f => f.name).filter(Boolean);
    if (isClass && (e.asi || []).map(Number).includes(lvl)) fs.push('Ability Score Improvement');
    return fs;
  };
  if (isClass && !cols.length && !(e.features || []).length) return '';
  const head = `<tr><th>Level</th>${isClass ? '<th>Proficiency Bonus</th>' : ''}<th class="tfeat">Features</th>${cols.map(x => `<th>${esc(x.name)}</th>`).join('')}</tr>`;
  const rows = [];
  for (let l = 1; l <= LEVELS; l++) {
    const fs = feats(l);
    if (!isClass && !fs.length && !cols.some(x => String(x.vals?.[l - 1] ?? '').trim())) continue; // subclass: only levels where something happens
    rows.push(`<tr><td>${ord(l)}</td>${isClass ? `<td>+${profAt(l)}</td>` : ''}<td class="tfeat">${fs.map(esc).join(', ') || '—'}</td>${cols.map(x => `<td>${esc(cellAt(x, l) || '—')}</td>`).join('')}</tr>`);
  }
  return `<h3>${esc(e.name)} table</h3><div class="ctable-wrap"><table class="ctable">${head}${rows.join('')}</table></div>`;
}
