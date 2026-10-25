// Class tables: the book's per-level columns (Sneak Attack, Rages, Ki Points, spell slots…).
// A class or subclass entry holds table: [{ name, sheet, vals: [20 cells] }].
// A blank cell means "same as the level above", so only the levels where something changes need filling in.
// Level, Proficiency Bonus and Features are drawn from the rest of the entry.
import * as L from './library.js';
import * as R from './rules.js';

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
// A subclass column with the same name as one of its class's (a Moon druid's Wild Shape Max CR) replaces it.
export function valuesFor(c) {
  const out = [];
  for (const k of c.classes || []) {
    const lvl = Number(k.level) || 0; if (lvl < 1) continue;
    const mine = [];
    for (const src of [L.get(k.clsId), L.get(k.subId)]) {
      for (const col of src?.table || []) {
        if (!col.name?.trim()) continue;
        const v = { cls: k.name || L.get(k.clsId)?.name || '', from: src.name, level: lvl, name: col.name.trim(), value: cellAt(col, lvl), sheet: col.sheet !== false };
        const same = mine.findIndex(x => x.name.toLowerCase() === v.name.toLowerCase());
        if (same >= 0) { if (v.value) mine[same] = { ...v, sheet: mine[same].sheet || v.sheet }; }
        else mine.push(v);
      }
      // "By level" tables count too: each column after the first, at the character's row
      for (const t of src?.tables || []) {
        if (t.kind !== 'level') continue;
        const ri = rowForLevel(t, lvl);
        (t.cols || []).slice(1).forEach((name, j) => {
          name = String(name || '').trim(); if (!name) return;
          const v = { cls: k.name || L.get(k.clsId)?.name || '', from: src.name, level: lvl, name, value: ri >= 0 ? String(t.rows[ri][j + 1] ?? '').trim() : '', sheet: false };
          const same = mine.findIndex(x => x.name.toLowerCase() === name.toLowerCase());
          if (same >= 0) { if (v.value) mine[same] = { ...v, sheet: mine[same].sheet }; } else mine.push(v);
        });
      }
    }
    out.push(...mine);
  }
  return out;
}
// One column's value for this character ('' when they don't have it)
export function colValue(c, name) {
  const v = valuesFor(c).find(x => x.name.toLowerCase() === String(name).toLowerCase());
  return v ? v.value : '';
}

/* ---------- {tokens} ---------- */
// Everything a {name} can stand for: ability modifiers, proficiency, levels, "<Class> level", spell numbers, class table columns
export function tokenMap(c) {
  const m = new Map();
  for (const v of valuesFor(c)) if (!m.has(v.name.toLowerCase())) m.set(v.name.toLowerCase(), v.value || '—');
  for (const k of c.classes || []) { const n = (k.name || L.get(k.clsId)?.name || '').trim(); if (n) m.set(`${n.toLowerCase()} level`, String(Number(k.level) || 0)); }
  m.set('level', String(R.totalLevel(c))); m.set('prof', String(R.prof(c)));
  for (const [a] of R.ABILS) m.set(a, String(R.amod(c, a)));
  const sa = c.spell?.abil;
  if (sa) { m.set('spell attack', String(R.spellAttack(c, sa))); m.set('spell save dc', String(R.saveDc(c, sa))); }
  return m;
}
// Text: "+{cha}" and "{spell attack}" show signed ("+3"), everything else as is. Unknown names are left alone.
export function fillAll(c, text) {
  if (!text || !text.includes('{')) return text || '';
  const m = tokenMap(c);
  // "+{cha}" (plus sign right before it) and {spell attack} come out signed, "+3"; "1d4 + {prof}" stays "1d4 + 2"
  return text.replace(/(\+?)\{([^{}]{1,40})\}/g, (all, plus, n) => {
    const k = n.trim().toLowerCase();
    if (!m.has(k)) return all;
    const v = m.get(k);
    const num = /^-?\d+$/.test(v);
    if (num && (plus || k === 'spell attack')) return R.sign(Number(v));
    return plus + v;
  });
}
// A small sum like "1 + {int} + {Artificer level}" or "13 + {prof}"; null when it isn't one
export function evalFormula(c, f) {
  if (f == null || String(f).trim() === '') return null;
  const m = tokenMap(c);
  let bad = false;
  const t = String(f).replace(/\{([^{}]{1,40})\}/g, (all, n) => {
    const v = m.get(n.trim().toLowerCase());
    if (v == null || !/^-?\d+(\.\d+)?$/.test(v)) { bad = true; return '0'; }
    return `(${v})`;
  }).replace(/[×x]/g, '*');
  if (bad || !/^[\d\s+\-*/().]+$/.test(t)) return null;
  try { const n = Function(`"use strict";return (${t})`)(); return Number.isFinite(n) ? Math.floor(n) : null; } catch { return null; }
}

// {Sneak Attack} in feature text and reminders becomes this character's value ("3d6")
export const fillTokens = (c, text) => fillAll(c, text);

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

/* ---------- extra tables on any Library entry ----------
   entry.tables = [{ id, title, kind: 'roll' | 'level' | 'plain', die, feature, cols: [names], rows: [[cells]] }]
   roll:  first column is the roll ("1", "2-3", "01-05", "96-00"); the Roll button picks a row
   level: first column is a level ("3", "7"…); the character's row is the last one at or below their level
   plain: just rows and columns */
