// Fills a sheet from the race, class, subclass and background picked from the library.
//
// Auto-added items carry an `auto` key. Re-running keeps the ones that still apply (with any
// edits the player made), removes the ones that no longer apply, and adds what's new, so a
// level-up adds that level's features without touching anything typed by hand.
import * as L from './library.js';
import { getPath, setPath, stamp, uid } from './model.js';
import { ABIL_SHORT } from './rules.js';

const ARMOR = ['light', 'medium', 'heavy', 'shields'], WEAPONS = ['simple', 'martial'];

// Link the typed names to library entries (or unlink when the name no longer matches one)
export function resolvePicks(c) {
  const r = L.findByName('race', c.race); c.raceId = r?.id || '';
  const b = L.findByName('background', c.background); c.bgId = b?.id || '';
  for (const k of c.classes || []) {
    const cls = L.findByName('class', k.name); k.clsId = cls?.id || '';
    const sub = cls ? L.subclassesOf(cls.id).find(s => s.name.toLowerCase() === (k.sub || '').trim().toLowerCase()) : null;
    k.subId = sub?.id || '';
  }
}

export function syncAuto(c) {
  const touched = new Set();
  const added = { traits: 0, features: 0, other: 0, names: [] };
  const race = L.get(c.raceId);
  const raceChain = race ? [race.parent ? L.get(race.parent) : null, race].filter(Boolean) : [];
  const bg = L.get(c.bgId);
  const picks = (c.classes || []).map(k => ({ k, cls: L.get(k.clsId), sub: L.get(k.subId), lvl: Number(k.level) || 0 }));
  const first = picks.find(p => p.cls);

  /* ---- lists ---- */
  const want = { racial: [], classFeat: [], feats: [], defenses: [] };
  const abilWant = { str: [], dex: [], con: [], int: [], wis: [], cha: [] };
  const rule = (e, list) => { if (e?.note) want[list].push({ auto: `rule:${e.id}`, name: `Table Rules: ${e.name}`, text: e.note, rule: true, src: 'Table Rules' }); };
  for (const e of raceChain) {
    for (const t of e.traits || []) want.racial.push({ auto: `race:${e.id}:${t.name}`, name: t.name, text: t.text, src: e.name, ...(t.remind?.on ? { remind: t.remind } : {}) });
    rule(e, 'racial');
    for (const r of e.resist || []) want.defenses.push({ auto: `race:${e.id}:${r.kind}:${r.what}`, kind: r.kind || 'res', what: r.what, src: e.name });
    for (const b of e.abil || []) if (abilWant[b.a]) abilWant[b.a].push({ auto: `race:${e.id}:${b.a}`, src: 'Racial', note: e.name, v: Number(b.v) || 0 });
  }
  for (const p of picks) {
    if (p.cls) {
      for (const f of p.cls.features || []) if (f.lvl <= p.lvl) want.classFeat.push({ auto: `class:${p.cls.id}:${f.lvl}:${f.name}`, name: f.name, text: f.text, src: `${p.cls.name} ${f.lvl}`, lvl: f.lvl, ...(f.remind?.on ? { remind: f.remind } : {}) });
      rule(p.cls, 'classFeat');
    }
    if (p.sub) {
      for (const f of p.sub.features || []) if (f.lvl <= p.lvl) want.classFeat.push({ auto: `sub:${p.sub.id}:${f.lvl}:${f.name}`, name: f.name, text: f.text, src: `${p.sub.name} ${f.lvl}`, lvl: f.lvl, ...(f.remind?.on ? { remind: f.remind } : {}) });
      rule(p.sub, 'classFeat');
    }
  }
  if (bg?.feat) {
    const ft = L.get(bg.feat);
    if (ft) {
      want.feats.push({ auto: `bgfeat:${ft.id}`, name: ft.name, text: [ft.prereq ? `Prerequisite: ${ft.prereq}` : '', ft.desc].filter(Boolean).join('\n\n'), src: 'Background' });
      rule(ft, 'feats');
    }
  }
  if (bg) rule(bg, 'feats');

  for (const [list, items] of Object.entries(want)) {
    const cur = c[list] || [];
    const keys = new Set(items.map(i => i.auto));
    const keep = cur.filter(x => !x.auto || keys.has(x.auto));
    const have = new Set(keep.filter(x => x.auto).map(x => x.auto));
    const fresh = items.filter(i => !have.has(i.auto)).map(i => ({ ...i, id: uid() }));
    if (fresh.length || keep.length !== cur.length) {
      // auto items in library order first, then anything typed by hand
      // class and subclass features interleave by level; everything else keeps library order
      const order = new Map(items.map((i, n) => [i.auto, n]));
      const lvlOf = x => items[order.get(x.auto)]?.lvl ?? 0;
      const autos = [...keep.filter(x => x.auto), ...fresh].sort((a, b) => (list === 'classFeat' ? lvlOf(a) - lvlOf(b) : 0) || order.get(a.auto) - order.get(b.auto));
      c[list] = [...autos, ...keep.filter(x => !x.auto)];
      touched.add(list);
      if (list === 'racial') added.traits += fresh.length; else if (list === 'classFeat') added.features += fresh.filter(x => !x.rule).length; else { added.other += fresh.length; added.names.push(...fresh.filter(x => !x.rule).map(x => x.name ? `${x.name} (feat)` : `${x.what} ${x.kind === 'res' ? 'resistance' : x.kind === 'imm' ? 'immunity' : x.kind === 'vuln' ? 'vulnerability' : 'condition immunity'}`)); }
    }
  }
  for (const a of Object.keys(abilWant)) {
    const cur = c.abil[a].adj || [];
    const keys = new Set(abilWant[a].map(i => i.auto));
    const keep = cur.filter(x => !x.auto || keys.has(x.auto));
    const have = new Set(keep.filter(x => x.auto).map(x => x.auto));
    const fresh = abilWant[a].filter(i => !have.has(i.auto)).map(i => ({ ...i, id: uid() }));
    if (fresh.length || keep.length !== cur.length) { c.abil[a].adj = [...keep, ...fresh]; touched.add(`abil.${a}`); }
  }

  /* ---- single values: only replaced while they still hold the last auto value (or are empty) ---- */
  c.autoVals = c.autoVals || {};
  const DEFAULTS = { speed: '30 ft' };
  // append: for lists of words (languages, tools) a hand-typed value keeps it and gains the new words
  const setVal = (path, val, append = false) => {
    const prev = c.autoVals[path];
    const cur = getPath(c, path);
    if (val === undefined || val === null) val = '';
    if (cur === '' || cur == null || cur === prev || cur === DEFAULTS[path]) { if (cur !== val) { setPath(c, path, val); touched.add(path); } }
    else if (append && val && !String(cur).includes(val)) { setPath(c, path, `${cur}; ${val}`); touched.add(path); }
    c.autoVals[path] = val;
  };
  const speed = [...raceChain].reverse().find(e => e.speed)?.speed;
  if (race) setVal('speed', speed ? `${speed} ft` : '');
  if (race) setVal('vision', raceChain.map(e => e.vision).filter(Boolean).pop() || '');
  setVal('languages', [...raceChain.map(e => e.languages), bg?.languages ? `${bg.languages}` : ''].filter(Boolean).join(', '), true);
  setVal('profs.weaponsOther', [...raceChain.map(e => e.weaponsOther), first?.cls?.weaponsOther].filter(Boolean).join(', '), true);
  setVal('profs.tools', [...raceChain.map(e => e.tools), first?.cls?.tools, bg?.tools].filter(Boolean).join('; '), true);
  if (bg) { setVal('bgFeature.name', bg.feature?.name || ''); setVal('bgFeature.text', bg.feature?.text || ''); }
  if (first?.cls?.spellAbil && !c.spell.abil) { c.spell.abil = first.cls.spellAbil; touched.add('spell.abil'); }
  for (const p of picks) if (p.cls?.hd && Number(p.k.hd) !== Number(p.cls.hd)) { p.k.hd = p.cls.hd; touched.add('classes'); }

  /* ---- yes/no proficiencies: switch on what the picks grant, switch off what a previous pick granted ---- */
  const flags = new Set();
  const grant = e => {
    if (!e) return;
    for (const a of ARMOR) if (e.armor?.[a]) flags.add(`profs.${a}`);
    for (const w of WEAPONS) if (e.weapons?.[w]) flags.add(`profs.${w}`);
    for (const s of e.skills || []) flags.add(`skills.${s}`);
  };
  raceChain.forEach(grant); grant(first?.cls); grant(bg);
  for (const s of first?.cls?.saves || []) flags.add(`saves.${s}`);
  const prev = new Set(c.autoFlags || []);
  for (const p of prev) if (!flags.has(p)) {
    const v = getPath(c, p);
    if (p.startsWith('skills.')) { if (Number(v) === 1) { setPath(c, p, 0); touched.add(p); } }
    else if (v) { setPath(c, p, false); touched.add(p); }
  }
  for (const p of flags) {
    const v = getPath(c, p);
    if (p.startsWith('skills.')) { if (!Number(v)) { setPath(c, p, 1); touched.add(p); } }
    else if (!v) { setPath(c, p, true); touched.add(p); }
  }
  c.autoFlags = [...flags];

  for (const p of touched) stamp(c, p);
  stamp(c, 'autoVals'); stamp(c, 'autoFlags'); stamp(c, 'raceId'); stamp(c, 'bgId'); stamp(c, 'classes');
  return added;
}

// One-line description of what a pick will need the player to choose themselves
export function choicesFor(c) {
  const out = [];
  const race = L.get(c.raceId);
  for (const e of race ? [race.parent ? L.get(race.parent) : null, race].filter(Boolean) : []) {
    if (e.abilNote) out.push(`${e.name}: ${e.abilNote}`);
  }
  const first = (c.classes || []).map(k => L.get(k.clsId)).find(Boolean);
  if (first?.skillChoice) out.push(`${first.name} skills: ${first.skillChoice}`);
  for (const k of c.classes || []) {
    const cls = L.get(k.clsId);
    if (cls && !k.subId && (Number(k.level) || 0) >= (cls.subclassLevel || 3) && L.subclassesOf(cls.id).length) out.push(`${cls.name}: pick your subclass.`);
  }
  return out;
}
export const abilName = a => ABIL_SHORT[a] || a;
