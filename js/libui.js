// Library screen: browse and read entries; the DM also adds and edits them.
import * as L from './library.js';
import { getPath, setPath } from './model.js';
import { ABILS, SKILLS, DEFENSE_KINDS } from './rules.js';
import { esc } from './sheet.js';

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
    add('Speed', e.speed ? `${esc(e.speed)} ft` : ''); add('Size', esc(e.size)); add('Vision', esc(e.vision));
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
  if (e.type === 'language') { add('Type', esc(e.kind)); add('Script', esc(e.script)); add('Typical speakers', esc(e.speakers)); }
  const list = (title, items, lvl) => items?.length ? `<h3>${title}</h3>${items.map(f => `<section class="lfeat"><h4>${lvl ? `<span class="lv">${f.lvl}</span>` : ''}${esc(f.name)}</h4>${para(f.text)}</section>`).join('')}` : '';
  return `
    <article class="entry">
      <header><h2>${esc(e.name)}</h2><p class="sub">${esc(L.typeName(e.type))}${e.src ? ` · ${esc(e.src)}` : ''}</p></header>
      ${e.note ? `<aside class="rulenote"><b>Table Rules</b>${para(e.note)}</aside>` : ''}
      ${facts.length ? `<dl class="facts">${facts.join('')}</dl>` : ''}
      ${e.type === 'background' && e.feature?.name ? `<h3>Feature: ${esc(e.feature.name)}</h3>${para(e.feature.text)}` : ''}
      ${e.desc ? para(e.desc) : ''}
      ${e.langNote ? para(e.langNote) : ''}
      ${list('Traits', e.traits)}
      ${list('Features by level', e.features, true)}
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
        <span>${esc(e.name)}${e.parent && e.type === 'race' ? ` <small>${esc(L.get(e.parent)?.name || '')}</small>` : ''}${e.type === 'subclass' ? ` <small>${esc(L.get(e.parent)?.name || '')}</small>` : ''}</span>
        <small class="srcb">${e.builtIn ? 'SRD' : e.overridesSrd ? 'SRD, edited' : esc(e.src || 'Yours')}</small></button></li>`).join('') || '<li class="empty">Nothing here yet.</li>'}</ul>
    </aside>
    <section class="libmain">${st.draft || sel ? `<button class="linkbtn libback" type="button" data-lback>All ${L.TYPES.find(t => t[0] === st.type)[1].toLowerCase()}</button>` : ''}${st.draft ? editorHtml(st.draft) : sel ? `
      ${dm ? `<div class="row libacts"><button class="btn" type="button" data-ledit>Edit</button><button class="btn" type="button" data-ldup>Duplicate</button>
        ${sel.builtIn ? '' : sel.overridesSrd ? '<button class="btn" type="button" data-ldel>Restore SRD version</button>' : '<button class="btn danger" type="button" data-ldel>Delete</button>'}</div>` : ''}
      ${entryHtml(sel)}` : `<div class="libempty"><p>${items.length ? 'Choose an entry to read it.' : dm ? `No ${L.TYPES.find(t => t[0] === st.type)[1].toLowerCase()} yet. Add one with the button on the left.` : 'Nothing here yet.'}</p></div>`}</section>`;
  root.dataset.mode = st.draft || sel ? 'entry' : 'list';
}

/* ---------- editor ---------- */
const FIELDS = {
  race: [['name', 'Name'], ['parent', 'Subrace of', 'raceParent'], ['src', 'Book and page'], ['speed', 'Speed (ft)', 'num'], ['size', 'Size'], ['vision', 'Vision', 'text', 'Darkvision 60 ft'],
    ['abil', 'Ability score increases', 'abil'], ['abilNote', 'Ability choice the player makes', 'text', 'Choose 2 other ability scores to increase by 1.'], ['languages', 'Languages', 'text', 'Common, Elvish'],
    ['skills', 'Skill proficiencies', 'skills'], ['armor', 'Armor', 'armor'], ['weapons', 'Weapons', 'weapons'], ['weaponsOther', 'Other weapons'], ['tools', 'Tools'],
    ['resist', 'Resistances and immunities', 'resist'], ['traits', 'Traits', 'named'], ['desc', 'Description', 'area'], ['note', 'Table Rules note', 'area']],
  class: [['name', 'Name'], ['src', 'Book and page'], ['hd', 'Hit die', 'hd'], ['saves', 'Saving throws', 'saves'], ['armor', 'Armor', 'armor'], ['weapons', 'Weapons', 'weapons'],
    ['weaponsOther', 'Other weapons'], ['tools', 'Tools'], ['skillChoice', 'Skill choice', 'text', 'Choose two from …'], ['spellAbil', 'Spellcasting ability', 'abilSel'],
    ['subclassLevel', 'Subclass chosen at level', 'num'], ['features', 'Features', 'leveled'], ['desc', 'Description', 'area'], ['note', 'Table Rules note', 'area']],
  subclass: [['name', 'Name'], ['parent', 'Class', 'classSel'], ['src', 'Book and page'], ['features', 'Features', 'leveled'], ['desc', 'Description', 'area'], ['note', 'Table Rules note', 'area']],
  background: [['name', 'Name'], ['src', 'Book and page'], ['skills', 'Skill proficiencies', 'skills'], ['tools', 'Tools'], ['languages', 'Languages'],
    ['feature.name', 'Feature name'], ['feature.text', 'Feature text', 'area'], ['feat', 'Assigned feat', 'featSel'], ['equipment', 'Equipment', 'area'], ['desc', 'Description', 'area'], ['note', 'Table Rules note', 'area']],
  feat: [['name', 'Name'], ['src', 'Book and page'], ['prereq', 'Prerequisite'], ['desc', 'Full text', 'area'], ['note', 'Table Rules note', 'area']],
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
      case 'named': return rows(path, label, v, (r, i) => `<div class="stackf"><input class="f" data-f="${path}.${i}.name" value="${esc(r.name)}" placeholder="Name" aria-label="Name"><textarea class="f" data-f="${path}.${i}.text" rows="4" placeholder="Full text" aria-label="Text">${esc(r.text)}</textarea></div>`, { name: '', text: '' }, true);
      case 'leveled': return rows(path, label, v, (r, i) => `<div class="stackf"><div class="row"><label class="mini">Level <input class="f n" data-f="${path}.${i}.lvl" data-num inputmode="numeric" value="${esc(r.lvl)}"></label><input class="f" data-f="${path}.${i}.name" value="${esc(r.name)}" placeholder="Feature name" aria-label="Name" style="flex:1"></div><textarea class="f" data-f="${path}.${i}.text" rows="4" placeholder="Full text" aria-label="Text">${esc(r.text)}</textarea></div>`, { lvl: 1, name: '', text: '' }, true);
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
function rows(path, label, list, row, blank, big = false) {
  list = list || [];
  return `<div class="hf wide rowsf"><span class="lbl">${label}</span>
    ${list.map((r, i) => `<div class="erow ${big ? 'big' : ''}">${row(r, i)}<button class="x" type="button" data-rowdel="${path}" data-i="${i}" aria-label="Remove">×</button></div>`).join('')}
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
  if (el.dataset.f) setPath(d, el.dataset.f, el.dataset.num != null ? (el.value === '' ? '' : Number(el.value)) : el.value);
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
  if (d.rowdel) { const list = getPath(st.draft, d.rowdel) || []; list.splice(Number(d.i), 1); return render(); }
  if (d.lback != null) { st.sel = null; st.draft = null; return render(); }
}