export const TABLE_KINDS = [['roll', 'Random roll'], ['level', 'By level'], ['plain', 'Plain']];
export const blankTable = (kind = 'roll') => ({ id: Math.random().toString(36).slice(2, 10), title: '', kind, die: kind === 'roll' ? 'd6' : '', feature: '',
  cols: kind === 'roll' ? ['d6', 'Result'] : kind === 'level' ? ['Level', ''] : ['', ''], rows: kind === 'roll' ? [['1', ''], ['2', ''], ['3', ''], ['4', ''], ['5', ''], ['6', '']] : [['', ''], ['', '']] });

// "2d6" -> { n: 2, d: 6 }; "d100" -> { n: 1, d: 100 }
export function parseDie(s) { const m = /^\s*(\d*)\s*d\s*(\d+)\s*$/i.exec(String(s || '')); return m ? { n: Number(m[1] || 1), d: Number(m[2]) } : null; }
export function rollDie(s) {
  const p = parseDie(s); if (!p || p.n < 1 || p.d < 1) return null;
  let t = 0; for (let i = 0; i < Math.min(p.n, 50); i++) t += 1 + Math.floor(Math.random() * p.d);
  return t;
}
// Does "2-3" (or "01–05", "96-00", "7+", "1") cover n?
export function inRange(cell, n, die) {
  const t = String(cell || '').trim().replace(/[–—]/g, '-');
  if (!t) return false;
  const big = parseDie(die)?.d === 100 ? 100 : null;
  const num = x => { const v = Number(x); return big && v === 0 && /^0+$/.test(x) ? 100 : v; };
  let m = /^(\d+)\s*-\s*(\d+)$/.exec(t); if (m) return n >= num(m[1]) && n <= num(m[2]);
  m = /^(\d+)\s*\+$/.exec(t); if (m) return n >= num(m[1]);
  m = /^(\d+)$/.exec(t); if (m) return n === num(m[1]);
  return false;
}
export const rowForRoll = (t, n) => (t.rows || []).findIndex(r => inRange(r[0], n, t.die));
export function rowForLevel(t, lvl) {
  let best = -1, at = -1;
  (t.rows || []).forEach((r, i) => { const v = parseInt(r[0], 10); if (Number.isFinite(v) && v <= lvl && v >= at) { at = v; best = i; } });
  return best;
}

// The Library entries a character draws on, with the level that counts for each
export function entriesFor(c) {
  const out = [], seen = new Set();
  const add = (id, lvl) => { const e = L.get(id); if (e && !seen.has(e.id)) { seen.add(e.id); out.push({ e, lvl }); } };
  const total = R.totalLevel(c);
  const race = L.get(c.raceId); if (race) { add(race.parent, total); add(race.id, total); }
  for (const k of c.classes || []) { const l = Number(k.level) || 0; add(k.clsId, l); add(k.subId, l); }
  add(c.bgId, total); add(L.get(c.bgId)?.feat, total);
  for (const f of c.feats || []) { const m = /^(?:bgfeat|feat):(.+)$/.exec(f.auto || f.libId || ''); if (m) add(m[1], total); else if (f.name) add(L.findByName?.('feat', f.name)?.id, total); }
  for (const p of c.options || []) add(p.id, total);
  return out;
}
// Every extra table this character has: [{ t, e, lvl }]
export const tablesFor = c => entriesFor(c).flatMap(({ e, lvl }) => (e.tables || []).filter(t => (t.rows || []).length).map(t => ({ t, e, lvl })));
// Tables shown inside a feature on the sheet (matched by the feature's name and where it came from)
export function tablesForFeature(c, f) {
  const all = tablesFor(c).filter(x => x.t.feature && x.t.feature.trim().toLowerCase() === String(f.name || '').trim().toLowerCase());
  const key = `${f.auto || ''} ${f.libId || ''}`;
  const strict = all.filter(x => key.includes(x.e.id));
  return strict.length ? strict : all;
}
// Tables not tied to a feature the character has, for the sheet's Tables section
export function looseTables(c) {
  const names = new Set([...(c.classFeat || []), ...(c.racial || []), ...(c.feats || []), c.bgFeature || {}].map(f => String(f.name || '').trim().toLowerCase()).filter(Boolean));
  return tablesFor(c).filter(x => !x.t.feature || !names.has(x.t.feature.trim().toLowerCase()));
}

// One table as HTML. roll: { n, row } from the last roll, to highlight
export function extraTableHtml(t, esc, { lvl = null, roll = null, rollable = false, fill = s => s } = {}) {
  const cols = t.cols || [];
  const hi = t.kind === 'level' && lvl != null ? rowForLevel(t, lvl) : t.kind === 'roll' && roll ? roll.row : -1;
  return `<div class="xtable" data-xt="${esc(t.id)}">
    <div class="xthead">${t.title ? `<b>${esc(t.title)}</b>` : ''}${t.kind === 'roll' && t.die ? `<span class="sub">Roll ${esc(t.die)}</span>` : ''}
      ${rollable && t.kind === 'roll' && parseDie(t.die) ? `<button class="btn small" type="button" data-act="troll" data-tid="${esc(t.id)}">Roll ${esc(t.die)}</button>` : ''}</div>
    ${roll ? `<p class="xtroll">Rolled <b>${roll.n}</b>${roll.row < 0 ? ': no row covers that number.' : ''}</p>` : ''}
    <div class="ctable-wrap"><table class="ctable xt">
      <tr>${cols.map(h => `<th>${esc(h)}</th>`).join('')}</tr>
      ${(t.rows || []).map((r, i) => !r.some(x => String(x ?? '').trim()) ? '' : `<tr class="${i === hi ? 'hi' : ''}">${cols.map((_, j) => `<td class="${j ? 'tfeat' : ''}">${esc(fill(r[j] ?? ''))}</td>`).join('')}</tr>`).join('')}
    </table></div></div>`;
}
