// D&D 5e (2014) math for the sheet. Everything here is pure: give it a character, get numbers back.

import * as F from './features.js';
export { F };

export const ABILS = [
  ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
  ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma'],
];
export const ABIL_SHORT = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' };

export const SKILLS = [
  ['acrobatics', 'Acrobatics', 'dex'], ['animal', 'Animal Handling', 'wis'], ['arcana', 'Arcana', 'int'],
  ['athletics', 'Athletics', 'str'], ['deception', 'Deception', 'cha'], ['history', 'History', 'int'],
  ['insight', 'Insight', 'wis'], ['intimidation', 'Intimidation', 'cha'], ['investigation', 'Investigation', 'int'],
  ['medicine', 'Medicine', 'wis'], ['nature', 'Nature', 'int'], ['perception', 'Perception', 'wis'],
  ['performance', 'Performance', 'cha'], ['persuasion', 'Persuasion', 'cha'], ['religion', 'Religion', 'int'],
  ['sleight', 'Sleight of Hand', 'dex'], ['stealth', 'Stealth', 'dex'], ['survival', 'Survival', 'wis'],
];

// Inventory Tracker categories, in the order of the paper tracker
export const INV_CATS = [
  ['armor', 'Armor & Clothing'], ['weapons', 'Weapons'], ['tools', 'Tools & Kits'],
  ['treasure', 'Treasure & Trinkets'], ['components', 'Spell Components'], ['general', 'General Items'],
];
export const COINS = [['cp', 'Copper'], ['sp', 'Silver'], ['ep', 'Electrum'], ['gp', 'Gold'], ['pp', 'Platinum']];
const COIN_CP = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

export const DEFENSE_KINDS = [
  ['res', 'Resistances'], ['imm', 'Immunities'], ['vuln', 'Vulnerabilities'], ['cond', 'Condition immunities'],
];

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const mod = score => Math.floor((num(score) - 10) / 2);
export const sign = n => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/* ---------- effects: what magic items (attuned, or not needing it), diseases and boons do to the numbers ----------
   Each effect arrives with its source from the DM's apps ({ k, on, v, txt }); see core/effects.js for the kinds. */
const fxCache = new WeakMap();
export function activeFx(c) {
  const hit = fxCache.get(c);
  if (hit && hit.mi === c.magicItems && hit.sn === c.sn && hit.b === c.boons) return hit.fx;
  const fx = [];
  for (const m of c.magicItems || []) if (!m.needsAttune || m.attuned) for (const e of m.fx || []) fx.push({ ...e, src: m.name, item: m.name });
  for (const d of c.sn?.diseases || []) for (const e of d.fx || []) fx.push({ ...e, src: d.name });
  for (const b of c.boons || []) for (const e of b.fx || []) fx.push({ ...e, src: b.name });
  fxCache.set(c, { mi: c.magicItems, sn: c.sn, b: c.boons, fx });
  return fx;
}
const fxSum = (c, k, on) => activeFx(c).filter(e => e.k === k && (on == null || e.on === on || e.on === 'all')).reduce((t, e) => t + num(e.v), 0);
// The effects behind one number, for "where does this come from" lines ("Chickenpox −2")
export const fxFor = (c, k, on) => activeFx(c).filter(e => e.k === k && (on == null || e.on === on || e.on === 'all'));

export function baseScore(c, a) {
  const ab = c.abil?.[a] || {};
  return num(ab.base) + (ab.adj || []).reduce((t, x) => t + num(x.v), 0);
}
export function score(c, a) {
  let s = baseScore(c, a) + fxSum(c, 'abil', a);
  const r = F.scoreRaise(c, a); // Primal Champion: +4, to at most 24
  if (r) s = s >= r.max ? s : Math.min(r.max, s + r.v);
  for (const e of fxFor(c, 'abilSet', a)) s = Math.max(s, num(e.v)); // "Your Strength score is 19" never lowers it
  return s;
}
export const amod = (c, a) => (a && ABIL_SHORT[a] ? mod(score(c, a)) : 0);

