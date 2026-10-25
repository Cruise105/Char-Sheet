// Class options: Eldritch Invocations, Metamagic, Fighting Styles, Infusions, Maneuvers and the like.
//
// A class or subclass entry lists its option groups and how many picks it gives at each level
// (optionGroups: [{ group, levels: { "2": 2, "5": 3 } }]). Each option is its own Library entry
// (type "option") naming its group, the classes/subclasses it belongs to, and any prerequisites.
// A character's picks live in c.options: [{ id, group }].
import * as L from './library.js';

// How many picks a table of { level: count } gives at a level
export function countAt(levels, lvl) {
  let n = 0, best = -1;
  for (const [k, v] of Object.entries(levels || {})) {
    const at = Number(k);
    if (at <= lvl && at > best) { best = at; n = Number(v) || 0; }
  }
  return n;
}

// "2:2, 5:3" <-> { "2": 2, "5": 3 } for the Library editor
export const levelsToText = lv => Object.entries(lv || {}).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}: ${v}`).join(', ');
export function textToLevels(t) {
  const out = {};
  for (const m of String(t || '').matchAll(/(\d+)\s*[:=]\s*(\d+)/g)) out[String(Number(m[1]))] = Number(m[2]);
  return out;
}

// The class rows a character has, with their library entries
function rows(c) {
  return (c.classes || []).map(k => ({ k, lvl: Number(k.level) || 0, cls: L.get(k.clsId), sub: L.get(k.subId) })).filter(r => r.cls || r.sub);
}
// Level of the class an option belongs to (its owner may be the class or one of its subclasses)
function ownerLevel(c, opt) {
  let lvl = -1;
  for (const r of rows(c)) if ((opt.owners || []).some(o => o === r.cls?.id || o === r.sub?.id)) lvl = Math.max(lvl, r.lvl);
  return lvl;
}

// Every option group this character has, with how many they get and what they've picked
export function groupsFor(c) {
  const g = new Map();
  for (const r of rows(c)) {
    for (const src of [r.cls, r.sub].filter(Boolean)) {
      for (const og of src.optionGroups || []) {
        if (!og.group) continue;
        const cur = g.get(og.group) || { group: og.group, count: 0, owners: new Set() };
        cur.count += countAt(og.levels, r.lvl);
        cur.owners.add(src.id);
        if (r.cls) cur.owners.add(r.cls.id);
        g.set(og.group, cur);
      }
    }
  }
  const picks = c.options || [];
  return [...g.values()].map(x => {
    const chosen = picks.filter(p => p.group === x.group).map(p => L.get(p.id) || { id: p.id, name: '(removed from the Library)', group: x.group, missing: true });
    return { ...x, owners: [...x.owners], chosen };
  }).filter(x => x.count > 0 || x.chosen.length);
}

// Why an option can't be picked yet ('' when it can)
export function blockedBy(c, opt) {
  const lvl = ownerLevel(c, opt);
  if (lvl < 0) return 'Not for your class';
  if (Number(opt.level) && lvl < Number(opt.level)) return `Needs level ${opt.level}`;
  if (opt.reqOption && !(c.options || []).some(p => p.id === opt.reqOption)) return `Needs ${L.get(opt.reqOption)?.name || 'another option'}`;
  return '';
}

// Options in a group this character could choose from (already-picked ones left out)
export function choicesIn(c, group) {
  const taken = new Set((c.options || []).map(p => p.id));
  return L.all('option').filter(o => o.group === group && !taken.has(o.id) && ownerLevel(c, o) >= 0)
    .map(o => ({ o, why: blockedBy(c, o) }))
    .sort((a, b) => (a.why ? 1 : 0) - (b.why ? 1 : 0) || a.o.name.localeCompare(b.o.name));
}

// Lines for the reminder list under the sheet header: "Eldritch Invocations: choose 1 more"
export function pending(c) {
  return groupsFor(c).filter(x => x.chosen.length < x.count)
    .map(x => `${x.group}: choose ${x.count - x.chosen.length} more (Class options).`);
}
// Snapshot of counts, to tell after a level up what's new
export const counts = c => Object.fromEntries(groupsFor(c).map(x => [x.group, x.count]));
