// Renders a character's pages and keeps the math live as fields change.
import * as R from './rules.js';
import { getPath, setPath, stamp, uid } from './model.js';
import { PRESETS, CLASS_ACCENTS, HEAD_FONTS, BODY_FONTS, FRAMES, applyTheme } from './theme.js';

let ctx; // { save(c), toast(msg), rerender() }
export function initSheet(helpers) { ctx = helpers; }

export const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ---------- little field builders ---------- */
const val = (c, p) => getPath(c, p) ?? '';
const txt = (c, p, ph = '', cls = '') => `<input class="f ${cls}" data-k="${p}" value="${esc(val(c, p))}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false">`;
const nfield = (c, p, ph = '', cls = '') => `<input class="f n ${cls}" data-k="${p}" data-type="num" inputmode="numeric" value="${esc(val(c, p))}" placeholder="${esc(ph)}" autocomplete="off">`;
const area = (c, p, ph = '', rows = 3) => `<textarea class="f" data-k="${p}" rows="${rows}" placeholder="${esc(ph)}">${esc(val(c, p))}</textarea>`;
const chk = (c, p, label = '', extra = '') => `<label class="chk"><input type="checkbox" data-k="${p}" ${getPath(c, p) ? 'checked' : ''} ${extra}><span>${label}</span></label>`;
const sel = (c, p, opts, extra = '') => `<select class="f" data-k="${p}" ${extra}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(val(c, p)) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const calc = (key, arg = '') => `<span data-calc="${key}" data-arg="${arg}"></span>`;
const panel = (title, body, cls = '', extra = '') => `<section class="panel ${cls}" ${extra}><h3 class="ph">${title}</h3>${body}</section>`;
const ABIL_OPTS = [['', '—'], ...R.ABILS.map(([k, n]) => [k, n])];

/* ---------- page: the main sheet ---------- */
function header(c) {
  const classes = (c.classes || []).map((k, i) => `
    <div class="clsrow">
      <input class="f" data-k="classes.${i}.name" value="${esc(k.name)}" placeholder="Class" autocomplete="off">
      <input class="f" data-k="classes.${i}.sub" value="${esc(k.sub)}" placeholder="Subclass" autocomplete="off">
      <label class="mini">Lvl <input class="f n" data-k="classes.${i}.level" data-type="num" inputmode="numeric" value="${esc(k.level)}" data-rerender></label>
      <label class="mini">Hit die <select class="f" data-k="classes.${i}.hd" data-type="num" data-rerender>${[6, 8, 10, 12].map(d => `<option value="${d}" ${Number(k.hd) === d ? 'selected' : ''}>d${d}</option>`).join('')}</select></label>
      ${c.classes.length > 1 ? `<button class="x" type="button" data-act="rowdel" data-list="classes" data-i="${i}" aria-label="Remove this class">×</button>` : ''}
    </div>`).join('');
  return `
  <header class="sheethead panel">
    <div class="nameblock">
      <input class="charname" data-k="name" value="${esc(c.name)}" placeholder="Character name" autocomplete="off" spellcheck="false">
      <div class="lvlline">Level ${calc('level')} · Proficiency ${calc('prof')}</div>
    </div>
    <div class="headgrid">
      <div class="hf wide"><span class="lbl">Class &amp; level</span><div data-list="classes">${classes}</div>
        <button class="linkbtn" type="button" data-act="rowadd" data-list="classes">Add a class (multiclass)</button></div>
      <label class="hf"><span class="lbl">Race</span>${txt(c, 'race')}</label>
      <label class="hf"><span class="lbl">Background</span>${txt(c, 'background')}</label>
      <label class="hf"><span class="lbl">Alignment</span>${txt(c, 'alignment')}</label>
      <label class="hf"><span class="lbl">Player name</span>${txt(c, 'player')}</label>
      <label class="hf"><span class="lbl">Experience</span>${txt(c, 'xp')}</label>
      <label class="hf"><span class="lbl">Next level</span>${txt(c, 'nextLevel')}</label>
    </div>
  </header>`;
}

function abilities(c) {
  return `<section class="panel abilities" aria-label="Ability scores">
    ${R.ABILS.map(([k, n]) => `
      <button class="abil" type="button" data-act="abil" data-a="${k}" aria-label="${n}: edit score and sources">
        <span class="an">${n}</span>
        <span class="am">${calc('amod', k)}</span>
        <span class="as">${calc('score', k)}</span>
      </button>`).join('')}
  </section>`;
}

function savesSkills(c) {
  const saves = R.ABILS.map(([k, n]) => `
    <div class="sk">${chk(c, `saves.${k}`, '', `aria-label="Proficient in ${n} saves"`)}<b class="sv">${calc('save', k)}</b><span>${n}</span></div>`).join('');
  const skills = R.SKILLS.map(([k, n, a]) => {
    const rank = Number(c.skills?.[k]) || 0;
    return `<div class="sk"><button type="button" class="rank r${rank}" data-act="rank" data-s="${k}" aria-label="${n}: ${['not proficient', 'proficient', 'expertise'][rank]}. Tap to change."></button><b class="sv">${calc('skill', k)}</b><span>${n} <small>${R.ABIL_SHORT[a]}</small></span></div>`;
  }).join('');
  return `
  <div class="pair">
    ${panel('Inspiration', `<button class="insp ${c.inspiration ? 'on' : ''}" type="button" data-act="insp" aria-pressed="${!!c.inspiration}">${c.inspiration ? 'Inspired' : 'None'}</button>`, 'tiny')}
    ${panel('Proficiency bonus', `<div class="big">${calc('prof')}</div><label class="mini">Override ${nfield(c, 'profOverride', 'auto')}</label>`, 'tiny')}
  </div>
  ${panel('Saving throws', `<div class="sklist">${saves}</div>`)}
  ${panel('Skills', `<div class="sklist">${skills}</div><div class="skfoot">${chk(c, 'jack', 'Jack of All Trades (half proficiency)')}<span class="legend"><i class="rank r1"></i> proficient <i class="rank r2"></i> expertise</span></div>`)}
  ${panel('Passive Wisdom (Perception)', `<div class="big">${calc('passive')}</div>`, 'tiny')}
  ${panel('Proficiencies', `
    <div class="pgroup"><span class="lbl">Armor</span>${chk(c, 'profs.light', 'Light')}${chk(c, 'profs.medium', 'Medium')}${chk(c, 'profs.heavy', 'Heavy')}${chk(c, 'profs.shields', 'Shields')}</div>
    <div class="pgroup"><span class="lbl">Weapons</span>${chk(c, 'profs.simple', 'Simple')}${chk(c, 'profs.martial', 'Martial')}</div>
    <label class="hf"><span class="lbl">Other weapons</span>${txt(c, 'profs.weaponsOther')}</label>
    <label class="hf"><span class="lbl">Tools</span>${area(c, 'profs.tools', '', 2)}</label>`)}
  ${panel('Languages', area(c, 'languages', 'Common, …', 2))}`;
}

function combat(c) {
  const hd = (c.classes || []).map((k, i) => `
    <div class="hdrow"><span>d${esc(k.hd)}${k.name ? ` <small>${esc(k.name)}</small>` : ''}</span>
      <button class="step" type="button" data-act="hd" data-i="${i}" data-d="-1" aria-label="Regain one hit die">−</button>
      <b>${Math.max(0, (Number(k.level) || 0) - (Number(k.hdUsed) || 0))}<small>/${esc(k.level)}</small></b>
      <button class="step" type="button" data-act="hd" data-i="${i}" data-d="1" aria-label="Spend one hit die">+</button>
    </div>`).join('');
  const pips = (key, n, label) => `<div class="pips" role="group" aria-label="${label}">${[1, 2, 3].map(i => `<button type="button" class="pip ${n >= i ? 'on' : ''}" data-act="death" data-w="${key}" data-n="${i}" aria-label="${label} ${i}"></button>`).join('')}</div>`;
  return `
  <section class="panel combatcore">
    <div class="trio">
      <button class="stat ac" type="button" data-act="ac"><span class="lbl">Armor class</span><b>${calc('ac')}</b>${calc('actemp')}</button>
      <label class="stat"><span class="lbl">Initiative</span><b>${calc('init')}</b></label>
      <label class="stat"><span class="lbl">Speed</span><input class="f center" data-k="speed" value="${esc(c.speed)}" autocomplete="off"></label>
    </div>
    <div class="hpbox">
      <div class="hpnums">
        <label><span class="lbl">Current HP</span><input class="f hpcur n" data-k="hp.cur" data-type="num" inputmode="numeric" value="${esc(c.hp.cur)}"></label>
        <span class="slash">/</span>
        <label><span class="lbl">Max HP</span><input class="f n" data-k="hp.max" data-type="num" inputmode="numeric" value="${esc(c.hp.max)}"></label>
        <label><span class="lbl">Temp HP</span><input class="f n" data-k="hp.temp" data-type="num" inputmode="numeric" value="${esc(c.hp.temp)}"></label>
      </div>
      <div class="hpquick">
        <input class="f n" id="hpAmt" inputmode="numeric" placeholder="Amount" aria-label="Amount of damage or healing" autocomplete="off">
        <button class="btn" type="button" data-act="hp" data-how="dmg">Damage</button>
        <button class="btn" type="button" data-act="hp" data-how="heal">Heal</button>
        <button class="btn" type="button" data-act="hp" data-how="temp">Temp HP</button>
      </div>
      <div class="hpbar" aria-hidden="true"><i data-calc="hpbar"></i></div>
    </div>
    <div class="trio">
      <div class="stat"><span class="lbl">Hit dice</span>${hd}</div>
      <div class="stat"><span class="lbl">Death saves</span>
        <div class="ds"><small>Successes</small>${pips('s', c.death.s, 'Success')}</div>
        <div class="ds"><small>Failures</small>${pips('f', c.death.f, 'Failure')}</div></div>
      <div class="stat"><span class="lbl">Exhaustion</span>
        ${sel(c, 'exhaustion', [0, 1, 2, 3, 4, 5, 6].map(n => [n, n === 0 ? 'None' : `Level ${n}`]), 'data-type="num" data-rerender')}
        <small class="exh">${esc(EXHAUSTION[Number(c.exhaustion) || 0])}</small></div>
    </div>
    <label class="hf"><span class="lbl">Vision</span>${txt(c, 'vision', 'Darkvision 60 ft')}</label>
  </section>`;
}
// SRD 5.1 exhaustion levels (each level includes the ones before it)
const EXHAUSTION = ['', 'Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attack rolls and saving throws', 'Hit point maximum halved', 'Speed reduced to 0', 'Death'];

function attacks(c) {
  const rows = (c.attacks || []).map((a, i) => `
    <details class="atk" ${a._new ? 'open' : ''}>
      <summary><span class="an">${esc(a.name) || 'New attack'}</span><b>${calc('atkbonus', i)}</b><span class="ad">${calc('atkdmg', i)}</span></summary>
      <div class="atkedit">
        <label class="hf"><span class="lbl">Name</span><input class="f" data-k="attacks.${i}.name" value="${esc(a.name)}" autocomplete="off"></label>
        <label class="hf"><span class="lbl">Ability</span>${sel(c, `attacks.${i}.abil`, [['str', 'Strength'], ['dex', 'Dexterity'], ['finesse', 'Finesse (best of Str/Dex)'], ['spell', 'Spellcasting ability'], ['con', 'Constitution'], ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma'], ['', 'None']])}</label>
        <label class="hf"><span class="lbl">Extra to-hit</span><input class="f n" data-k="attacks.${i}.bonus" data-type="num" inputmode="numeric" value="${esc(a.bonus)}"></label>
        <label class="hf"><span class="lbl">Damage dice</span><input class="f" data-k="attacks.${i}.dmg" value="${esc(a.dmg)}" placeholder="1d8" autocomplete="off"></label>
        <label class="hf"><span class="lbl">Damage type</span><input class="f" data-k="attacks.${i}.type" value="${esc(a.type)}" placeholder="slashing" autocomplete="off"></label>
        <div class="hf checks">${chk(c, `attacks.${i}.prof`, 'Proficient')}${chk(c, `attacks.${i}.addMod`, 'Add ability to damage')}</div>
        <label class="hf wide"><span class="lbl">Notes</span><input class="f" data-k="attacks.${i}.notes" value="${esc(a.notes)}" placeholder="Range, properties, riders" autocomplete="off"></label>
        <button class="linkbtn danger" type="button" data-act="rowdel" data-list="attacks" data-i="${i}">Remove attack</button>
      </div>
    </details>`).join('');
  return panel('Attacks &amp; spellcasting', `
    <div data-list="attacks" class="atklist">${rows || '<p class="empty">No attacks yet.</p>'}</div>
    <button class="linkbtn" type="button" data-act="rowadd" data-list="attacks">Add an attack</button>
    <div class="spellbox">
      <label class="hf"><span class="lbl">Spellcasting ability</span>${sel(c, 'spell.abil', ABIL_OPTS, 'data-rerender')}</label>
      <div class="stat"><span class="lbl">Spell save DC</span><b>${calc('spelldc')}</b></div>
      <div class="stat"><span class="lbl">Spell attack</span><b>${calc('spellatk')}</b></div>
    </div>
    ${simpleList(c, 'ammo', 'Ammunition', [['name', 'Ammunition', 'f'], ['n', 'Left', 'n']])}`);
}

function equipment(c) {
  const a = c.ac;
  return panel('Equipment', `
    <div class="armorline">
      <span class="lbl">Armor</span>
      <span>${esc(a.mode === 'unarmored' ? 'Unarmored' : (a.armorName || 'Armor'))}</span>
      <span>AC ${calc('acbase')}</span>
      ${a.mode !== 'unarmored' ? `<span>Max Dex ${a.maxDex === '' ? '—' : esc(a.maxDex)}</span><span>Str ${esc(a.str) || '—'}</span>${a.stealthDis ? '<span>Stealth disadv.</span>' : ''}` : ''}
      <span>Shield ${R.sign(Number(a.shield) || 0)}</span>
      <button class="linkbtn" type="button" data-act="ac">Edit</button>
    </div>
    ${simpleList(c, 'consumables', 'Consumables', [['name', 'Consumable', 'f'], ['n', 'Left', 'n']])}
    <div class="attune">
      <div class="lh"><span class="lbl">Attuned magic items</span><span class="count">${calc('attuned')}</span></div>
      ${simpleList(c, 'attuned', '', [['name', 'Item', 'f'], ['notes', 'Notes', 'f']], true)}
      <label class="mini">Attunement limit ${nfield(c, 'attuneMax')}</label>
    </div>`);
}

function simpleList(c, path, title, cols, bare = false) {
  const list = getPath(c, path) || [];
  const rows = list.map((r, i) => `<div class="srow">${cols.map(([k, ph, kind]) => kind === 'n'
    ? `<input class="f n" data-k="${path}.${i}.${k}" data-type="num" inputmode="numeric" value="${esc(r[k])}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">`
    : `<input class="f" data-k="${path}.${i}.${k}" value="${esc(r[k])}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" autocomplete="off">`).join('')}
    <button class="x" type="button" data-act="rowdel" data-list="${path}" data-i="${i}" aria-label="Remove">×</button></div>`).join('');
  return `<div class="slist">${title && !bare ? `<span class="lbl">${title}</span>` : ''}<div data-list="${path}">${rows}</div>
    <button class="linkbtn" type="button" data-act="rowadd" data-list="${path}">Add ${title ? title.toLowerCase().replace(/s$/, '') : 'one'}</button></div>`;
}

function limited(c) {
  const rec = [['Short rest', 'Short rest'], ['Long rest', 'Long rest'], ['Dawn', 'Dawn'], ['Other', 'Other']];
  const rows = (c.limited || []).map((f, i) => {
    const total = Math.max(0, Number(f.total) || 0), left = Math.max(0, Math.min(total, Number(f.left) || 0));
    const dots = total && total <= 12
      ? `<div class="uses">${Array.from({ length: total }, (_, n) => `<button type="button" class="use ${n < left ? 'on' : ''}" data-act="use" data-i="${i}" data-n="${n}" aria-label="Use ${n + 1}"></button>`).join('')}</div>`
      : `<input class="f n" data-k="limited.${i}.left" data-type="num" inputmode="numeric" value="${esc(f.left)}" aria-label="Uses left">`;
    return `<div class="lim">
      <input class="f" data-k="limited.${i}.name" value="${esc(f.name)}" placeholder="Feature" autocomplete="off" aria-label="Feature name">
      <select class="f" data-k="limited.${i}.rec" aria-label="Recovers on">${rec.map(([v, l]) => `<option ${f.rec === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="mini">Total <input class="f n" data-k="limited.${i}.total" data-type="num" inputmode="numeric" value="${esc(f.total)}" data-rerender></label>
      ${dots}
      <button class="x" type="button" data-act="rowdel" data-list="limited" data-i="${i}" aria-label="Remove">×</button>
    </div>`;
  }).join('');
  return panel('Limited features', `<div data-list="limited">${rows || '<p class="empty">Rage, Ki, Channel Divinity, Bardic Inspiration…</p>'}</div>
    <button class="linkbtn" type="button" data-act="rowadd" data-list="limited">Add a limited feature</button>
    <div class="abdc">
      <label class="hf"><span class="lbl">Ability save DC for</span>${txt(c, 'abilityDc.label', 'Ki, maneuvers…')}</label>
      <label class="hf"><span class="lbl">Ability</span>${sel(c, 'abilityDc.abil', ABIL_OPTS, 'data-rerender')}</label>
      <div class="stat"><span class="lbl">DC</span><b>${calc('abdc')}</b></div>
    </div>`);
}

function featureList(c, path, title, opts = {}) {
  const list = getPath(c, path) || [];
  const rows = list.map((f, i) => `
    <details class="feat" ${f._new ? 'open' : ''}>
      <summary><span>${esc(f.name) || 'Untitled'}</span>${opts.src && f.src ? `<small class="src">${esc(f.src)}</small>` : ''}</summary>
      <div class="featedit">
        <input class="f" data-k="${path}.${i}.name" value="${esc(f.name)}" placeholder="Name" autocomplete="off" aria-label="Name">
        ${opts.src ? `<input class="f" data-k="${path}.${i}.src" value="${esc(f.src)}" placeholder="Where it came from (Background, Level 4…)" autocomplete="off" aria-label="Source">` : ''}
        <textarea class="f" data-k="${path}.${i}.text" rows="4" placeholder="Full text" aria-label="Text">${esc(f.text)}</textarea>
        <button class="linkbtn danger" type="button" data-act="rowdel" data-list="${path}" data-i="${i}">Remove</button>
      </div>
    </details>`).join('');
  return panel(title, `<div data-list="${path}">${rows || `<p class="empty">${opts.empty || 'Nothing yet.'}</p>`}</div>
    <button class="linkbtn" type="button" data-act="rowadd" data-list="${path}">Add ${opts.one || 'one'}</button>`, opts.cls || '');
}

function defenses(c) {
  const groups = R.DEFENSE_KINDS.map(([k, n]) => {
    const items = (c.defenses || []).map((d, i) => [d, i]).filter(([d]) => d.kind === k);
    return `<div class="dgroup"><span class="lbl">${n}</span>${items.length ? items.map(([d, i]) => `
      <div class="srow"><input class="f" data-k="defenses.${i}.what" value="${esc(d.what)}" placeholder="${k === 'cond' ? 'Poisoned' : 'Fire'}" aria-label="${n}" autocomplete="off">
      <input class="f" data-k="defenses.${i}.src" value="${esc(d.src)}" placeholder="From (Tiefling, ring…)" aria-label="Source" autocomplete="off">
      <button class="x" type="button" data-act="rowdel" data-list="defenses" data-i="${i}" aria-label="Remove">×</button></div>`).join('') : '<p class="empty">None</p>'}
      <button class="linkbtn" type="button" data-act="defadd" data-kind="${k}">Add</button></div>`;
  }).join('');
  return panel('Defenses', `<div data-list="defenses" class="defs">${groups}</div>`);
}

function pageSheet(c) {
  return `${header(c)}
  <div class="cols">
    <div class="col colA">${abilities(c)}<div class="stack">${savesSkills(c)}</div></div>
    <div class="col colB">${combat(c)}${attacks(c)}${equipment(c)}</div>
    <div class="col colC">${limited(c)}
      ${panel('Background feature', `${txt(c, 'bgFeature.name', 'Feature name')}${area(c, 'bgFeature.text', 'Full text', 3)}`)}
      ${featureList(c, 'racial', 'Racial traits', { one: 'a trait', empty: 'Darkvision, ancestry traits…' })}
      ${featureList(c, 'classFeat', 'Class features', { one: 'a feature' })}
      ${featureList(c, 'feats', 'Feats', { one: 'a feat', src: true, empty: 'Your background feat goes here.' })}
      ${defenses(c)}
    </div>
  </div>`;
}

/* ---------- page: character ---------- */
function imgSlot(c, path, label) {
  const src = getPath(c, path);
  return `<div class="imgslot">${src ? `<img src="${src}" alt="${esc(label)}">` : `<span class="empty">${esc(label)}</span>`}
    <div class="row"><label class="btn small"><input type="file" accept="image/*" data-img="${path}" hidden>${src ? 'Replace picture' : 'Add picture'}</label>
    ${src ? `<button class="btn small" type="button" data-act="imgdel" data-p="${path}">Remove</button>` : ''}</div></div>`;
}
function pageCharacter(c) {
  return `
  <header class="sheethead panel">
    <div class="nameblock"><div class="charname static">${esc(c.name) || 'Unnamed character'}</div></div>
    <div class="headgrid six">
      ${['age', 'height', 'weight', 'eyes', 'skin', 'hair'].map(k => `<label class="hf"><span class="lbl">${k[0].toUpperCase() + k.slice(1)}</span>${txt(c, `desc.${k}`)}</label>`).join('')}
    </div>
  </header>
  <div class="cols three">
    <div class="col">${panel('Character appearance', `${imgSlot(c, 'desc.portrait', 'Portrait')}${area(c, 'desc.appearance', 'What others see', 5)}`)}
      ${featureList(c, 'extraFeat', 'Additional features &amp; traits', { one: 'a feature' })}</div>
    <div class="col">${panel('Faction', `<label class="hf"><span class="lbl">Name</span>${txt(c, 'faction.name')}</label>${imgSlot(c, 'faction.symbol', 'Symbol')}${area(c, 'faction.notes', 'Rank, contacts, standing', 5)}`)}
      ${panel('Notes', area(c, 'notes', 'Anything else', 8))}</div>
    <div class="col">${[['personality', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws'], ['enemies', 'Enemies']].map(([k, n]) => panel(n, area(c, k, '', 3))).join('')}</div>
  </div>`;
}

/* ---------- page: inventory ---------- */
function pageInventory(c) {
  const cats = R.INV_CATS.map(([k, n]) => {
    const rows = (c.inv[k] || []).map((r, i) => `
      <tr>
        <td><input class="f" data-k="inv.${k}.${i}.name" value="${esc(r.name)}" aria-label="Item name" autocomplete="off"></td>
        <td><input class="f n" data-k="inv.${k}.${i}.wt" data-type="num" inputmode="decimal" value="${esc(r.wt)}" aria-label="Weight each"></td>
        <td><input class="f n" data-k="inv.${k}.${i}.qty" data-type="num" inputmode="numeric" value="${esc(r.qty)}" aria-label="Quantity"></td>
        <td class="num">${calc('rowwt', `${k}.${i}`)}</td>
        <td class="ctr"><input type="checkbox" data-k="inv.${k}.${i}.magic" ${r.magic ? 'checked' : ''} aria-label="Magical"></td>
        <td><input class="f" data-k="inv.${k}.${i}.desc" value="${esc(r.desc)}" aria-label="Description" autocomplete="off"></td>
        <td><button class="x" type="button" data-act="rowdel" data-list="inv.${k}" data-i="${i}" aria-label="Remove">×</button></td>
      </tr>`).join('');
    return panel(n, `<div class="tablewrap"><table class="inv">
      <thead><tr><th>Item</th><th>Weight each</th><th>Qty</th><th>Weight</th><th>Magical</th><th>Description</th><th></th></tr></thead>
      <tbody data-list="inv.${k}">${rows}</tbody></table></div>
      <div class="invfoot"><button class="linkbtn" type="button" data-act="rowadd" data-list="inv.${k}">Add to ${esc(n)}</button><span class="sub">${calc('catwt', k)}</span></div>`, 'invcat');
  }).join('');
  const coins = R.COINS.map(([k, n]) => `<label class="coin c-${k}"><span class="lbl">${n}</span><input class="f n" data-k="coins.${k}" data-type="num" inputmode="numeric" value="${esc(c.coins[k])}"></label>`).join('');
  return `
  <section class="panel carry">
    <div class="carrynums">
      <div class="stat"><span class="lbl">Current weight</span><b>${calc('carried')}</b></div>
      <div class="stat"><span class="lbl">Carrying capacity</span><b>${calc('capacity')}</b></div>
      ${chk(c, 'powerful', 'Powerful Build (double)')}
    </div>
    <div class="carrybar"><i data-calc="carrybar"></i></div>
    <p class="warn" data-calc="carrywarn"></p>
  </section>
  ${panel('Coins', `<div class="coins">${coins}</div>
    <div class="coinfoot"><span class="sub">100 coins weigh 1 lb · ${calc('coinwt')}</span>
    <button class="btn small" type="button" data-act="consolidate">Consolidate into gold, silver, copper</button></div>
    <p class="hint">10 copper = 1 silver · 5 silver = 1 electrum · 2 electrum = 1 gold · 10 gold = 1 platinum. Consolidating leaves platinum alone.</p>`)}
  <div class="invgrid">${cats}</div>`;
}

/* ---------- the Look drawer ---------- */
export function lookPanel(c) {
  const t = c.theme;
  return `
  <div class="lookin">
    <div class="lookhead"><h2>Look</h2><button class="btn icon" type="button" data-act="lookclose" aria-label="Close Look">×</button></div>
    <p class="hint">Only this character changes. Every device you open it on shows the same look.</p>

    <h3>Palette</h3>
    <div class="swatches">${Object.entries(PRESETS).map(([k, p]) => `
      <button type="button" class="preset ${t.preset === k ? 'on' : ''}" data-act="preset" data-v="${k}" style="--sw-a:${p.page};--sw-b:${p.panel};--sw-c:${p.accent};--sw-t:${p.text}">
        <span class="chip"><i></i><i></i><i></i></span>${p.name}</button>`).join('')}</div>

    <h3>Accent color</h3>
    <div class="accents">${CLASS_ACCENTS.map(([n, h]) => `<button type="button" class="acc ${t.accent === h ? 'on' : ''}" data-act="accent" data-v="${h}" style="--sw:${h}" title="${n}" aria-label="${n} accent"></button>`).join('')}
      <label class="acc custom" title="Any color"><input type="color" data-theme-k="accent" value="${t.accent || (PRESETS[t.preset] || PRESETS.night).accent}" aria-label="Pick any accent color"></label>
      <button type="button" class="linkbtn" data-act="accent" data-v="">Palette default</button></div>

    <h3>Heading font</h3>
    <div class="fonts">${Object.entries(HEAD_FONTS).map(([k, [n, fam]]) => `<button type="button" class="fontbtn ${t.head === k ? 'on' : ''}" data-act="font" data-w="head" data-v="${k}" style="font-family:${esc(fam)}">${esc(c.name || n)}</button>`).join('')}</div>
    <h3>Text font</h3>
    <div class="fonts two">${Object.entries(BODY_FONTS).map(([k, [n, fam]]) => `<button type="button" class="fontbtn body ${t.body === k ? 'on' : ''}" data-act="font" data-w="body" data-v="${k}" style="font-family:${esc(fam)}">${esc(n)}</button>`).join('')}</div>

    <h3>Frame</h3>
    <div class="frames">${Object.entries(FRAMES).map(([k, n]) => `<button type="button" class="framebtn ${t.frame === k ? 'on' : ''}" data-act="frame" data-v="${k}" data-frame-demo="${k}">${n}</button>`).join('')}</div>

    <h3>Background picture</h3>
    <div class="bgpick">
      ${t.bg.img ? `<img src="${t.bg.img}" alt="Current background">` : '<span class="empty">No picture. The palette color shows instead.</span>'}
      <div class="row"><label class="btn small"><input type="file" accept="image/*" data-bgimg hidden>${t.bg.img ? 'Replace picture' : 'Choose a picture'}</label>
      ${t.bg.img ? '<button class="btn small" type="button" data-act="bgdel">Remove</button>' : ''}</div>
    </div>
    ${t.bg.img ? `
    <div class="seg" role="group" aria-label="How the picture fits">${[['cover', 'Fill'], ['contain', 'Fit whole picture'], ['tile', 'Tile']].map(([v, l]) => `<button type="button" data-act="bgfit" data-v="${v}" aria-pressed="${t.bg.fit === v}">${l}</button>`).join('')}</div>
    <label class="range"><span>Blur</span><input type="range" min="0" max="20" step="1" data-theme-k="bg.blur" value="${t.bg.blur}"></label>
    <label class="range"><span>Darken</span><input type="range" min="0" max="85" step="5" data-theme-k="bg.dim" value="${t.bg.dim}"></label>` : ''}
    <label class="range"><span>Panel see-through</span><input type="range" min="40" max="100" step="2" data-theme-k="panel" value="${t.panel}" style="direction:rtl"></label>
    <p class="hint">Slide left for solid panels, right to let the picture show through.</p>
  </div>`;
}

/* ---------- render + live math ---------- */
export function renderPage(root, c, page) {
  root.innerHTML = page === 'character' ? pageCharacter(c) : page === 'inventory' ? pageInventory(c) : pageSheet(c);
  root.dataset.page = page;
  updateCalcs(root, c);
}

export function updateCalcs(root, c) {
  for (const el of root.querySelectorAll('[data-calc]')) {
    const k = el.dataset.calc, a = el.dataset.arg;
    let out = '';
    switch (k) {
      case 'level': out = R.totalLevel(c); break;
      case 'prof': out = R.sign(R.prof(c)); break;
      case 'amod': out = R.sign(R.amod(c, a)); break;
      case 'score': out = R.score(c, a); break;
      case 'save': out = R.sign(R.save(c, a)); break;
      case 'skill': out = R.sign(R.skill(c, a)); break;
      case 'passive': out = R.passivePerception(c); break;
      case 'init': out = R.sign(R.initiative(c)); break;
      case 'ac': { const ac = R.armorClass(c); out = ac.withTemp; break; }
      case 'acbase': out = R.armorClass(c).total; break;
      case 'actemp': { const t = Number(c.ac.temp) || 0; out = t ? `<small>includes ${R.sign(t)} temp</small>` : ''; el.innerHTML = out; continue; }
      case 'spelldc': out = c.spell.abil ? R.saveDc(c, c.spell.abil) : '—'; break;
      case 'spellatk': out = c.spell.abil ? R.sign(R.spellAttack(c, c.spell.abil)) : '—'; break;
      case 'abdc': out = c.abilityDc.abil ? R.saveDc(c, c.abilityDc.abil) : '—'; break;
      case 'atkbonus': { const atk = c.attacks[a]; out = atk ? R.sign(R.attackBonus(c, atk)) : ''; break; }
      case 'atkdmg': { const atk = c.attacks[a]; out = atk ? R.damageText(c, atk) : ''; break; }
      case 'attuned': { const n = (c.attuned || []).filter(x => x.name).length, max = Number(c.attuneMax) || 3; out = `${n} of ${max}`; el.classList.toggle('over', n > max); break; }
      case 'hpbar': {
        const max = Number(c.hp.max) || 0, cur = Math.max(0, Number(c.hp.cur) || 0), tmp = Math.max(0, Number(c.hp.temp) || 0);
        const pct = max ? Math.min(100, (cur / max) * 100) : 0;
        el.style.width = `${pct}%`; el.parentElement.style.setProperty('--tmp', max ? `${Math.min(100 - pct, (tmp / max) * 100)}%` : '0%');
        el.parentElement.dataset.low = pct <= 25 ? 'y' : pct <= 50 ? 'm' : '';
        continue;
      }
      case 'rowwt': { const [cat, i] = a.split('.'); const r = c.inv[cat]?.[i]; out = r ? fmtLb(R.rowWeight(r)) : ''; break; }
      case 'catwt': out = `${fmtLb((c.inv[a] || []).reduce((t, r) => t + R.rowWeight(r), 0))} in this section`; break;
      case 'coinwt': out = `${fmtLb(R.coinWeight(c))} in coins`; break;
      case 'carried': out = fmtLb(R.carried(c)); break;
      case 'capacity': out = fmtLb(R.capacity(c)); break;
      case 'carrybar': { const cap = R.capacity(c) || 1, w = R.carried(c); el.style.width = `${Math.min(100, (w / cap) * 100)}%`; el.parentElement.dataset.over = w > cap ? 'y' : ''; continue; }
      case 'carrywarn': { const cap = R.capacity(c), w = R.carried(c); out = w > cap ? `Over capacity by ${fmtLb(Math.round((w - cap) * 100) / 100)}. Ask your DM how that slows you down.` : ''; el.hidden = !out; break; }
      default: continue;
    }
    el.textContent = out;
  }
}
const fmtLb = n => `${Math.round(n * 100) / 100} lb`;

/* ---------- editing ---------- */
// Which path a change should stamp: a list edit stamps the whole list
function stampPathFor(el, path) {
  const list = el.closest('[data-list]');
  return list ? list.dataset.list : path;
}

export function bindSheet(root, getChar) {
  root.addEventListener('input', e => {
    const el = e.target;
    if (el.matches('[data-theme-k]')) return themeInput(el, getChar());
    if (!el.dataset.k || el.type === 'checkbox' || el.tagName === 'SELECT') return;
    const c = getChar();
    let v = el.value;
    if (el.dataset.type === 'num') v = v.trim() === '' ? '' : (Number.isFinite(Number(v)) ? Number(v) : v);
    setPath(c, el.dataset.k, v);
    stamp(c, stampPathFor(el, el.dataset.k));
    // keep summary labels in step while typing
    const det = el.closest('details');
    if (det && /\.name$/.test(el.dataset.k)) { const s = det.querySelector('summary > span'); if (s) s.textContent = v || (det.classList.contains('atk') ? 'New attack' : 'Untitled'); }
    if (el.dataset.k === 'name') ctx.titleChanged();
    updateCalcs(root, c);
    ctx.save(c);
  });
  root.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('[data-theme-k]')) return themeInput(el, getChar(), true);
    if (el.matches('[data-img]')) return pickImage(el, getChar(), el.dataset.img, 800);
    if (el.matches('[data-bgimg]')) return pickImage(el, getChar(), 'theme.bg.img', 1920);
    if (!el.dataset.k) return;
    const c = getChar();
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.type === 'num' && el.type !== 'checkbox') v = Number(v);
    if (el.type === 'checkbox' || el.tagName === 'SELECT') {
      setPath(c, el.dataset.k, v);
      stamp(c, stampPathFor(el, el.dataset.k));
    }
    updateCalcs(root, c);
    ctx.save(c);
    if (el.hasAttribute('data-rerender')) ctx.rerender();
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    act(b, getChar(), root);
  });
}