export function totalLevel(c) {
  const t = (c.classes || []).reduce((s, k) => s + num(k.level), 0);
  return Math.max(1, Math.min(20, t || 1));
}
export function prof(c) {
  if (c.profOverride !== '' && c.profOverride != null && Number.isFinite(Number(c.profOverride))) return Number(c.profOverride);
  return Math.ceil(totalLevel(c) / 4) + 1;
}

export const save = (c, a) => amod(c, a) + (c.saves?.[a] || F.allSaves(c) ? prof(c) : 0) + fxSum(c, 'save', a) + (F.saveBonus(c, x => score(c, x))?.v || 0);

export function skill(c, key) {
  const def = SKILLS.find(s => s[0] === key);
  const rank = num(c.skills?.[key]);
  const p = prof(c);
  // not proficient: Jack of All Trades (half, rounded down) or Remarkable Athlete on Str/Dex/Con (half, rounded up)
  const half = Math.max(F.jack(c) ? Math.floor(p / 2) : 0, F.athlete(c) && ['str', 'dex', 'con'].includes(def[2]) ? Math.ceil(p / 2) : 0);
  let bonus = rank === 2 ? p * 2 : rank === 1 ? p : half;
  return amod(c, def[2]) + bonus + fxSum(c, 'check', 'all');
}
export const passivePerception = c => 10 + skill(c, 'perception');
export const initiative = c => amod(c, 'dex') + num(c.init?.misc) + Math.max(F.jack(c) ? Math.floor(prof(c) / 2) : 0, F.athlete(c) ? Math.ceil(prof(c) / 2) : 0) + fxSum(c, 'check', 'all');

export function armorClass(c) {
  const a = c.ac || {};
  const dex = amod(c, 'dex');
  // a shield counts only while it's in hand (the sheet's Shield switch; on unless turned off)
  const shield = num(a.shield), on = shield !== 0 && a.shieldOff !== true;
  // without armor: the best of 10 + Dex and what the character's features allow (Unarmored Defense and the like)
  const baseFor = withShield => {
    if (F.wearingArmor(c)) {
      const cap = a.maxDex === '' || a.maxDex == null ? Infinity : num(a.maxDex);
      return { base: num(a.base || 10) + Math.min(dex, cap), how: a.armorName || 'Armor' };
    }
    let best = { base: 10 + dex + (a.unarmoredAbil ? amod(c, a.unarmoredAbil) : 0), how: a.unarmoredAbil ? `10 + Dex + ${ABIL_SHORT[a.unarmoredAbil]}` : '10 + Dex' };
    // a typed-in base with no armor named: never lower the AC below what was typed
    if (a.mode !== 'unarmored' && num(a.base || 10) + dex > best.base) best = { base: num(a.base || 10) + dex, how: `${num(a.base || 10)} + Dex` };
    // features win a tie, so the sheet says where the number comes from
    for (const o of F.unarmoredOptions(c, x => score(c, x))) if (!(o.noShield && withShield) && o.base >= best.base) best = { base: o.base, how: o.name };
    return best;
  };
  const feat = F.acBonuses(c), featV = feat.reduce((t, x) => t + x.v, 0);
  const extra = num(a.misc) + fxSum(c, 'ac') + featV;
  const b = baseFor(on), total = b.base + (on ? shield : 0) + extra;
  // the other way round (shield stowed, or taken up): a Monk's Unarmored Defense changes with it
  const alt = shield ? baseFor(!on).base + (on ? 0 : shield) + extra + num(a.temp) : null;
  return { total, withTemp: total + num(a.temp), shield, shieldOn: on, other: alt, how: b.how, feat };
}

// kind: 'spell' for spells, 'ki' for class feature DCs (Ki and the like)
export const saveDc = (c, a, kind = 'spell') => (a ? 8 + prof(c) + amod(c, a) + fxSum(c, 'dc', kind) : null);
/** Walking speed after features, armor and exhaustion: { walk, typed, parts, text } */
export const speedInfo = c => F.speed(c, x => score(c, x), fxSum(c, 'speed'));

