// Library screen: browse and read entries; the DM also adds and edits them.
import * as L from './library.js';
import { getPath, setPath } from './model.js';
import { ABILS, SKILLS, DEFENSE_KINDS } from './rules.js';
import { esc, REMIND_ON } from './sheet.js';
import { levelsToText, textToLevels } from './options.js';
import * as T from './tables.js';

let ctx; // { toast, isDm(), confirm }
const st = { type: 'race', q: '', sel: null, draft: null };
let root;

export function initLibrary(el, helpers) {
  root = el; ctx = helpers;
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('click', onClick);
  L.onLibraryChange(() => { if (root.offsetParent && !st.draft) render(); });
}
export function showLibrary(id = null) {
  if (id) { const e = L.get(id); if (e) { st.type = e.type; st.sel = id; } }
  st.draft = null;
  render();
}

/* ---------- reading an entry (also used by the sheet's info buttons) ---------- */
const para = t => esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const names = arr => arr.map(k => SKILLS.find(s => s[0] === k)?.[1] || k).join(', ');
const yes = (o, keys, labels) => keys.filter(k => o?.[k]).map(k => labels[k]).join(', ');
const ARMOR_L = { light: 'Light armor', medium: 'Medium armor', heavy: 'Heavy armor', shields: 'Shields' };
const WEAP_L = { simple: 'Simple weapons', martial: 'Martial weapons' };
const ABIL_N = Object.fromEntries(ABILS);

export function entryHtml(e) {
  if (!e) return '<p class="empty">Not in the library.</p>';
  const facts = [];
  const add = (k, v) => { if (v) facts.push(`<div><dt>${k}</dt><dd>${v}</dd></div>`); };
  const parent = e.parent ? L.get(e.parent) : null;
  if (e.type === 'race') {
    if (parent) add('Subrace of', esc(parent.name));
    add('Speed', esc(L.speedText(parent ? [parent, e] : [e]))); add('Size', esc(e.size)); add('Vision', esc(e.vision));
    add('Ability scores', [e.abil?.map(b => `${ABIL_N[b.a]} +${b.v}`).join(', '), esc(e.abilNote)].filter(Boolean).join('. '));
    add('Languages', esc(e.languages)); add('Skills', names(e.skills || []));
    add('Proficiencies', [yes(e.armor, Object.keys(ARMOR_L), ARMOR_L), yes(e.weapons, Object.keys(WEAP_L), WEAP_L), esc(e.weaponsOther), esc(e.tools)].filter(Boolean).join('; '));
    add('Defenses', (e.resist || []).map(r => `${esc(r.what)} ${DEFENSE_KINDS.find(d => d[0] === r.kind)?.[1].toLowerCase().replace(/s$/, '') || ''}`).join(', '));
  }
  if (e.type === 'class') {
    add('Hit die', `d${e.hd}`); add('Saving throws', (e.saves || []).map(a => ABIL_N[a]).join(', '));
    add('Armor', yes(e.armor, Object.keys(ARMOR_L), ARMOR_L)); add('Weapons', [yes(e.weapons, Object.keys(WEAP_L), WEAP_L), esc(e.weaponsOther)].filter(Boolean).join(', '));
    add('Tools', esc(e.tools)); add('Skills', esc(e.skillChoice)); add('Spellcasting ability', ABIL_N[e.spellAbil] || '');
    add('Subclass at level', esc(e.subclassLevel));
    const subs = L.subclassesOf(e.id); add('Subclasses', subs.map(s => `<button class="linkbtn" type="button" data-libopen="${s.id}">${esc(s.name)}</button>`).join(' · '));
  }
  if (e.type === 'subclass') add('Class', parent ? `<button class="linkbtn" type="button" data-libopen="${parent.id}">${esc(parent.name)}</button>` : '');
  if (e.type === 'background') {
    add('Skills', names(e.skills || [])); add('Tools', esc(e.tools)); add('Languages', esc(e.languages)); add('Equipment', esc(e.equipment));
    const ft = L.get(e.feat); add('Background feat', ft ? `<button class="linkbtn" type="button" data-libopen="${ft.id}">${esc(ft.name)}</button>` : (e.feat ? 'Missing from the library' : ''));
  }
  if (e.type === 'feat') add('Prerequisite', esc(e.prereq));
  if (e.type === 'option') {
    add('Group', esc(e.group));
    add('For', (e.owners || []).map(id => L.get(id)?.name).filter(Boolean).map(esc).join(', '));
    add('Class level', Number(e.level) ? esc(e.level) : '');
    const req = L.get(e.reqOption); add('Requires', req ? `<button class="linkbtn" type="button" data-libopen="${req.id}">${esc(req.name)}</button>` : '');
    add('Prerequisite', esc(e.prereq));
    if (e.infusion) add('Infusion', `An Artificer can put it into an item${e.infAttune && !e.itemSnap ? '; the item requires attunement' : ''}.`);
    if (e.itemSnap) add('Makes', `${esc(e.itemSnap.name)} <small>(${esc([e.itemSnap.type, e.itemSnap.attune].filter(Boolean).join(' · '))})</small>`);
  }
  if ((e.type === 'class' || e.type === 'subclass') && (e.optionGroups || []).length) add('Class options', e.optionGroups.map(g => `${esc(g.group)} <small>(${esc(levelsToText(g.levels))})</small>`).join('<br>'));
  if (e.type === 'spell') {
    add('Level', `${e.level ? `Level ${e.level}` : 'Cantrip'} ${esc(e.school || '')}`.trim());
    add('Casting time', esc(e.time) + (e.ritual ? ' (ritual)' : ''));
    add('Range', esc(e.range)); add('Components', esc(e.components) + (e.material ? ` (${esc(e.material)})` : ''));
    add('Duration', (e.conc ? 'Concentration, ' : '') + esc(e.duration));
    add('Lists', [...(e.classes || []), ...(e.subclasses || [])].map(id => L.get(id)?.name).filter(Boolean).map(esc).join(', '));
  }
  if (e.type === 'boon') { add('Given to', e.given === 'party' ? 'The whole party' : (Array.isArray(e.given) ? e.given.map(id => ctx.chars?.().find(x => x.id === id)?.name).filter(Boolean).map(esc).join(', ') : '')); add('At each dawn', Number(e.dawnTemp) ? `${esc(e.dawnTemp)} temporary HP` : ''); }
  if (e.type === 'language') { add('Type', esc(e.kind)); add('Script', esc(e.script)); add('Typical speakers', esc(e.speakers)); }
  const list = (title, items, lvl) => items?.length ? `<h3>${title}</h3>${items.map(f => `<section class="lfeat"><h4>${lvl ? `<span class="lv">${f.lvl}</span>` : ''}${esc(f.name)}</h4>${para(f.text)}</section>`).join('')}` : '';
  return `
    <article class="entry">
      <header><h2>${esc(e.name)}</h2><p class="sub">${esc(L.typeName(e.type))}${e.src ? ` · ${esc(e.src)}` : ''}</p></header>
      ${e.note ? `<aside class="rulenote"><b>Table Rules</b>${para(e.note)}</aside>` : ''}
      ${facts.length ? `<dl class="facts">${facts.join('')}</dl>` : ''}
      ${e.type === 'background' && e.feature?.name ? `<h3>Feature: ${esc(e.feature.name)}</h3>${para(e.feature.text)}` : ''}
      ${e.desc ? (e.type === 'class' ? `<section class="classdesc">${para(e.desc)}</section>` : para(e.desc)) : ''}
      ${e.type === 'class' || e.type === 'subclass' ? T.tableHtml(e, esc) : ''}
      ${e.type === 'class' && e.equipment ? `<section class="equipbox"><h3>Starting equipment</h3>${para(e.equipment)}</section>` : ''}
      ${e.type === 'option' && e.itemSnap ? `<h3>${esc(e.itemSnap.name)}</h3><p class="sub">${esc([e.itemSnap.type, e.itemSnap.attune].filter(Boolean).join(' · '))}</p>${para(e.itemSnap.desc)}` : ''}
      ${e.higher ? `<p><b>At Higher Levels.</b></p>${para(e.higher)}` : ''}
      ${e.langNote ? para(e.langNote) : ''}
      ${list('Traits', e.traits)}
      ${list('Features by level', e.features, true)}
      ${(e.tables || []).filter(t => (t.rows || []).length).map(t => `${t.feature ? `<p class="hint">With ${esc(t.feature)}</p>` : ''}${T.extraTableHtml(t, esc)}`).join('')}
    </article>`;
}

