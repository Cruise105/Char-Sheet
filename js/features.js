// Class and race features that change the numbers on their own (rules as written, SRD 5.1):
//   Unarmored Defense (Barbarian: 10 + Dex + Con, shield allowed; Monk: 10 + Dex + Wis, no shield)
//   Draconic Resilience (13 + Dex while unarmored)        Fighting Style: Defense (+1 AC in armor)
//   Unarmored Movement (Monk)   Fast Movement (Barbarian, not in heavy armor)   heavy armor you're too weak for
//   Rage (switched on from the sheet: Rage Damage on Strength melee attacks, resistance, advantage reminders)
//   Aura of Protection (Paladin 6)   Diamond Soul (Monk 14)   Remarkable Athlete (Champion 7)
//   Jack of All Trades (Bard 2)   Primal Champion (Barbarian 20)   Archery fighting style
// A feature counts when it's on the sheet (from the Library or typed in by hand) and the class is high enough.
// Nothing here is stored: it's worked out from the sheet each time, so it follows level-ups and changes.
// This file stays free of other imports so the Bestiary can load the rules too; the app hands it the Library.

let lookup = () => null;
/** The Character Sheet hands over its Library lookup (class tables, class option names). */
export function useLibrary(get) { if (typeof get === 'function') lookup = get; }

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const norm = s => String(s || '').toLowerCase().replace(/\s*\([^)]*\)/g, '').replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
const modOf = s => Math.floor((num(s) - 10) / 2);

/** Level in a class by its name ("Barbarian"), across a multiclass. */
export function classLevel(c, name) {
  const n = name.toLowerCase();
  return (c.classes || []).filter(k => String(k.name || lookup(k.clsId)?.name || '').trim().toLowerCase() === n).reduce((t, k) => t + num(k.level), 0);
}
/** Level in the class that has this subclass ("Champion"), or 0. */
function subLevel(c, name) {
  const n = name.toLowerCase();
  return (c.classes || []).filter(k => String(k.sub || lookup(k.subId)?.name || '').trim().toLowerCase() === n).reduce((t, k) => t + num(k.level), 0);
}
/** Does the sheet list this feature (class features, racial traits, feats, picked class options)? */
export function has(c, name) {
  const n = norm(name);
  for (const list of ['classFeat', 'racial', 'feats', 'extraFeat']) for (const f of c[list] || []) if (norm(f.name) === n) return true;
  for (const o of c.options || []) { const e = lookup(o.id); if (e && norm(e.name) === n) return true; }
  return false;
}
// A class table column's number at the character's level ("+15 ft." → 15), from the Library when it has it
function tableNum(c, cls, col) {
  for (const k of c.classes || []) {
    const e = lookup(k.clsId);
    if (!e || String(e.name).toLowerCase() !== cls.toLowerCase()) continue;
    const t = (e.table || []).find(x => String(x.name).trim().toLowerCase() === col.toLowerCase());
    if (!t) continue;
    const lvl = num(k.level);
    for (let i = Math.min(lvl, 20) - 1; i >= 0; i--) { const v = String(t.vals?.[i] ?? '').trim(); if (v) { const m = /[+-]?\d+/.exec(v); return m ? Number(m[0]) : null; } }
  }
  return null;
}
const stepAt = (lvl, steps) => { let v = 0; for (const [at, n] of steps) if (lvl >= at) v = n; return v; };

/* ---------- armor ---------- */
/** Wearing armor? (the default "armor" with no name and AC 10 is no armor at all) */
export function wearingArmor(c) {
  const a = c.ac || {};
  return a.mode !== 'unarmored' && !!(String(a.armorName || '').trim() || (a.base !== '' && a.base != null && num(a.base) !== 10) || (a.maxDex !== '' && a.maxDex != null));
}
/** Heavy armor: no Dexterity bonus at all */
export const heavyArmor = c => wearingArmor(c) && c.ac?.maxDex !== '' && c.ac?.maxDex != null && num(c.ac.maxDex) === 0;
const shieldInHand = c => num(c.ac?.shield) !== 0 && c.ac?.shieldOff !== true;

/**
 * The ways this character can work out AC without armor: [{ base, name, noShield }]. `score(a)` gives a score.
 * Base is before the shield and other bonuses.
 */
export function unarmoredOptions(c, score) {
  const dex = modOf(score('dex')), out = [];
  if (has(c, 'Unarmored Defense')) {
    const barb = classLevel(c, 'Barbarian') > 0, monk = classLevel(c, 'Monk') > 0;
    // typed in by hand for some other class: go by what its text says
    const txt = [...(c.classFeat || [])].filter(f => norm(f.name) === 'unarmored defense').map(f => String(f.text || '')).join(' ');
    if (barb || (!monk && /constitution/i.test(txt))) out.push({ base: 10 + dex + modOf(score('con')), name: 'Unarmored Defense (10 + Dex + Con)' });
    if (monk || (!barb && /wisdom/i.test(txt))) out.push({ base: 10 + dex + modOf(score('wis')), name: 'Unarmored Defense (10 + Dex + Wis)', noShield: true });
  }
  if (has(c, 'Draconic Resilience') && classLevel(c, 'Sorcerer') > 0) out.push({ base: 13 + dex, name: 'Draconic Resilience (13 + Dex)' });
  return out;
}
/** AC bonuses from features: [{ v, name }] */
export function acBonuses(c) {
  const out = [];
  if (wearingArmor(c) && has(c, 'Defense')) out.push({ v: 1, name: 'Fighting Style: Defense' });
  return out;
}