export const spellAttack = (c, a) => (a ? prof(c) + amod(c, a) + fxSum(c, 'spellatk') : null);
// effects that only count for attacks made with that item ("+1 bonus to attack and damage rolls made with this weapon")
const baseName = s => String(s || '').toLowerCase().replace(/\s*,?\s*[+]\d+\b/g, '').replace(/\s*\([^)]*\)/g, '').trim();
function itemFx(c, k, atk) {
  const an = baseName(atk.name);
  if (!an) return 0;
  return activeFx(c).filter(e => e.k === k && e.on === 'self' && e.item).filter(e => { const n = baseName(e.item); return n && (an.includes(n) || n.includes(an)); })
    .reduce((t, e) => t + num(e.v), 0) + activeFx(c).filter(e => e.k === k && e.on === 'all').reduce((t, e) => t + num(e.v), 0);
}

// Attacks: ability can be str, dex, finesse (better of the two), spell (the spellcasting ability), or none
export function attackAbil(c, atk) {
  if (atk.abil === 'finesse') return amod(c, 'str') >= amod(c, 'dex') ? 'str' : 'dex';
  if (atk.abil === 'spell') return c.spell?.abil || '';
  return atk.abil || '';
}
export function attackBonus(c, atk) {
  return amod(c, attackAbil(c, atk)) + (atk.prof ? prof(c) : 0) + num(atk.bonus) + itemFx(c, 'atk', atk) + (atk.ranged && F.archery(c) ? 2 : 0);
}
export function damageText(c, atk) {
  const dice = (atk.dmg || '').trim();
  // Rage Damage: melee weapon attacks using Strength, while raging
  const rage = F.raging(c) && !atk.ranged && attackAbil(c, atk) === 'str' ? F.rageDamage(c) : 0;
  const m = (atk.addMod ? amod(c, attackAbil(c, atk)) : 0) + itemFx(c, 'dmg', atk) + rage;
  const parts = [];
  if (dice) parts.push(m ? `${dice} ${m > 0 ? '+' : '−'} ${Math.abs(m)}` : dice);
  else if (atk.addMod) parts.push(String(m));
  if (atk.type) parts.push(atk.type);
  return parts.join(' ');
}

/* ---------- carrying ---------- */
export const coinCount = c => COINS.reduce((t, [k]) => t + num(c.coins?.[k]), 0);
export const coinWeight = c => coinCount(c) / 100; // the table's tracker: 100 coins = 1 lb
export function rowWeight(r) { return num(r.wt) * (r.qty === '' || r.qty == null ? 1 : num(r.qty)); }
export function carried(c) {
  let w = coinWeight(c);
  for (const [k] of INV_CATS) for (const r of c.inv?.[k] || []) w += rowWeight(r);
  for (const m of c.magicItems || []) w += Number(m.weight) || 0; // items the DM's magic item app gave this character
  // infused items that are new objects (Replicate Magic Item): the artificer's own, and ones others gave them
  for (const i of c.infused || []) if (!i.holder || i.holder === c.id) w += Number(i.weight) || 0;
  for (const i of c.infusedHeld || []) w += Number(i.weight) || 0;
  return Math.round(w * 100) / 100;
}
export const capacity = c => score(c, 'str') * 15 * (c.powerful ? 2 : 1);

// Turn copper, silver, electrum and gold into the fewest gold/silver/copper coins. Platinum is left alone.
export function consolidateCoins(coins) {
  const cp = ['cp', 'sp', 'ep', 'gp'].reduce((t, k) => t + num(coins[k]) * COIN_CP[k], 0);
  return { ...coins, gp: Math.floor(cp / 100), sp: Math.floor((cp % 100) / 10), ep: 0, cp: cp % 10 };
}

// XP needed to reach each level (index = current level): XP_TABLE[1] is what level 2 needs
export const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000, null];
export const hitDiceTotal = c => (c.classes || []).map(k => ({ die: num(k.hd) || 8, total: num(k.level), used: num(k.hdUsed), name: k.name }));