/* ---------- the screen ---------- */
function render() {
  const dm = ctx.isDm();
  const items = L.all(st.type).filter(e => !st.q || e.name.toLowerCase().includes(st.q.toLowerCase()));
  const sel = st.sel && L.get(st.sel)?.type === st.type ? L.get(st.sel) : null;
  root.innerHTML = `
    <aside class="libside">
      <div class="seg libtypes" role="group" aria-label="Entry type">${L.TYPES.map(([k, n]) => `<button type="button" data-ltype="${k}" aria-pressed="${st.type === k}">${n}</button>`).join('')}</div>
      <input class="f" type="search" data-lq value="${esc(st.q)}" placeholder="Search ${L.TYPES.find(t => t[0] === st.type)[1].toLowerCase()}" aria-label="Search">
      ${dm ? `<button class="btn primary" type="button" data-lnew>New ${L.typeName(st.type).toLowerCase()}</button>` : ''}
      <ul class="liblist">${items.map(e => `<li><button type="button" data-lsel="${e.id}" aria-current="${e.id === st.sel}">
        <span>${esc(e.name)}${e.parent && e.type === 'race' ? ` <small>${esc(L.get(e.parent)?.name || '')}</small>` : ''}${e.type === 'subclass' ? ` <small>${esc(L.get(e.parent)?.name || '')}</small>` : ''}${e.type === 'option' ? ` <small>${esc(e.group || '')}</small>` : ''}${e.type === 'spell' ? ` <small>${e.level ? `Lv ${e.level}` : 'Cantrip'}</small>` : ''}</span>
        <small class="srcb">${e.builtIn ? 'SRD' : esc(e.src || (e.overridesSrd ? 'SRD, edited' : 'Yours'))}</small></button></li>`).join('') || '<li class="empty">Nothing here yet.</li>'}</ul>
    </aside>
    <section class="libmain">${st.draft || sel ? `<button class="linkbtn libback" type="button" data-lback>All ${L.TYPES.find(t => t[0] === st.type)[1].toLowerCase()}</button>` : ''}${st.draft ? editorHtml(st.draft) : sel ? `
      ${dm ? `<div class="row libacts"><button class="btn" type="button" data-ledit>Edit</button><button class="btn" type="button" data-ldup>Duplicate</button>
        ${sel.builtIn ? '' : sel.overridesSrd ? '<button class="btn" type="button" data-ldel>Restore SRD version</button>' : '<button class="btn danger" type="button" data-ldel>Delete</button>'}</div>` : ''}
      ${entryHtml(sel)}` : `<div class="libempty"><p>${items.length ? 'Choose an entry to read it.' : dm ? `No ${L.TYPES.find(t => t[0] === st.type)[1].toLowerCase()} yet. Add one with the button on the left.` : 'Nothing here yet.'}</p></div>`}</section>`;
  root.dataset.mode = st.draft || sel ? 'entry' : 'list';
}