/* ---------- speed ---------- */
const MODES = /\b(fly|flying|swim|swimming|climb|climbing|burrow|burrowing)\b/i;
/** Walking speed after features, armor and exhaustion: { walk, typed, parts: [{ v, name }], text } */
export function speed(c, score, itemBonus = 0) {
  const raw = String(c.speed || '');
  const bits = raw.split(/\s*[,;]\s*/);
  const wi = bits.findIndex(b => !MODES.test(b) && /\d/.test(b));
  const typed = wi >= 0 ? num(/\d+/.exec(bits[wi])[0]) : 0;
  const parts = [];
  const unarmored = !wearingArmor(c) && !shieldInHand(c);
  const monk = classLevel(c, 'Monk'), barb = classLevel(c, 'Barbarian');
  if (monk >= 2 && unarmored && has(c, 'Unarmored Movement')) {
    const v = tableNum(c, 'Monk', 'Unarmored Movement') ?? stepAt(monk, [[2, 10], [6, 15], [10, 20], [14, 25], [18, 30]]);
    if (v) parts.push({ v, name: 'Unarmored Movement' });
  }
  if (barb >= 5 && !heavyArmor(c) && has(c, 'Fast Movement')) parts.push({ v: 10, name: 'Fast Movement' });
  if (itemBonus) parts.push({ v: itemBonus, name: 'Magic items and boons' });
  // heavy armor you aren't strong enough for (dwarves aren't slowed by heavy armor)
  const need = num(c.ac?.str);
  if (heavyArmor(c) && need && score('str') < need && !/dwarf/i.test(String(c.race || ''))) parts.push({ v: -10, name: `Heavy armor (needs Str ${need})` });
  let walk = Math.max(0, typed + parts.reduce((t, p) => t + p.v, 0));
  const exh = num(c.exhaustion);
  if (exh >= 5) { walk = 0; parts.push({ v: 0, name: 'Exhaustion: speed 0' }); }
  else if (exh >= 2) { walk = Math.floor(walk / 2); parts.push({ v: 0, name: 'Exhaustion: speed halved' }); }
  const text = wi >= 0 && walk !== typed ? bits.map((b, i) => (i === wi ? b.replace(/\d+/, String(walk)) : b)).join(', ') : raw;
  return { walk, typed, parts, text };
}

/* ---------- rage ---------- */
export const canRage = c => classLevel(c, 'Barbarian') > 0 && has(c, 'Rage');
export const raging = c => !!c.rage?.on && canRage(c);
/** Rages per long rest (Infinity at 20) */
export function ragesMax(c) {
  const lvl = classLevel(c, 'Barbarian');
  if (lvl >= 20) return Infinity;
  return tableNum(c, 'Barbarian', 'Rages') ?? stepAt(lvl, [[1, 2], [3, 3], [6, 4], [12, 5], [17, 6]]);
}
export const rageDamage = c => tableNum(c, 'Barbarian', 'Rage Damage') ?? stepAt(classLevel(c, 'Barbarian'), [[1, 2], [9, 3], [16, 4]]);

/* ---------- saves, checks, scores ---------- */
/** Extra to every saving throw: Aura of Protection (your Charisma modifier, at least +1) */
export function saveBonus(c, score) {
  if (classLevel(c, 'Paladin') >= 6 && has(c, 'Aura of Protection')) return { v: Math.max(1, modOf(score('cha'))), name: 'Aura of Protection' };
  return null;
}
/** Proficient in every saving throw (Diamond Soul) */
export const allSaves = c => classLevel(c, 'Monk') >= 14 && has(c, 'Diamond Soul');
/** Jack of All Trades */
export const jack = c => !!c.jack || (classLevel(c, 'Bard') >= 2 && has(c, 'Jack of All Trades'));
/** Remarkable Athlete: half proficiency (rounded up) on Str, Dex and Con checks you aren't proficient in */
export const athlete = c => subLevel(c, 'Champion') >= 7 && has(c, 'Remarkable Athlete');
/** Score raises from features: Primal Champion (+4 Str and Con, to at most 24) */
export function scoreRaise(c, a) {
  if ((a === 'str' || a === 'con') && classLevel(c, 'Barbarian') >= 20 && has(c, 'Primal Champion')) return { v: 4, max: 24, name: 'Primal Champion' };
  return null;
}
/** Archery fighting style: +2 to ranged weapon attacks */
export const archery = c => has(c, 'Archery');

/** Plain-words lines for what features are doing right now, for the sheet: [{ name, txt }] */
export function summary(c, score) {
  const out = [];
  if (raging(c)) out.push({ name: 'Rage', txt: `+${rageDamage(c)} damage on Strength melee weapon attacks; resistance to bludgeoning, piercing and slashing damage; advantage on Strength checks and saving throws; no spells or concentration` });
  const sb = saveBonus(c, score); if (sb) out.push({ name: sb.name, txt: `+${sb.v} to all saving throws` });
  if (allSaves(c)) out.push({ name: 'Diamond Soul', txt: 'proficient in all saving throws' });
  if (athlete(c)) out.push({ name: 'Remarkable Athlete', txt: 'half proficiency on Strength, Dexterity and Constitution checks you aren\'t proficient in' });
  if (classLevel(c, 'Barbarian') >= 7 && has(c, 'Feral Instinct')) out.push({ name: 'Feral Instinct', txt: 'advantage on initiative' });
  if (classLevel(c, 'Barbarian') >= 2 && has(c, 'Danger Sense')) out.push({ name: 'Danger Sense', txt: 'advantage on Dexterity saves against effects you can see (not blinded, deafened or incapacitated)' });
  if (archery(c)) out.push({ name: 'Archery', txt: '+2 to attack rolls with ranged weapons (attacks marked Ranged)' });
  return out;
}