function act(b, c, root) {
  const d = b.dataset;
  const touch = (path, rerender = true) => { stamp(c, path); ctx.save(c); if (rerender) ctx.rerender(); else updateCalcs(root, c); };
  switch (d.act) {
    case 'rowadd': {
      const list = getPath(c, d.list) || [];
      const blank = {
        classes: { name: '', sub: '', level: 1, hd: 8, hdUsed: 0 },
        attacks: { name: '', abil: 'str', prof: true, bonus: 0, dmg: '', addMod: true, type: '', notes: '' },
        limited: { name: '', rec: 'Long rest', total: 1, left: 1 },
      }[d.list] || (d.list.startsWith('inv.') ? { name: '', wt: '', qty: 1, magic: false, desc: '' } : { name: '', text: '' });
      list.push({ ...blank, id: uid() });
      setPath(c, d.list, list);
      ctx.openNew = `${d.list}.${list.length - 1}`;
      return touch(d.list);
    }
    case 'rowdel': {
      const list = getPath(c, d.list) || [];
      const item = list[d.i];
      const named = item && (item.name || item.what);
      if (named && !confirm(`Remove ${named}?`)) return;
      list.splice(Number(d.i), 1);
      return touch(d.list);
    }
    case 'defadd': c.defenses.push({ kind: d.kind, what: '', src: '', id: uid() }); ctx.openNew = `defenses.${c.defenses.length - 1}`; return touch('defenses');
    case 'rank': { const k = d.s; c.skills[k] = ((Number(c.skills[k]) || 0) + 1) % 3; return touch(`skills.${k}`); }
    case 'insp': c.inspiration = !c.inspiration; return touch('inspiration');
    case 'death': {
      const cur = Number(c.death[d.w]) || 0, n = Number(d.n);
      c.death[d.w] = cur === n ? n - 1 : n;
      return touch(`death.${d.w}`);
    }
    case 'hd': {
      const k = c.classes[d.i]; if (!k) return;
      k.hdUsed = Math.max(0, Math.min(Number(k.level) || 0, (Number(k.hdUsed) || 0) + Number(d.d)));
      return touch('classes');
    }
    case 'use': {
      const f = c.limited[d.i]; const n = Number(d.n);
      f.left = n < (Number(f.left) || 0) ? n : n + 1; // tap a filled dot to spend down to it, an empty one to fill up to it
      return touch('limited');
    }
    case 'hp': {
      const amt = Math.abs(parseInt(document.querySelector('#hpAmt')?.value, 10));
      if (!amt) { ctx.toast('Type an amount first.'); document.querySelector('#hpAmt')?.focus(); return; }
      const hp = c.hp, max = Number(hp.max) || 0;
      if (d.how === 'dmg') {
        const fromTemp = Math.min(Number(hp.temp) || 0, amt);
        hp.temp = (Number(hp.temp) || 0) - fromTemp;
        hp.cur = Math.max(0, (Number(hp.cur) || 0) - (amt - fromTemp));
        stamp(c, 'hp.temp'); stamp(c, 'hp.cur');
        ctx.toast(fromTemp ? `Took ${amt}: ${fromTemp} from temp HP, ${amt - fromTemp} from HP.` : `Took ${amt} damage.`);
      } else if (d.how === 'heal') {
        hp.cur = max ? Math.min(max, (Number(hp.cur) || 0) + amt) : (Number(hp.cur) || 0) + amt;
        stamp(c, 'hp.cur');
        ctx.toast(`Healed ${amt}.`);
      } else {
        // temp HP doesn't stack: keep the higher
        const before = Number(hp.temp) || 0;
        hp.temp = Math.max(before, amt);
        stamp(c, 'hp.temp');
        ctx.toast(amt > before ? `Temp HP is now ${amt}.` : `Kept your current ${before} temp HP (temp HP doesn't stack).`);
      }
      ctx.save(c); return ctx.rerender();
    }
    case 'consolidate': c.coins = R.consolidateCoins(c.coins); ctx.toast('Coins consolidated.'); return touch('coins');
    case 'imgdel': setPath(c, d.p, ''); return touch(d.p);
    case 'abil': return ctx.openAbility(d.a);
    case 'ac': return ctx.openAc();
    // Look drawer
    case 'preset': c.theme.preset = d.v; return themeTouch(c, 'theme.preset');
    case 'accent': c.theme.accent = d.v; return themeTouch(c, 'theme.accent');
    case 'font': c.theme[d.w] = d.v; return themeTouch(c, `theme.${d.w}`);
    case 'frame': c.theme.frame = d.v; return themeTouch(c, 'theme.frame');
    case 'bgfit': c.theme.bg.fit = d.v; return themeTouch(c, 'theme.bg.fit');
    case 'bgdel': c.theme.bg.img = ''; return themeTouch(c, 'theme.bg.img');
    case 'lookclose': return ctx.closeLook();
  }
}

function themeTouch(c, path) { stamp(c, path); ctx.save(c); ctx.themeChanged(true); }
function themeInput(el, c, done) {
  const p = `theme.${el.dataset.themeK}`;
  setPath(c, p, el.type === 'range' ? Number(el.value) : el.value);
  stamp(c, p);
  ctx.save(c);
  ctx.themeChanged(!!done && el.type === 'color');
}

/* ---------- pictures: shrink before storing so sheets stay light enough to sync ---------- */
async function pickImage(input, c, path, maxEdge) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const url = await shrink(file, maxEdge, path === 'faction.symbol');
    setPath(c, path, url);
    stamp(c, path);
    ctx.save(c);
    if (path === 'theme.bg.img') ctx.themeChanged(true); else ctx.rerender();
  } catch {
    ctx.toast("That picture couldn't be opened. Try a JPG or PNG.");
  }
}
export function shrink(file, maxEdge, keepAlpha = false) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      resolve(keepAlpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export { applyTheme };