/* ---------- editor ---------- */
const FIELDS = {
  race: [['name', 'Name'], ['parent', 'Subrace of', 'raceParent'], ['src', 'Book and page'], ['speed', 'Walking speed (ft)', 'num'], ['speeds', 'Other speeds (ft)', 'speeds'], ['size', 'Size'], ['vision', 'Vision', 'text', 'Darkvision 60 ft'],
    ['abil', 'Ability score increases', 'abil'], ['abilNote', 'Ability choice the player makes', 'text', 'Choose 2 other ability scores to increase by 1.'], ['languages', 'Languages', 'text', 'Common, Elvish'],
    ['skills', 'Skill proficiencies', 'skills'], ['armor', 'Armor', 'armor'], ['weapons', 'Weapons', 'weapons'], ['weaponsOther', 'Other weapons'], ['tools', 'Tools'],
    ['resist', 'Resistances and immunities', 'resist'], ['traits', 'Traits', 'named'], ['desc', 'Description', 'area'], ['tables', 'Tables: random rolls (d6, d100…), by level, or plain', 'xtables'], ['note', 'Table Rules note', 'area']],
  class: [['name', 'Name'], ['src', 'Book and page'], ['hd', 'Hit die', 'hd'], ['saves', 'Saving throws', 'saves'], ['armor', 'Armor', 'armor'], ['weapons', 'Weapons', 'weapons'],
    ['weaponsOther', 'Other weapons'], ['tools', 'Tools'], ['skillChoice', 'Skill choice', 'text', 'Choose two from …'], ['spellAbil', 'Spellcasting ability', 'abilSel'],
    ['equipment', 'Starting equipment', 'area', '- (a) a rapier or (b) a longsword\n- Leather armor and a dagger'],
    ['caster', 'Spellcasting type', 'casterSel'], ['asi', 'Ability Score Improvement levels', 'numlist', '4, 8, 12, 16, 19'],
    ['subclassLevel', 'Subclass chosen at level', 'num'], ['optionGroups', 'Class option choices (Invocations, Metamagic, Infusions…)', 'optgroups'], ['table', 'Level table (the class table, 1st to 20th)', 'ctable'], ['tables', 'Other tables: random rolls (d6, d100…), your own levels, or plain', 'xtables'], ['features', 'Features', 'leveled'], ['desc', 'Description', 'area'], ['note', 'Table Rules note', 'area']],
  subclass: [['name', 'Name'], ['parent', 'Class', 'classSel'], ['src', 'Book and page'], ['caster', 'Makes the class a spellcaster', 'casterSub'], ['spellAbil', 'Spellcasting ability', 'abilSel'],
    ['optionGroups', 'Class option choices (Maneuvers, Runes, Fighting Styles…)', 'optgroups'], ['table', 'Level table columns (1st to 20th, shown with the class\'s)', 'ctable'], ['tables', 'Other tables: random rolls (d6, d100…), your own levels, or plain', 'xtables'],
    ['features', 'Features', 'leveled'], ['desc', 'Description', 'area'], ['note', 'Table Rules note', 'area']],
  option: [['name', 'Name'], ['group', 'Group', 'groupText', 'Eldritch Invocations'], ['src', 'Book and page'], ['owners', 'Which classes and subclasses can choose it', 'ownerMulti'],
    ['level', 'Class level needed (0 for none)', 'num'], ['reqOption', 'Requires another option first', 'optionSel'], ['prereq', 'Other prerequisite (shown, not checked)', 'text', 'The eldritch blast cantrip'],
    ['desc', 'Full text', 'area'], ['infusion', 'Infusion: an Artificer puts it into an item', 'bool'], ['infAttune', 'The infused item requires attunement', 'bool'],
    ['item', 'Magic item it makes (Replicate Magic Item)', 'miItem'], ['remind', 'Reminder', 'remindOne'], ['tables', 'Tables: random rolls (d6, d100…), by level, or plain', 'xtables'], ['note', 'Table Rules note', 'area']],
  spell: [['name', 'Name'], ['level', 'Level (0 = cantrip)', 'num'], ['school', 'School'], ['src', 'Book and page'], ['time', 'Casting time'], ['range', 'Range'],
    ['components', 'Components', 'text', 'V, S, M'], ['material', 'Material'], ['duration', 'Duration'], ['conc', 'Concentration', 'bool'], ['ritual', 'Ritual', 'bool'],
    ['classes', 'Class spell lists', 'classMulti'], ['subclasses', 'Subclass lists (domain, oath, expanded spells)', 'subMulti'],
    ['desc', 'Full text', 'area'], ['higher', 'At Higher Levels', 'area'], ['tables', 'Tables: random rolls (d6, d100…), by level, or plain', 'xtables'], ['note', 'Table Rules note', 'area']],
  background: [['name', 'Name'], ['src', 'Book and page'], ['skills', 'Skill proficiencies', 'skills'], ['tools', 'Tools'], ['languages', 'Languages'],
    ['feature.name', 'Feature name'], ['feature.text', 'Feature text', 'area'], ['feat', 'Assigned feat', 'featSel'], ['equipment', 'Equipment', 'area'], ['desc', 'Description', 'area'], ['tables', 'Tables: random rolls (d6, d100…), by level, or plain', 'xtables'], ['note', 'Table Rules note', 'area']],
  feat: [['name', 'Name'], ['src', 'Book and page'], ['prereq', 'Prerequisite'], ['desc', 'Full text', 'area'], ['tables', 'Tables: random rolls (d6, d100…), by level, or plain', 'xtables'], ['note', 'Table Rules note', 'area']],
  boon: [['name', 'Name'], ['given', 'Given to', 'given'], ['dawnTemp', 'Temp HP at each dawn (0 for none)', 'num'], ['desc', 'Full text', 'area'], ['tables', 'Tables: random rolls (d6, d100…), by level, or plain', 'xtables'], ['note', 'Table Rules note', 'area']],
  language: [['name', 'Name'], ['kind', 'Type', 'langKind'], ['script', 'Script'], ['speakers', 'Typical speakers'], ['src', 'Book and page'], ['desc', 'Description', 'area'], ['note', 'Table Rules note', 'area']],
};

