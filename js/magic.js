// Spellcasting resources: spell points (DMG variant + Table Rules) or spell slots, and Pact Magic.
import * as L from './library.js';

// Full-caster slot table by caster level (also the multiclass table), slots for spell levels 1-9
const SLOTS = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
// DMG "Spell Points by Level" and "Spell Point Cost"
const POINTS = [0, 4, 6, 14, 17, 27, 32, 38, 44, 57, 64, 73, 73, 83, 83, 94, 94, 107, 114, 123, 133];
export const COST = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7, 6: 9, 7: 10, 8: 11, 9: 13 };
// Pact Magic: [slots, slot level] by warlock level
const PACT = [[0, 0], [1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]];
export const FREE_STRAIN = 3; // Table Rules: 3 casts each of 5th and 6th level before the strain save

// How much each class adds to caster level; a subclass (Eldritch Knight, Arcane Trickster) can make a class a third-caster
function casterOf(k) {
  const cls = L.get(k.clsId), sub = L.get(k.subId);
  return sub?.caster || cls?.caster || '';
}
export function casterInfo(c) {
  const rows = (c.classes || []).map(k => ({ k, type: casterOf(k), lvl: Number(k.level) || 0 }));
  const casters = rows.filter(r => ['full', 'half', 'third', 'artificer'].includes(r.type));
  let level = 0;
  if (casters.length === 1) {
    const r = casters[0];
    level = r.type === 'full' ? r.lvl : r.type === 'artificer' ? Math.ceil(r.lvl / 2)
      : r.type === 'half' ? (r.lvl >= 2 ? Math.ceil(r.lvl / 2) : 0) : (r.lvl >= 3 ? Math.ceil(r.lvl / 3) : 0);
  } else {
    for (const r of casters) level += r.type === 'full' ? r.lvl : r.type === 'artificer' ? Math.ceil(r.lvl / 2) : r.type === 'half' ? Math.floor(r.lvl / 2) : Math.floor(r.lvl / 3);
  }
  level = Math.min(20, level);
  const pactLvl = rows.filter(r => r.type === 'pact').reduce((t, r) => t + r.lvl, 0);
  const pact = PACT[Math.min(20, pactLvl)] || [0, 0];
  return {
    level, slots: SLOTS[level] || [], maxLevel: (SLOTS[level] || []).length,
    points: POINTS[level] || 0,
    pact: { slots: pact[0], level: pact[1] },
  };
}

// Highest spell level this character can cast at all (slots, points or pact)
export function maxCastLevel(c) {
  const i = casterInfo(c);
  return Math.max(i.maxLevel, i.pact.level);
}

// The state a character keeps: c.magic = { sp: spent points, slots: {lvl: used}, pact: used, strain: {5: casts, 6: casts} }
export function ensureMagic(c) {
  c.magic = c.magic || {};
  c.magic.spent = Number(c.magic.spent) || 0;
  c.magic.slots = c.magic.slots || {};
  c.magic.pact = Number(c.magic.pact) || 0;
  c.magic.strain = c.magic.strain || {};
  return c.magic;
}
export function pointsLeft(c) {
  const i = casterInfo(c), m = ensureMagic(c);
  const max = c.magic.maxOverride !== '' && c.magic.maxOverride != null && Number.isFinite(Number(c.magic.maxOverride)) ? Number(c.magic.maxOverride) : i.points;
  return { max, left: Math.max(0, max - m.spent) };
}

// What casting at `lvl` would need. Returns { ok, how, cost, strain, freeLeft, reason }
export function planCast(c, lvl, mode, usePact = false) {
  const i = casterInfo(c), m = ensureMagic(c);
  if (lvl <= 0) return { ok: true, how: 'cantrip' };
  if (usePact) {
    if (!i.pact.slots) return { ok: false, reason: 'No Pact Magic slots.' };
    if (lvl !== i.pact.level) return { ok: false, reason: `Pact Magic slots are level ${i.pact.level}.` };
    if (m.pact >= i.pact.slots) return { ok: false, reason: 'No Pact Magic slots left. They come back on a short or long rest.' };
    return { ok: true, how: 'pact' };
  }
  if (mode === 'points') {
    const { left } = pointsLeft(c);
    const cost = COST[lvl];
    if (lvl > i.maxLevel) return { ok: false, reason: `You can't cast spells above level ${i.maxLevel || 0} yet.` };
    if (cost > left) return { ok: false, reason: `Needs ${cost} spell points; you have ${left}.` };
    let strain = false, freeLeft = null;
    if (lvl >= 7) strain = true;
    else if (lvl >= 5) { const used = Number(m.strain[lvl]) || 0; freeLeft = Math.max(0, FREE_STRAIN - used); strain = used >= FREE_STRAIN; }
    return { ok: true, how: 'points', cost, strain, freeLeft };
  }
  const have = i.slots[lvl - 1] || 0, used = Number(m.slots[lvl]) || 0;
  if (!have) return { ok: false, reason: `You have no level ${lvl} slots.` };
  if (used >= have) return { ok: false, reason: `No level ${lvl} slots left.` };
  return { ok: true, how: 'slot' };
}
export function applyCast(c, lvl, plan) {
  const m = ensureMagic(c);
  if (plan.how === 'pact') m.pact += 1;
  else if (plan.how === 'points') { m.spent += plan.cost; if (lvl === 5 || lvl === 6) m.strain[lvl] = (Number(m.strain[lvl]) || 0) + 1; }
  else if (plan.how === 'slot') m.slots[lvl] = (Number(m.slots[lvl]) || 0) + 1;
}
// Strain save DC (Table Rules): 10 + spell level; a failed save adds exhaustion equal to half the level, rounded down
export const strainDc = lvl => 10 + lvl;
export const strainExhaustion = lvl => Math.floor(lvl / 2);

// Spells this character can choose from: their classes' lists plus their subclasses' lists
export function availableSpells(c) {
  const clsIds = new Set((c.classes || []).map(k => k.clsId).filter(Boolean));
  const subIds = new Set((c.classes || []).map(k => k.subId).filter(Boolean));
  return L.all('spell').filter(s => (s.classes || []).some(x => clsIds.has(x)) || (s.subclasses || []).some(x => subIds.has(x)));
}
// Subclass spells (domain, oath) count as always prepared
export function alwaysPrepared(c, s) {
  const subIds = new Set((c.classes || []).map(k => k.subId).filter(Boolean));
  return (s.subclasses || []).some(x => subIds.has(x));
}
// Which class's ability a spell uses (first matching class with a spellcasting ability)
export function spellClass(c, s) {
  for (const k of c.classes || []) {
    const cls = L.get(k.clsId);
    if (cls && ((s.classes || []).includes(cls.id) || (s.subclasses || []).includes(k.subId))) return { k, cls };
  }
  return null;
}

// Rests
export function restoreAll(c) { const m = ensureMagic(c); m.spent = 0; m.slots = {}; m.pact = 0; m.strain = {}; }
export function restoreShort(c) { const m = ensureMagic(c); m.pact = 0; }