function editorHtml(d) {
  const f = (path, label, kind = 'text', ph = '') => {
    const v = getPath(d, path);
    const lab = `<span class="lbl">${label}</span>`;
    const opt = (list, cur) => list.map(([k, n]) => `<option value="${esc(k)}" ${String(cur ?? '') === String(k) ? 'selected' : ''}>${esc(n)}</option>`).join('');
    switch (kind) {
      case 'area': return `<label class="hf wide">${lab}<textarea class="f" data-f="${path}" rows="${path === 'note' ? 3 : 6}" placeholder="${esc(ph)}">${esc(v)}</textarea>${path === 'note' ? '<span class="hint">Shown in its own box under the official text, everywhere this entry appears.</span>' : ''}</label>`;
      case 'num': return `<label class="hf">${lab}<input class="f n" data-f="${path}" data-num inputmode="numeric" value="${esc(v)}"></label>`;
      case 'hd': return `<label class="hf">${lab}<select class="f" data-f="${path}" data-num>${opt([6, 8, 10, 12].map(n => [n, `d${n}`]), v)}</select></label>`;
      case 'abilSel': return `<label class="hf">${lab}<select class="f" data-f="${path}">${opt([['', 'None'], ...ABILS], v)}</select></label>`;
      case 'given': {
        const party = v === 'party' || v == null;
        const chosen = Array.isArray(v) ? v : [];
        return `<fieldset class="hf wide checks"><legend class="lbl">${label}</legend>
          <label class="chk"><input type="radio" name="given" data-given="party" ${party ? 'checked' : ''}><span>The whole party</span></label>
          <label class="chk"><input type="radio" name="given" data-given="some" ${party ? '' : 'checked'}><span>Only some characters</span></label>
          ${party ? '' : `<div class="checks">${(ctx.chars?.() || []).map(x => `<label class="chk"><input type="checkbox" data-givenc value="${x.id}" ${chosen.includes(x.id) ? 'checked' : ''}><span>${esc(x.name || 'Unnamed')}</span></label>`).join('') || '<p class="hint">No characters on this device yet.</p>'}</div>`}
          <span class="hint">Shows on those sheets. Dawn temp HP uses the Session Notes clock and never stacks.</span></fieldset>`;
      }
      case 'casterSel': return `<label class="hf">${lab}<select class="f" data-f="${path}">${opt([['', 'Not a spellcaster'], ['full', 'Full caster (Wizard, Cleric…)'], ['half', 'Half caster (Paladin, Ranger)'], ['artificer', 'Half caster, rounded up (Artificer)'], ['third', 'Third caster'], ['pact', 'Pact Magic (Warlock)']], v)}</select></label>`;
      case 'casterSub': return `<label class="hf">${lab}<select class="f" data-f="${path}">${opt([['', 'No'], ['third', 'Yes, third caster (Eldritch Knight, Arcane Trickster)']], v)}</select></label>`;
      case 'numlist': return `<label class="hf">${lab}<input class="f" data-f="${path}" data-numlist value="${esc((v || []).join(', '))}" placeholder="${esc(ph)}" autocomplete="off"></label>`;
      case 'bool': return `<label class="hf chk boolf"><input type="checkbox" data-fbool="${path}" ${v ? 'checked' : ''}><span>${label}</span></label>`;
      case 'groupText': return `<label class="hf">${lab}<input class="f" data-f="${path}" list="dl-optgroups" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off"><datalist id="dl-optgroups">${[...new Set(L.all('option').map(o => o.group).filter(Boolean))].map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist><span class="hint">Must match the group name on the class or subclass.</span></label>`;
      case 'ownerMulti': return `<fieldset class="hf wide checks"><legend class="lbl">${label}</legend>${L.all('class').map(x => `<label class="chk"><input type="checkbox" data-fset="${path}" value="${x.id}" ${(v || []).includes(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}
        <span class="lbl" style="width:100%;margin-top:6px">Subclasses</span>${L.all('subclass').map(x => `<label class="chk"><input type="checkbox" data-fset="${path}" value="${x.id}" ${(v || []).includes(x.id) ? 'checked' : ''}><span>${esc(x.name)} <small>${esc(L.get(x.parent)?.name || '')}</small></span></label>`).join('')}</fieldset>`;
      case 'optionSel': return `<label class="hf">${lab}<select class="f" data-f="${path}">${opt([['', 'None'], ...L.all('option').filter(o => o.id !== d.id).map(o => [o.id, `${o.name} (${o.group || 'no group'})`])], v)}</select></label>`;
      case 'remindOne': return `<div class="hf wide"><span class="lbl">${label}</span><div class="row remrow"><label class="mini">Remind during <select class="f" data-f="${path}.on">${opt(REMIND_ON, v?.on || '')}</select></label><input class="f" data-f="${path}.text" value="${esc(v?.text || '')}" placeholder="Reminder text, e.g. +{cha} to damage" aria-label="Reminder text" style="flex:1"></div></div>`;
      case 'optgroups': return rows(path, label, v, (r, i) => `<input class="f" data-f="${path}.${i}.group" value="${esc(r.group)}" list="dl-optgroups2" placeholder="Group name, e.g. Eldritch Invocations" aria-label="Group name" autocomplete="off">
          <input class="f" data-optlv="${path}.${i}.levels" value="${esc(levelsToText(r.levels))}" placeholder="2: 2, 5: 3, 7: 4" aria-label="How many at each level" autocomplete="off" style="max-width:220px">
          <datalist id="dl-optgroups2">${[...new Set(L.all('option').map(o => o.group).filter(Boolean))].map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist>`, { group: '', levels: {} })
        + '<p class="hint wide">Level: total picks from that level on. "2: 2, 5: 3" means 2 at level 2 and 3 from level 5. A subclass\'s count adds to its class\'s.</p>';
      case 'classMulti': return `<fieldset class="hf wide checks"><legend class="lbl">${label}</legend>${L.all('class').map(x => `<label class="chk"><input type="checkbox" data-fset="${path}" value="${x.id}" ${(v || []).includes(x.id) ? 'checked' : ''}><span>${esc(x.name)}</span></label>`).join('')}</fieldset>`;
      case 'subMulti': return `<fieldset class="hf wide checks"><legend class="lbl">${label}</legend>${L.all('subclass').map(x => `<label class="chk"><input type="checkbox" data-fset="${path}" value="${x.id}" ${(v || []).includes(x.id) ? 'checked' : ''}><span>${esc(x.name)} <small>${esc(L.get(x.parent)?.name || '')}</small></span></label>`).join('')}<span class="hint">Spells on a subclass list count as always prepared.</span></fieldset>`;
      case 'langKind': return `<label class="hf">${lab}<select class="f" data-f="${path}">${opt([['Standard', 'Standard'], ['Exotic', 'Exotic'], ['Secret', 'Secret']], v)}</select></label>`;
      case 'raceParent': return `<label class="hf">${lab}<select class="f" data-f="${path}">${opt([['', 'Not a subrace'], ...L.all('race').filter(r => !r.parent && r.id !== d.id).map(r => [r.id, r.name])], v)}</select></label>`;
      case 'classSel': return `<label class="hf">${lab}<select class="f" data-f="${path}">${opt([['', 'Choose a class'], ...L.all('class').map(r => [r.id, r.name])], v)}</select></label>`;
      case 'featSel': return `<label class="hf">${lab}<select class="f" data-f="${path}">${opt([['', 'None'], ...L.all('feat').map(r => [r.id, r.name])], v)}</select><span class="hint">Added to the sheet automatically when a player picks this background.</span></label>`;
      case 'skills': return `<fieldset class="hf wide checks">${`<legend class="lbl">${label}</legend>`}${SKILLS.map(([k, n]) => `<label class="chk"><input type="checkbox" data-fset="${path}" value="${k}" ${(v || []).includes(k) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</fieldset>`;
      case 'saves': return `<fieldset class="hf wide checks"><legend class="lbl">${label}</legend>${ABILS.map(([k, n]) => `<label class="chk"><input type="checkbox" data-fset="${path}" value="${k}" ${(v || []).includes(k) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</fieldset>`;
      case 'armor': return `<fieldset class="hf checks"><legend class="lbl">${label}</legend>${Object.entries(ARMOR_L).map(([k, n]) => `<label class="chk"><input type="checkbox" data-fbool="${path}.${k}" ${v?.[k] ? 'checked' : ''}><span>${n.replace(' armor', '')}</span></label>`).join('')}</fieldset>`;
      case 'weapons': return `<fieldset class="hf checks"><legend class="lbl">${label}</legend>${Object.entries(WEAP_L).map(([k, n]) => `<label class="chk"><input type="checkbox" data-fbool="${path}.${k}" ${v?.[k] ? 'checked' : ''}><span>${n.replace(' weapons', '')}</span></label>`).join('')}</fieldset>`;
      case 'abil': return rows(path, label, v, (r, i) => `<select class="f" data-f="${path}.${i}.a">${opt(ABILS, r.a)}</select><input class="f n" data-f="${path}.${i}.v" data-num inputmode="numeric" value="${esc(r.v)}" aria-label="Amount">`, { a: 'str', v: 1 });
      case 'resist': return rows(path, label, v, (r, i) => `<select class="f" data-f="${path}.${i}.kind">${opt(DEFENSE_KINDS.map(([k, n]) => [k, n.replace(/s$/, '')]), r.kind)}</select><input class="f" data-f="${path}.${i}.what" value="${esc(r.what)}" placeholder="Fire" aria-label="Damage type or condition">`, { kind: 'res', what: '' });
      case 'named': return rows(path, label, v, (r, i) => `<div class="stackf"><input class="f" data-f="${path}.${i}.name" value="${esc(r.name)}" placeholder="Name" aria-label="Name"><textarea class="f" data-f="${path}.${i}.text" rows="4" placeholder="Full text" aria-label="Text">${esc(r.text)}</textarea><div class="row remrow"><label class="mini">Remind during <select class="f" data-f="${path}.${i}.remind.on">${opt(REMIND_ON, r.remind?.on || '')}</select></label><input class="f" data-f="${path}.${i}.remind.text" value="${esc(r.remind?.text || '')}" placeholder="Reminder text, e.g. +{cha} to saves" aria-label="Reminder text" style="flex:1"></div></div>`, { name: '', text: '' }, true);
      case 'leveled': return rows(path, label, v, (r, i) => `<div class="stackf"><div class="row"><label class="mini">Level <input class="f n" data-f="${path}.${i}.lvl" data-num inputmode="numeric" value="${esc(r.lvl)}"></label><input class="f" data-f="${path}.${i}.name" value="${esc(r.name)}" placeholder="Feature name" aria-label="Name" style="flex:1"></div><textarea class="f" data-f="${path}.${i}.text" rows="4" placeholder="Full text" aria-label="Text">${esc(r.text)}</textarea><div class="row remrow"><label class="mini">Remind during <select class="f" data-f="${path}.${i}.remind.on">${opt(REMIND_ON, r.remind?.on || '')}</select></label><input class="f" data-f="${path}.${i}.remind.text" value="${esc(r.remind?.text || '')}" placeholder="Reminder text, e.g. +{cha} to saves" aria-label="Reminder text" style="flex:1"></div></div>`, { lvl: 1, name: '', text: '' }, true);
      case 'ctable': return tableEditor(path, label, v || []);
      case 'speeds': return `<fieldset class="hf wide speedsf"><legend class="lbl">${label}</legend>
        ${L.SPEED_KINDS.map(([k, n]) => `<label class="mini">${n} <input class="f n" data-f="${path}.${k}" value="${esc(v?.[k] ?? '')}" placeholder="—" autocomplete="off" aria-label="${n} speed"></label>`).join('')}
        <label class="chk"><input type="checkbox" data-fbool="hover" ${d.hover ? 'checked' : ''}><span>Can hover</span></label>
        <span class="hint">A number, or "walk" for "equal to your walking speed". Blank for none. A subrace's speeds replace its race's.</span></fieldset>`;
      case 'xtables': return xtablesEditor(path, label, v || [], d);
      case 'miItem': {
        if (!miList && !miLoading) loadMi();
        return `<label class="hf wide">${lab}<input class="f" data-miitem list="dl-miitems" value="${esc(d.itemSnap?.name || '')}" placeholder="${miList ? `Type to search ${miList.length} items` : 'Loading the magic item list…'}" autocomplete="off">
          <datalist id="dl-miitems">${(miList || []).map(i => `<option value="${esc(i.name)}"></option>`).join('')}</datalist>
          <span class="hint">${d.itemSnap ? `Linked: ${esc(d.itemSnap.name)}. Its full text comes from the magic item app (value left out). Clear the box to unlink.` : 'For a Replicate Magic Item plan: pick the item, and mark this option as an infusion. Leave blank for other infusions.'}</span></label>`;
      }
      default: return `<label class="hf">${lab}<input class="f" data-f="${path}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off"></label>`;
    }
  };
  return `
    <form class="editor" data-editor onsubmit="return false">
      <div class="edhead"><h2>${d.id ? 'Edit' : 'New'} ${esc(L.typeName(d.type).toLowerCase())}</h2>
        <div class="row"><button class="btn ghost" type="button" data-lcancel>Cancel</button><button class="btn primary" type="button" data-lsave>Save</button></div></div>
      ${d.builtIn ? '<p class="hint">Saving makes your own copy of this SRD entry. "Restore SRD version" puts the original back.</p>' : ''}
      <div class="edgrid">${(FIELDS[d.type] || []).map(([p, l, k, ph]) => f(p, l, k, ph)).join('')}</div>
    </form>`;
}
// Class table editor: one column per table column, one row per level. Blank cells carry down (shown faintly).
function tableEditor(path, label, cols) {
  const n = cols.length;
  const head = cols.map((c, j) => `<th><div class="cthead">
      <input class="f" data-f="${path}.${j}.name" value="${esc(c.name)}" placeholder="Column name" aria-label="Column ${j + 1} name" autocomplete="off">
      <div class="ctbtns">
        <button class="x" type="button" data-colmove="${path}" data-i="${j}" data-dir="-1" ${j ? '' : 'disabled'} aria-label="Move left">‹</button>
        <button class="x" type="button" data-colmove="${path}" data-i="${j}" data-dir="1" ${j < n - 1 ? '' : 'disabled'} aria-label="Move right">›</button>
        <button class="x" type="button" data-coldel="${path}" data-i="${j}" aria-label="Remove column">×</button>
      </div>
      <label class="chk tiny"><input type="checkbox" data-fbool="${path}.${j}.sheet" ${c.sheet !== false ? 'checked' : ''}><span>On sheet</span></label></div></th>`).join('');
  const body = Array.from({ length: T.LEVELS }, (_, r) => `<tr><td class="ctlv">${T.ord(r + 1)}</td>${cols.map((c, j) =>
    `<td><input class="f" data-f="${path}.${j}.vals.${r}" data-ctcell value="${esc(c.vals?.[r] ?? '')}" placeholder="${esc(r ? T.cellAt(c, r) : '')}" aria-label="${esc(c.name || 'Column')} at level ${r + 1}" autocomplete="off"></td>`).join('')}</tr>`).join('');
  return `<div class="hf wide ctedit"><span class="lbl">${label}</span>
    ${n ? `<div class="ctable-wrap"><table class="ctable edit"><tr><th class="ctlv">Level</th>${head}</tr>${body}</table></div>` : '<p class="hint">No columns yet.</p>'}
    <button class="linkbtn" type="button" data-coladd="${path}">Add a column</button>
    <p class="hint wide">Level, Proficiency Bonus and Features fill in on their own. Leave a cell blank to keep the value from the level above (shown faintly). "On sheet" shows the column's current value in the character's Class features; write {Column name} in a feature or reminder to show it there, like {Sneak Attack}.</p></div>`;
}
// Extra tables: random rolls, by level, or plain
function xtablesEditor(path, label, list, d) {
  const feats = [...new Set([...(d.features || []), ...(d.traits || [])].map(f => f.name).concat(d.feature?.name ? [d.feature.name] : []).concat(['feat', 'option', 'spell', 'boon'].includes(d.type) && d.name ? [d.name] : []).filter(Boolean))];
  const one = (t, i) => {
    const p = `${path}.${i}`, cols = t.cols || [], rows = t.rows || [];
    return `<div class="xtedit">
      <div class="row xtrow1">
        <input class="f" data-f="${p}.title" value="${esc(t.title)}" placeholder="Table name, e.g. Wild Magic Surge" aria-label="Table name" autocomplete="off" style="flex:2;min-width:180px">
        <select class="f" data-xtkind="${i}" aria-label="Kind of table">${T.TABLE_KINDS.map(([k, n]) => `<option value="${k}" ${t.kind === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
        ${t.kind === 'roll' ? `<label class="mini">Die <input class="f" data-f="${p}.die" data-xtdie="${i}" value="${esc(t.die)}" placeholder="d100" style="width:80px" autocomplete="off"></label>` : ''}
        <label class="mini">Show with <select class="f" data-f="${p}.feature"><option value="">Its own section</option>${feats.map(n => `<option value="${esc(n)}" ${t.feature === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}${t.feature && !feats.includes(t.feature) ? `<option selected value="${esc(t.feature)}">${esc(t.feature)}</option>` : ''}</select></label>
        <button class="x" type="button" data-xtdel="${i}" aria-label="Remove this table">×</button>
      </div>
      <div class="ctable-wrap"><table class="ctable edit xtgrid">
        <tr>${cols.map((h, j) => `<th><div class="cthead"><input class="f" data-f="${p}.cols.${j}" value="${esc(h)}" placeholder="${j ? 'Column' : t.kind === 'roll' ? (t.die || 'd6') : t.kind === 'level' ? 'Level' : 'Column'}" autocomplete="off" aria-label="Column ${j + 1} name">
          ${cols.length > 1 ? `<div class="ctbtns"><button class="x" type="button" data-xtcoldel="${i}" data-j="${j}" aria-label="Remove column">×</button></div>` : ''}</div></th>`).join('')}
          <th class="ctlv"><button class="x" type="button" data-xtcoladd="${i}" aria-label="Add a column">+</button></th></tr>
        ${rows.map((r, ri) => `<tr>${cols.map((_, j) => `<td><input class="f ${j ? 'wide' : ''}" data-f="${p}.rows.${ri}.${j}" value="${esc(r[j] ?? '')}" placeholder="${j ? '' : t.kind === 'roll' ? `${ri + 1}` : t.kind === 'level' ? 'Level' : ''}" autocomplete="off" aria-label="Row ${ri + 1}, column ${j + 1}"></td>`).join('')}
          <td class="ctlv"><button class="x" type="button" data-xtrowdel="${i}" data-r="${ri}" aria-label="Remove row">×</button></td></tr>`).join('')}
      </table></div>
      <div class="row"><button class="linkbtn" type="button" data-xtrowadd="${i}">Add a row</button>
        <details class="xtpaste"><summary>Paste rows from text</summary>
          <textarea class="f" data-xtpastebox="${i}" rows="6" placeholder="${t.kind === 'roll' ? '01-05 | Roll on this table again&#10;06-10 | You turn blue for 1 minute' : t.kind === 'level' ? '3 | 1d6&#10;7 | 2d6' : 'Cell | Cell'}"></textarea>
          <span class="hint">One row per line. Separate columns with a tab or |. ${t.kind !== 'plain' ? 'Or just put the number or range first and the text after it.' : ''} This replaces the rows above.</span>
          <button class="btn small" type="button" data-xtpaste="${i}">Use these rows</button></details></div>
      <p class="hint">${t.kind === 'roll' ? 'First column: the roll, like 1, 2-3 or 01-05 (00 counts as 100 on a d100). The sheet gets a Roll button.' : t.kind === 'level' ? "First column: the level each row starts at. The sheet highlights the character's row, and the other columns work as {tokens} and like class table columns." : 'Any rows and columns.'}</p>
    </div>`;
  };
  return `<div class="hf wide xtables"><span class="lbl">${label}</span>${list.map(one).join('') || '<p class="hint">No tables.</p>'}
    <button class="linkbtn" type="button" data-xtadd>Add a table</button></div>`;
}
function xtParse(text, kind, ncols) {
  const out = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.trim(); if (!line) continue;
    let cells = line.includes('\t') ? line.split('\t') : line.includes('|') ? line.split('|') : null;
    if (!cells) { const m = /^(\d+\s*(?:[-–—]\s*\d+|\+)?)\s+(.+)$/.exec(line); cells = kind !== 'plain' && m ? [m[1], m[2]] : [line]; }
    out.push(cells.map(x => x.trim()));
  }
  const width = Math.max(ncols, ...out.map(r => r.length));
  return { rows: out.map(r => Array.from({ length: width }, (_, j) => r[j] ?? '')), width };
}

// The magic item app's items, for linking Replicate Magic Item plans (read through the DM's device)
let miList = null, miLoading = false;
async function loadMi() {
  miLoading = true;
  try { miList = await ctx.magicItems?.() || []; } catch { miList = []; }
  miLoading = false;
  if (st.draft?.type === 'option') {
    const el = root.querySelector('[data-miitem]'); const v = el?.value; const focused = document.activeElement === el;
    render();
    const n = root.querySelector('[data-miitem]'); if (n && v != null) { n.value = v; if (focused) n.focus(); }
  }
}
function rows(path, label, list, row, blank, big = false) {
  list = list || [];
  return `<div class="hf wide rowsf"><span class="lbl">${label}</span>
    ${list.map((r, i) => `<div class="erow ${big ? 'tall' : ''}">${row(r, i)}<button class="x" type="button" data-rowdel="${path}" data-i="${i}" aria-label="Remove">×</button></div>`).join('')}
    <button class="linkbtn" type="button" data-rowadd="${path}" data-blank='${esc(JSON.stringify(blank))}'>Add</button></div>`;
}

/* ---------- events ---------- */
function onInput(e) {
  const el = e.target;
  if (el.matches('[data-lq]')) {
    if (e.type !== 'input') return;
    st.q = el.value;
    const pos = el.selectionStart; render();
    const q = root.querySelector('[data-lq]'); q.focus(); q.setSelectionRange(pos, pos);
    return;
  }
  const d = st.draft; if (!d) return;
  if (el.dataset.given && e.type === 'change') { d.given = el.dataset.given === 'party' ? 'party' : []; return render(); }
  if (el.matches('[data-givenc]') && e.type === 'change') { const set = new Set(Array.isArray(d.given) ? d.given : []); el.checked ? set.add(el.value) : set.delete(el.value); d.given = [...set]; return; }
  if (el.dataset.optlv) { setPath(d, el.dataset.optlv, textToLevels(el.value)); return; }
  if (el.matches('[data-miitem]')) {
    if (e.type !== 'change') return;
    const name = el.value.trim();
    if (!name) { d.item = ''; d.itemSnap = null; return render(); }
    const hit = (miList || []).find(i => i.name.toLowerCase() === name.toLowerCase());
    if (!hit) { ctx.toast(miList?.length ? 'Pick an item from the list.' : "The magic item list isn't loaded. Sync once, then try again."); return; }
    d.item = hit.id; d.itemSnap = { name: hit.name, type: hit.type, attune: hit.attune, desc: hit.desc, weight: hit.weight };
    if (!d.name) d.name = `Replicate Magic Item: ${hit.name}`;
    d.infusion = true;
    return render();
  }
  if (el.dataset.xtkind != null) {
    if (e.type !== 'change') return;
    const t = d.tables[Number(el.dataset.xtkind)], was = t.kind; t.kind = el.value;
    // untouched starter rows (just 1, 2, 3… or blanks) start over for the new kind
    if ((t.rows || []).every((r, i) => r.slice(1).every(x => !String(x).trim()) && (!String(r[0]).trim() || String(r[0]) === String(i + 1)))) t.rows = T.blankTable(t.kind).rows.map(r => Array.from({ length: t.cols.length }, (_, j) => r[j] ?? ''));
    if (t.kind === 'roll' && !t.die) t.die = 'd6';
    if (!t.cols[0] || t.cols[0] === (was === 'roll' ? t.die : 'Level')) t.cols[0] = t.kind === 'roll' ? t.die : t.kind === 'level' ? 'Level' : '';
    return keepScroll(render);
  }
  if (el.dataset.xtdie != null && e.type === 'change') {
    const t = d.tables[Number(el.dataset.xtdie)];
    if (!t.cols[0] || /^\d*d\d+$/i.test(t.cols[0])) t.cols[0] = el.value.trim();
    setPath(d, el.dataset.f, el.value); return keepScroll(render);
  }
  if (el.dataset.ctcell != null) { setPath(d, el.dataset.f, el.value); if (e.type === 'change') refreshCarry(el); return; }
  if (el.dataset.f && el.dataset.numlist != null) setPath(d, el.dataset.f, el.value.split(/[^0-9]+/).filter(Boolean).map(Number));
  else if (el.dataset.f) setPath(d, el.dataset.f, el.dataset.num != null ? (el.value === '' ? '' : Number(el.value)) : el.value);
  else if (el.dataset.fbool) setPath(d, el.dataset.fbool, el.checked);
  else if (el.dataset.fset && e.type === 'change') {
    const set = new Set(getPath(d, el.dataset.fset) || []);
    el.checked ? set.add(el.value) : set.delete(el.value);
    setPath(d, el.dataset.fset, [...set]);
  }
}
async function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.ltype) { st.type = d.ltype; st.sel = null; st.draft = null; st.q = ''; return render(); }
  if (d.lsel) { st.sel = d.lsel; st.draft = null; render(); root.querySelector('.libmain').scrollTop = 0; return; }
  if (d.libopen) { const x = L.get(d.libopen); if (x) { st.type = x.type; st.sel = x.id; st.draft = null; render(); } return; }
  if (d.lnew != null) { st.draft = L.blank(st.type); render(); root.querySelector('[data-f="name"]')?.focus(); return; }
  if (d.ledit != null) { st.draft = structuredClone(L.get(st.sel)); return render(); }
  if (d.ldup != null) { const x = structuredClone(L.get(st.sel)); x.id = ''; x.name = `${x.name} (copy)`; x.builtIn = false; st.draft = x; return render(); }
  if (d.ldel != null) {
    const x = L.get(st.sel);
    if (!confirm(x.overridesSrd ? `Put back the original SRD ${x.name}? Your edits to it are removed.` : `Delete ${x.name} from the library? Sheets that use it keep what was already filled in.`)) return;
    await L.remove(x.id); if (!x.overridesSrd) st.sel = null;
    ctx.toast(x.overridesSrd ? `Restored the SRD ${x.name}.` : `Deleted ${x.name}.`); ctx.libraryEdited(); return render();
  }
  if (d.lcancel != null) { st.draft = null; return render(); }
  if (d.lsave != null) {
    const x = st.draft;
    if (!x.name?.trim()) { ctx.toast('Give it a name first.'); root.querySelector('[data-f="name"]')?.focus(); return; }
    if (x.type === 'subclass' && !x.parent) { ctx.toast('Choose which class this subclass belongs to.'); return; }
    if (x.features) x.features.sort((a, b) => (Number(a.lvl) || 0) - (Number(b.lvl) || 0));
    x.name = x.name.trim();
    st.sel = await L.put(x); st.draft = null;
    ctx.toast(`Saved ${x.name}.`); ctx.libraryEdited(); return render();
  }
  if (d.rowadd) { const list = getPath(st.draft, d.rowadd) || []; list.push(JSON.parse(d.blank)); setPath(st.draft, d.rowadd, list); render(); const rs = root.querySelectorAll(`[data-f^="${d.rowadd}.${list.length - 1}."]`); rs[rs.length > 1 ? 1 : 0]?.focus(); return; }
  if (d.xtadd != null) { st.draft.tables = [...(st.draft.tables || []), T.blankTable('roll')]; return keepScroll(render); }
  if (d.xtdel != null) { const t = st.draft.tables[Number(d.xtdel)]; if ((t.title || t.rows?.some(r => r.some(Boolean))) && !confirm(`Remove the ${t.title || 'untitled'} table?`)) return; st.draft.tables.splice(Number(d.xtdel), 1); return keepScroll(render); }
  if (d.xtrowadd != null) { const t = st.draft.tables[Number(d.xtrowadd)]; t.rows.push(Array((t.cols || []).length).fill('')); return keepScroll(render); }
  if (d.xtrowdel != null) { st.draft.tables[Number(d.xtrowdel)].rows.splice(Number(d.r), 1); return keepScroll(render); }
  if (d.xtcoladd != null) { const t = st.draft.tables[Number(d.xtcoladd)]; t.cols.push(''); t.rows.forEach(r => r.push('')); return keepScroll(render); }
  if (d.xtcoldel != null) { const t = st.draft.tables[Number(d.xtcoldel)], j = Number(d.j); if (t.cols.length < 2) return; t.cols.splice(j, 1); t.rows.forEach(r => r.splice(j, 1)); return keepScroll(render); }
  if (d.xtpaste != null) {
    const i = Number(d.xtpaste), t = st.draft.tables[i], box = root.querySelector(`[data-xtpastebox="${i}"]`);
    const { rows, width } = xtParse(box?.value, t.kind, t.cols.length);
    if (!rows.length) { ctx.toast('Paste some rows first.'); return; }
    while (t.cols.length < width) t.cols.push('');
    t.rows = rows; ctx.toast(`${rows.length} rows in.`); return keepScroll(render);
  }
  if (d.coladd) { const list = getPath(st.draft, d.coladd) || []; list.push(T.blankCol()); setPath(st.draft, d.coladd, list); render(); root.querySelector(`[data-f="${d.coladd}.${list.length - 1}.name"]`)?.focus(); return; }
  if (d.coldel) { const list = getPath(st.draft, d.coldel) || []; const col = list[Number(d.i)]; if ((col?.name || col?.vals?.some(v => v)) && !confirm(`Remove the ${col.name || 'unnamed'} column?`)) return; list.splice(Number(d.i), 1); return keepScroll(render); }
  if (d.colmove) { const list = getPath(st.draft, d.colmove) || []; const i = Number(d.i), j = i + Number(d.dir); if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; return keepScroll(render); }
  if (d.rowdel) { const list = getPath(st.draft, d.rowdel) || []; list.splice(Number(d.i), 1); return render(); }
  if (d.lback != null) { st.sel = null; st.draft = null; return render(); }
}

// After a cell changes, update the faint carried values below it in that column
function refreshCarry(el) {
  const m = el.dataset.f.match(/^(.*)\.(\d+)\.vals\.(\d+)$/); if (!m) return;
  const col = getPath(st.draft, `${m[1]}.${m[2]}`);
  root.querySelectorAll(`[data-f^="${m[1]}.${m[2]}.vals."]`).forEach(inp => { const r = Number(inp.dataset.f.split('.').pop()); inp.placeholder = r ? T.cellAt(col, r) : ''; });
}
function keepScroll(fn) {
  const main = root.querySelector('.libmain'), y = main?.scrollTop, x = root.querySelector('.ctedit .ctable-wrap')?.scrollLeft;
  fn();
  const m2 = root.querySelector('.libmain'); if (m2 && y != null) m2.scrollTop = y;
  const w = root.querySelector('.ctedit .ctable-wrap'); if (w && x != null) w.scrollLeft = x;
}
