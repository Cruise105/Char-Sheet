// Renders a character's pages and keeps the math live as fields change.
import * as R from './rules.js';
import { getPath, setPath, stamp, uid, hpOp } from './model.js';
import { PRESETS, CLASS_ACCENTS, HEAD_FONTS, BODY_FONTS, FRAMES, applyTheme } from './theme.js';
import * as L from './library.js';
import { choicesFor } from './autofill.js';
import * as M from './magic.js';
import * as O from './options.js';
import * as T from './tables.js';
import * as CR from './creatures.js';
import * as INF from './infuse.js';
import { renderThumb, openInkEditor } from './ink.js';

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
const fmt = t => esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
const calc = (key, arg = '') => `<span data-calc="${key}" data-arg="${arg}"></span>`;
const panel = (title, body, cls = '', extra = '') => `<section class="panel ${cls}" ${extra}><h3 class="ph">${title}</h3>${body}</section>`;
// Active Initiative (Darker Dungeons): one Interrupt Point, Ready / Spent / Recharging
function interruptPoint(c) {
  const st = ['ready', 'spent', 'recharging'].includes(c.ip) ? c.ip : 'ready';
  const label = { ready: 'Ready', spent: 'Spent', recharging: 'Recharging' }[st];
  const hint = { ready: 'Tap when you use it', spent: 'Taking HP damage recharges it', recharging: 'Usable next round. Tap at the start of the round.' }[st];
  return `<button class="stat ipt" type="button" data-act="ip" data-state="${st}" aria-label="Interrupt Point: ${label}. ${hint}">
    <span class="lbl">Interrupt Point</span><i class="token" aria-hidden="true"></i><b class="ipl">${label}</b><small>${hint}</small></button>`;
}
/* ---------- reminders: features flagged to show up where they matter ---------- */
export const REMIND_ON = [['', 'No reminder'], ['saves', 'Saving throws'], ['checks', 'Ability checks'], ['attacks', 'Attacks'], ['turn', 'Start of my turn'], ['conc', 'Concentration spells']];
const REMIND_LISTS = ['racial', 'classFeat', 'feats', 'extraFeat'];
export function reminderText(c, f) {
  const t = f.remind?.text || f.name || '';
  return T.fillAll(c, t);
}
export function remindersFor(c, on) {
  const out = [];
  for (const l of REMIND_LISTS) for (const f of c[l] || []) if (f.remind?.on === on) out.push(reminderText(c, f));
  for (const p of c.options || []) { const o = L.get(p.id); if (o?.remind?.on === on) out.push(reminderText(c, { ...o, remind: { ...o.remind, text: o.remind.text || o.name } })); }
  return out;
}
const remindBox = (c, on) => { const r = remindersFor(c, on); return r.length ? `<ul class="reminders">${r.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''; };
/* ---------- what players can't change ----------
   Anything that comes from the DM's Library (race, class, subclass, background, feats, spells, languages, boons)
   is read-only on a player's device. The DM's device can change everything. */
const isPlayer = () => !!ctx.isPlayer?.();
const ro = (v, ph = '') => `<div class="rofield">${v ? esc(v) : `<span class="empty">${esc(ph || '—')}</span>`}</div>`;
const roArea = (v, ph = '') => `<div class="rofield area">${v ? esc(v).replace(/\n/g, '<br>') : `<span class="empty">${esc(ph || '—')}</span>`}</div>`;
const lockedSkill = (c, k) => isPlayer() && (c.autoFlags || []).includes(`skills.${k}`);
// saves from the class are locked; players can add saves they earn through training
const lockedSave = (c, k) => isPlayer() && (c.autoFlags || []).includes(`saves.${k}`);
// text box for the DM, plain text for players
const txtL = (c, p, ph = '') => (isPlayer() ? ro(val(c, p), ph) : txt(c, p, ph));
const areaL = (c, p, ph = '', rows = 3) => (isPlayer() ? roArea(val(c, p), ph) : area(c, p, ph, rows));
const chkL = (c, p, label = '', extra = '') => chk(c, p, label, `${extra} ${isPlayer() ? 'disabled' : ''}`);
const ABIL_OPTS = [['', '—'], ...R.ABILS.map(([k, n]) => [k, n])];

/* ---------- page: the main sheet ---------- */
function header(c) {
  const classes = (c.classes || []).map((k, i) => `
    <div class="clsrow">
      <span class="pickf">${pickInput(`classes.${i}.name`, k.name, 'Class', 'dl-class', k.clsId)}</span>
      <span class="pickf">${pickInput(`classes.${i}.sub`, k.sub, 'Subclass', `dl-sub-${i}`, k.subId)}</span>
      ${isPlayer() ? `<span class="mini">Lvl <b>${esc(k.level)}</b></span><span class="mini">Hit die <b>d${esc(k.hd)}</b></span>` : `
      <label class="mini">Lvl <input class="f n" data-k="classes.${i}.level" data-type="num" inputmode="numeric" value="${esc(k.level)}" data-pick></label>
      <label class="mini">Hit die <select class="f" data-k="classes.${i}.hd" data-type="num" data-rerender>${[6, 8, 10, 12].map(d => `<option value="${d}" ${Number(k.hd) === d ? 'selected' : ''}>d${d}</option>`).join('')}</select></label>
      ${c.classes.length > 1 ? `<button class="x" type="button" data-act="rowdel" data-list="classes" data-i="${i}" aria-label="Remove this class">×</button>` : ''}`}
    </div>`).join('');
  return `
  <header class="sheethead panel">
    <div class="nameblock">
      <input class="charname" data-k="name" value="${esc(c.name)}" placeholder="Character name" autocomplete="off" spellcheck="false">
      <div class="lvlline">Level ${calc('level')} · Proficiency ${calc('prof')}</div>
      <div class="restbar">
        <button class="btn small primary" type="button" data-act="levelup">Level up</button>
        ${readyToLevel(c) ? '<span class="readybadge">Ready to level up</span>' : ''}
        <button class="btn small" type="button" data-act="shortrest">Short rest</button>
        <button class="btn small" type="button" data-act="longrest">Long rest</button>
      </div>
    </div>
    <div class="headgrid">
      <div class="hf wide"><span class="lbl">Class &amp; level</span><div data-list="classes">${classes}</div>
        ${isPlayer() ? '' : '<button class="linkbtn" type="button" data-act="rowadd" data-list="classes">Add a class (multiclass)</button>'}</div>
      <div class="hf"><span class="lbl">Race</span>${pickInput('race', c.race, 'Pick or type', 'dl-race', c.raceId)}</div>
      <div class="hf"><span class="lbl">Background</span>${pickInput('background', c.background, 'Pick or type', 'dl-bg', c.bgId)}</div>
      <label class="hf"><span class="lbl">Alignment</span>${txt(c, 'alignment')}</label>
      <label class="hf"><span class="lbl">Player name</span>${txt(c, 'player')}</label>
      ${xpBlock(c)}
    </div>
    ${datalists(c)}
    ${(() => { const ch = choicesFor(c); return ch.length ? `<ul class="choices">${ch.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''; })()}
  </header>`;
}
// Experience points (table-wide switch): Next Level comes from the XP table
function xpBlock(c) {
  if (L.tableSettings().leveling === 'milestone') return `<div class="hf wide2"><span class="lbl">Experience</span><p class="milestone">Milestone leveling. Level up when your DM says so.</p></div>`;
  const lvl = R.totalLevel(c), next = R.XP_TABLE[lvl] ?? null, prev = R.XP_TABLE[lvl - 1] || 0, xp = Number(c.xp) || 0;
  const pct = next ? Math.max(0, Math.min(100, ((xp - prev) / (next - prev)) * 100)) : 100;
  return `<div class="hf"><span class="lbl">Experience</span><input class="f n xpf" data-k="xp" data-type="num" inputmode="numeric" value="${esc(c.xp)}" data-rerender autocomplete="off"></div>
    <div class="hf"><span class="lbl">Next level</span><div class="nextlvl">${next ? next.toLocaleString() : 'Max level'}</div><div class="xpbar" aria-hidden="true"><i style="width:${pct}%"></i></div></div>
    <div class="hf xpadd"><span class="lbl">Add XP</span><div class="row"><input class="f n" id="xpAdd" inputmode="numeric" placeholder="0" aria-label="XP to add" autocomplete="off"><button class="btn small" type="button" data-act="xpadd">Add</button></div></div>`;
}
export function readyToLevel(c) {
  if (L.tableSettings().leveling === 'milestone') return false;
  const next = R.XP_TABLE[R.totalLevel(c)];
  return next != null && (Number(c.xp) || 0) >= next && R.totalLevel(c) < 20;
}
// A text box that suggests library entries; the info button opens the full entry
function pickInput(path, value, ph, list, id) {
  const info = id ? `<button class="info" type="button" data-act="libview" data-id="${id}" aria-label="Read ${esc(value)}">i</button>` : '';
  if (isPlayer()) return `<span class="pick">${ro(value, ph === 'Pick or type' ? 'Your DM sets this' : ph)}${info}</span>`;
  return `<span class="pick"><input class="f" data-k="${path}" data-pick list="${list}" value="${esc(value)}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false">${id ? `<button class="info" type="button" data-act="libview" data-id="${id}" aria-label="Read ${esc(value)}">i</button>` : ''}</span>`;
}
function datalists(c) {
  const opts = list => list.map(e => `<option value="${esc(e.name)}">${e.parent && e.type === 'race' ? esc(L.get(e.parent)?.name || '') : ''}</option>`).join('');
  return `<datalist id="dl-race">${opts(L.all('race'))}</datalist><datalist id="dl-bg">${opts(L.all('background'))}</datalist><datalist id="dl-class">${opts(L.all('class'))}</datalist>
    ${(c.classes || []).map((k, i) => `<datalist id="dl-sub-${i}">${opts(k.clsId ? L.subclassesOf(k.clsId) : L.all('subclass'))}</datalist>`).join('')}`;
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
    <div class="sk">${chk(c, `saves.${k}`, '', `aria-label="Proficient in ${n} saves" ${lockedSave(c, k) ? 'disabled title="From your class"' : ''}`)}<b class="sv">${calc('save', k)}</b><span>${n}</span></div>`).join('');
  const skills = R.SKILLS.map(([k, n, a]) => {
    const rank = Number(c.skills?.[k]) || 0;
    const lk = lockedSkill(c, k);
    return `<div class="sk"><button type="button" class="rank r${rank} ${lk ? 'locked' : ''}" data-act="rank" data-s="${k}" ${lk ? 'disabled title="From your race, class or background"' : ''} aria-label="${n}: ${['not proficient', 'proficient', 'expertise'][rank]}.${lk ? ' Set by your race, class or background.' : ' Tap to change.'}"></button><b class="sv">${calc('skill', k)}</b><span>${n} <small>${R.ABIL_SHORT[a]}</small></span></div>`;
  }).join('');
  return {
    pair: `<div class="pair">
      ${panel('Inspiration', `<button class="insp ${c.inspiration ? 'on' : ''}" type="button" data-act="insp" aria-pressed="${!!c.inspiration}">${c.inspiration ? 'Inspired' : 'None'}</button>`, 'tiny')}
      ${panel('Proficiency bonus', `<div class="big">${calc('prof')}</div><label class="mini">Override ${nfield(c, 'profOverride', 'auto')}</label>`, 'tiny')}
    </div>`,
    saves: panel('Saving throws', `${remindBox(c, 'saves')}<div class="sklist">${saves}</div>`),
    skills: panel('Skills', `${remindBox(c, 'checks')}<div class="sklist">${skills}</div><div class="skfoot">${chk(c, 'jack', 'Jack of All Trades (half proficiency)')}<span class="legend"><i class="rank r1"></i> proficient <i class="rank r2"></i> expertise</span></div>`),
    passive: panel('Passive Wisdom (Perception)', `<div class="big">${calc('passive')}</div>`, 'tiny'),
    profs: panel('Proficiencies', `
      <div class="pgroup"><span class="lbl">Armor</span>${chkL(c, 'profs.light', 'Light')}${chkL(c, 'profs.medium', 'Medium')}${chkL(c, 'profs.heavy', 'Heavy')}${chkL(c, 'profs.shields', 'Shields')}</div>
      <div class="pgroup"><span class="lbl">Weapons</span>${chkL(c, 'profs.simple', 'Simple')}${chkL(c, 'profs.martial', 'Martial')}</div>
      <div class="hf"><span class="lbl">Other weapons</span>${txtL(c, 'profs.weaponsOther')}</div>
      <div class="hf"><span class="lbl">Tools</span>${areaL(c, 'profs.tools', '', 2)}</div>`),
    langs: panel('Languages', areaL(c, 'languages', 'Common, …', 2)),
  };
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
  <section class="panel combatcore">${remindBox(c, 'turn') ? `<div class="turnrem"><span class="lbl">Start of your turn</span>${remindBox(c, 'turn')}</div>` : ''}
    <div class="trio">
      <button class="stat ac" type="button" data-act="ac"><span class="lbl">Armor class</span><b>${calc('ac')}</b>${calc('actemp')}</button>
      ${L.tableSettings().initiative === 'active' ? interruptPoint(c) : `<label class="stat"><span class="lbl">Initiative</span><b>${calc('init')}</b></label>`}
      ${isPlayer() ? `<div class="stat"><span class="lbl">Speed</span><b class="spd">${esc(c.speed || '—')}</b></div>` : `<label class="stat"><span class="lbl">Speed</span><input class="f center" data-k="speed" value="${esc(c.speed)}" autocomplete="off"></label>`}
    </div>
    ${CR.formBannerHtml(c)}
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
    <div class="hf"><span class="lbl">Vision</span>${txtL(c, 'vision', isPlayer() ? 'Normal' : 'Darkvision 60 ft')}</div>
  </section>`;
}
// SRD 5.1 exhaustion levels (each level includes the ones before it)
const EXHAUSTION = ['', 'Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attack rolls and saving throws', 'Hit point maximum halved', 'Speed reduced to 0', 'Death'];

function attacks(c) {
  const rows = (c.attacks || []).map((a, i) => `
    <details class="atk" ${a._new ? 'open' : ''}>
      <summary><span class="an">${esc(a.name) || 'New attack'}</span><b>${calc('atkbonus', i)}</b><span class="atkdmgtxt">${calc('atkdmg', i)}</span></summary>
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
  return panel('Attacks &amp; spellcasting', `${remindBox(c, 'attacks')}
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
    ${(c.magicItems || []).length ? `<div class="miblock"><span class="lbl">Magic items from your DM</span>${c.magicItems.map(m => `<details class="mi"><summary><b>${esc(m.name)}</b>${m.attuned ? '<span class="attb">Attuned</span>' : ''}</summary>
      <p class="sub">${esc([m.type, m.attune].filter(Boolean).join(' · '))}</p>${fmt(m.desc)}</details>`).join('')}</div>` : ''}
    ${infusedBlock(c)}
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
  if (isPlayer() && opts.locked) {
    // players read these; only the DM adds or changes them
    const rows = list.map(f => `
    <details class="feat ${f.rule ? 'rule' : ''}">
      <summary><span>${esc(f.name) || 'Untitled'}</span>${f.src ? `<small class="src">${esc(f.src)}</small>` : ''}</summary>
      ${f.text ? `<div class="ftext">${fmt(T.fillTokens(c, f.text))}</div>` : ''}${featTables(c, f)}
    </details>`).join('');
    return panel(title, (opts.top || '') + (rows || `<p class="empty">${esc(opts.emptyPlayer || 'None yet.')}</p>`), opts.cls || '');
  }
  const rows = list.map((f, i) => `
    <details class="feat ${f.rule ? 'rule' : ''}" ${f._new ? 'open' : ''}>
      <summary><span>${esc(f.name) || 'Untitled'}</span>${f.src ? `<small class="src">${esc(f.src)}</small>` : ''}</summary>
      ${f.text ? `<div class="ftext">${fmt(T.fillTokens(c, f.text))}</div>` : ''}${featTables(c, f)}
      <div class="featedit">
        <input class="f" data-k="${path}.${i}.name" value="${esc(f.name)}" placeholder="Name" autocomplete="off" aria-label="Name">
        ${opts.src ? `<input class="f" data-k="${path}.${i}.src" value="${esc(f.src)}" placeholder="Where it came from (Background, Level 4…)" autocomplete="off" aria-label="Source">` : ''}
        <textarea class="f" data-k="${path}.${i}.text" rows="4" placeholder="Full text" aria-label="Text">${esc(f.text)}</textarea>
        <div class="remedit">
          <label class="hf"><span class="lbl">Remind me during</span><select class="f" data-k="${path}.${i}.remind.on" data-rerender>${REMIND_ON.map(([v, l]) => `<option value="${v}" ${(f.remind?.on || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${f.remind?.on ? `<label class="hf"><span class="lbl">Reminder text <small>({cha}, {prof} and the like fill in your numbers)</small></span><input class="f" data-k="${path}.${i}.remind.text" value="${esc(f.remind.text || '')}" placeholder="${esc(f.name)}: +{cha} to saves within 10 ft" autocomplete="off"></label>` : ''}
        </div>
        <button class="linkbtn danger" type="button" data-act="rowdel" data-list="${path}" data-i="${i}">Remove</button>
      </div>
    </details>`).join('');
  return panel(title, `${opts.top || ''}<div data-list="${path}">${rows || `<p class="empty">${opts.empty || 'Nothing yet.'}</p>`}</div>
    <button class="linkbtn" type="button" data-act="rowadd" data-list="${path}">Add ${opts.one || 'one'}</button>`, opts.cls || '');
}

function defenses(c) {
  const groups = R.DEFENSE_KINDS.map(([k, n]) => {
    const items = (c.defenses || []).map((d, i) => [d, i]).filter(([d]) => d.kind === k);
    return `<div class="dgroup"><span class="lbl">${n}</span>${items.length ? items.map(([d, i]) => isPlayer() && d.auto ? `
      <div class="srow rorow"><span>${esc(d.what)}</span><small>${esc(d.src || '')}</small></div>` : `
      <div class="srow"><input class="f" data-k="defenses.${i}.what" value="${esc(d.what)}" placeholder="${k === 'cond' ? 'Poisoned' : 'Fire'}" aria-label="${n}" autocomplete="off">
      <input class="f" data-k="defenses.${i}.src" value="${esc(d.src)}" placeholder="From (Tiefling, ring…)" aria-label="Source" autocomplete="off">
      <button class="x" type="button" data-act="rowdel" data-list="defenses" data-i="${i}" aria-label="Remove">×</button></div>`).join('') : '<p class="empty">None</p>'}
      <button class="linkbtn" type="button" data-act="defadd" data-kind="${k}">Add</button></div>`;
  }).join('');
  return panel('Defenses', `<div data-list="defenses" class="defs">${groups}</div>`);
}

// What the DM's apps send to this sheet: Session Notes (deaths, Favor of Fate, revealed diseases, survival) and boons
function dmPanel(c) {
  const sn = c.sn, boons = c.boons || [];
  if (!sn && !boons.length) return '<div class="dmempty"></div>';
  const STAGE = n => ['', 'Fine', 'Fine', 'Fine', 'Hindered', 'Exhausting', 'Exhausting', 'Critical'][Math.max(0, Math.min(7, Number(n) || 0))] || '';
  const surv = sn?.survival ? `<div class="survrow">${['hunger', 'thirst', 'fatigue'].map(k => `<span><small>${k[0].toUpperCase() + k.slice(1)}</small><b>${esc(sn.survival[k])}</b></span>`).join('')}</div>` : '';
  const dis = (sn?.diseases || []).map(d => `<details class="dis"><summary><b>${esc(d.name)}</b><small>${d.state === 'declining' ? 'getting better' : `stage ${d.stage}`}${d.dc ? ` · DC ${d.dc} Con` : ''}</small></summary>
    ${d.effects.length ? `<ul>${d.effects.map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '<p class="hint">No symptoms yet.</p>'}
    <p class="hint">Saving throws so far: ${d.pass} passed, ${d.fail} failed.</p></details>`).join('');
  const bn = boons.map(b => `<details class="dis boon"><summary><b>${esc(b.name)}</b>${b.dawnTemp ? `<small>${b.dawnTemp} temp HP at dawn</small>` : ''}</summary>${fmt(b.text)}</details>`).join('');
  return panel('From your DM', `
    ${sn ? `<div class="dmrow"><span class="lbl">Favor of Fate</span><b class="${sn.favorSpent ? 'spent' : 'fresh'}">${sn.favorSpent ? 'Spent' : 'Available'}</b>
      <span class="lbl">Deaths</span><b>${esc(sn.deaths)}</b></div>` : ''}
    ${bn ? `<span class="lbl">Boons</span>${bn}` : ''}
    ${dis ? `<span class="lbl">Diseases</span>${dis}` : ''}
    ${surv ? `<span class="lbl">Survival</span>${surv}` : ''}`, 'dmpanel');
}

// The class table's current values for this character ("Rogue 5: Sneak Attack 3d6"), one line per class
function classTableStrip(c) {
  const vals = T.valuesFor(c).filter(v => v.sheet);
  if (!vals.length) return '';
  const by = new Map();
  for (const v of vals) { const k = `${v.cls} ${v.level}`; if (!by.has(k)) by.set(k, []); by.get(k).push(v); }
  return `<div class="ctstrip">${[...by.entries()].map(([k, vs]) => `<div class="ctline">${by.size > 1 ? `<span class="ctcls">${esc(k)}</span>` : ''}${vs.map(v => `<span class="ctval"><small>${esc(v.name)}</small><b>${esc(v.value || '—')}</b></span>`).join('')}</div>`).join('')}</div>`;
}

// Class options (Invocations, Metamagic, Fighting Styles…): picked from the DM's Library, never typed in
function optionsPanel(c) {
  const groups = O.groupsFor(c);
  if (!groups.length) return '<div class="dmempty"></div>';
  return panel('Class options', groups.map(g => `
    <div class="optgroup">
      <div class="lh"><span class="lbl">${esc(g.group)}</span><span class="count ${g.chosen.length > g.count ? 'over' : ''}">${g.chosen.length} of ${g.count}</span></div>
      ${g.chosen.map(o => `<details class="feat"><summary><span>${esc(o.name)}</span><button class="x" type="button" data-act="optdel" data-id="${esc(o.id)}" aria-label="Remove ${esc(o.name)}">×</button></summary>
        ${o.prereq ? `<p class="hint">Prerequisite: ${esc(o.prereq)}</p>` : ''}<div class="ftext">${fmt(T.fillTokens(c, o.desc))}</div>
        ${o.note ? `<aside class="rulenote"><b>Table Rules</b>${fmt(o.note)}</aside>` : ''}</details>`).join('')}
      ${g.chosen.length < g.count ? `<button class="linkbtn" type="button" data-act="optpick" data-group="${esc(g.group)}">Choose ${g.count - g.chosen.length === 1 ? 'one' : g.count - g.chosen.length} from the Library</button>` : ''}
    </div>`).join(''), 'optpanel');
}

// Extra tables from the Library (random rolls, by level, plain): inside their feature, or in the Tables section
const lastRoll = {};
const tblHtml = (c, x) => T.extraTableHtml(x.t, esc, { lvl: x.lvl, roll: lastRoll[x.t.id], rollable: true, fill: s => T.fillAll(c, s) });
const featTables = (c, f) => T.tablesForFeature(c, f).map(x => tblHtml(c, x)).join('');
function tablesPanel(c) {
  const list = T.looseTables(c);
  if (!list.length) return '<div class="dmempty"></div>';
  return panel('Tables', list.map(x => `<details class="feat" ${lastRoll[x.t.id] ? 'open' : ''}><summary><span>${esc(x.t.title || 'Table')}</span><small class="src">${esc(x.e.name)}</small></summary>${tblHtml(c, x)}</details>`).join(''), 'tblpanel');
}

// Artificer infusions: what's infused, in what, and who has it
// Infused items this character holds (theirs or another artificer's), shown with their magic items
function infusedBlock(c) {
  const items = INF.heldHere(c);
  if (!items.length) return '';
  return `<div class="miblock"><span class="lbl">Infused items</span>${items.map(m => `<details class="mi"><summary><b>${esc(m.name)}</b>${m.attuned ? '<span class="attb">Attuned</span>' : ''}${m.by ? `<small class="src">from ${esc(m.by)}</small>` : ''}</summary>
    <p class="sub">${esc([m.type, m.attune, m.by ? `infused by ${m.by}` : ''].filter(Boolean).join(' · '))}</p>${fmt(m.desc)}${m.extra ? fmt(m.extra) : ''}
    ${m.attune ? `<button class="btn small" type="button" data-act="infatt" data-key="${esc(m.key)}">${m.attuned ? 'End attunement' : 'Attune'}</button>` : ''}</details>`).join('')}</div>`;
}
function infusionsPanel(c) {
  const known = INF.known(c), list = c.infused || [];
  if (!known.length && !list.length) return '<div class="dmempty"></div>';
  const max = INF.limit(c);
  return panel('Infusions', `
    <div class="lh"><span class="lbl">Infused items</span><span class="count ${max != null && list.length > max ? 'over' : ''}">${list.length}${max != null ? ` of ${max}` : ''}</span></div>
    ${list.map(i => { const v = INF.view(i); return `<details class="feat"><summary><span>${esc(v.name)}</span><small class="src">${esc(INF.holderName(c, i.holder))}</small>
        <button class="x" type="button" data-act="infend" data-id="${esc(i.id)}" aria-label="End the infusion on ${esc(v.name)}">×</button></summary>
      <p class="hint">${esc(i.name)}${v.attune ? ` · ${esc(v.attune)}` : ''}</p><div class="ftext">${fmt(v.desc)}</div>${v.extra ? `<div class="ftext">${fmt(v.extra)}</div>` : ''}</details>`; }).join('') || '<p class="empty">Nothing infused right now.</p>'}
    ${known.length ? '<button class="linkbtn" type="button" data-act="infnew">Infuse an item</button>' : ''}
    <p class="hint">${known.length} infusion${known.length === 1 ? '' : 's'} known. Change them on a long rest.</p>`, 'infpanel');
}

// Sections of the main sheet a player can move around (Arrange). Ability scores and the header stay put.
export const SECTION_NAMES = {
  pair: 'Inspiration and proficiency', saves: 'Saving throws', skills: 'Skills', passive: 'Passive Perception', profs: 'Proficiencies', langs: 'Languages',
  combat: 'Combat', dm: 'From your DM', attacks: 'Attacks and spellcasting', equipment: 'Equipment',
  limited: 'Limited features', bgfeat: 'Background feature', racial: 'Racial traits', classfeat: 'Class features', options: 'Class options', infusions: 'Infusions', tables: 'Tables', feats: 'Feats', defenses: 'Defenses',
};
export const DEFAULT_LAYOUT = { A: ['pair', 'saves', 'skills', 'passive', 'profs', 'langs'], B: ['combat', 'dm', 'attacks', 'equipment'], C: ['limited', 'bgfeat', 'racial', 'classfeat', 'options', 'infusions', 'tables', 'feats', 'defenses'] };
export const isSmall = () => matchMedia('(max-width: 700px)').matches;
// The character's saved arrangement for this screen size, with any new or missing sections filled back in
export function layoutFor(c) {
  const all = Object.keys(SECTION_NAMES);
  if (isSmall()) {
    const list = (c.layout?.small || []).filter(k => all.includes(k));
    const def = [...DEFAULT_LAYOUT.A, ...DEFAULT_LAYOUT.B, ...DEFAULT_LAYOUT.C];
    for (const k of def) if (!list.includes(k)) list.splice(def.indexOf(k), 0, k);
    return { small: [...new Set(list)] };
  }
  const big = c.layout?.big || {};
  const out = { A: [], B: [], C: [] }, seen = new Set();
  for (const col of ['A', 'B', 'C']) for (const k of big[col] || []) if (all.includes(k) && !seen.has(k)) { out[col].push(k); seen.add(k); }
  for (const col of ['A', 'B', 'C']) for (const k of DEFAULT_LAYOUT[col]) if (!seen.has(k)) { out[col].push(k); seen.add(k); }
  return out;
}

function sectionHtml(c) {
  const ss = savesSkills(c);
  return {
    ...ss, combat: combat(c), dm: dmPanel(c), attacks: attacks(c), equipment: equipment(c), limited: limited(c),
    bgfeat: isPlayer()
      ? panel('Background feature', c.bgFeature?.name || c.bgFeature?.text ? `<details class="feat"><summary><span>${esc(c.bgFeature.name || 'Feature')}</span></summary><div class="ftext">${fmt(c.bgFeature.text)}</div></details>` : '<p class="empty">None yet.</p>')
      : panel('Background feature', `${txt(c, 'bgFeature.name', 'Feature name')}${area(c, 'bgFeature.text', 'Full text', 3)}`),
    racial: featureList(c, 'racial', 'Racial traits', { one: 'a trait', empty: 'Darkvision, ancestry traits…', locked: true }),
    classfeat: featureList(c, 'classFeat', 'Class features', { one: 'a feature', locked: true, top: classTableStrip(c) }),
    options: optionsPanel(c),
    infusions: infusionsPanel(c),
    tables: tablesPanel(c),
    feats: featureList(c, 'feats', 'Feats', { one: 'a feat', src: true, empty: 'Your background feat goes here.', locked: true }),
    defenses: defenses(c),
  };
}
const arrangeBar = (k, col) => `<div class="arrbar"><button type="button" class="handle" data-drag="${k}" aria-label="Drag ${esc(SECTION_NAMES[k])}">⠿</button><span>${esc(SECTION_NAMES[k])}</span>
  <button type="button" data-arr="up" data-sec="${k}" aria-label="Move up">↑</button><button type="button" data-arr="down" data-sec="${k}" aria-label="Move down">↓</button>
  ${col ? `<button type="button" data-arr="left" data-sec="${k}" aria-label="Move to the column on the left" ${col === 'A' ? 'disabled' : ''}>←</button><button type="button" data-arr="right" data-sec="${k}" aria-label="Move to the column on the right" ${col === 'C' ? 'disabled' : ''}>→</button>` : ''}</div>`;
const wrap = (k, html, col) => `<div class="sec" data-sec="${k}">${ctx.arranging ? arrangeBar(k, col) : ''}${html}</div>`;

function pageSheet(c) {
  const H = sectionHtml(c), lay = layoutFor(c);
  const bar = ctx.arranging ? `<div class="arrangehint"><b>Arrange</b> Drag ⠿ or use the arrows to move sections. ${isSmall() ? 'This order is for phones.' : 'This layout is for tablets and computers; phones keep their own order.'}
    <button class="btn small" type="button" data-arr="reset">Reset layout</button><button class="btn small primary" type="button" data-arr="done">Done</button></div>` : '';
  if (lay.small) return `${header(c)}${bar}<div class="cols arrangeable" data-arrange="small"><div class="col colA">${abilities(c)}</div><div class="col" data-col="S">${lay.small.map(k => wrap(k, H[k])).join('')}</div></div>`;
  return `${header(c)}${bar}
  <div class="cols arrangeable">
    <div class="col colA">${abilities(c)}<div class="stack" data-col="A">${lay.A.map(k => wrap(k, H[k], 'A')).join('')}</div></div>
    <div class="col colB" data-col="B">${lay.B.map(k => wrap(k, H[k], 'B')).join('')}</div>
    <div class="col colC" data-col="C">${lay.C.map(k => wrap(k, H[k], 'C')).join('')}</div>
  </div>`;
}

// Save the order the sections are in on screen right now
function readLayout(root, c) {
  c.layout = c.layout || {};
  if (isSmall()) c.layout.small = [...root.querySelectorAll('[data-col="S"] > .sec')].map(e => e.dataset.sec);
  else {
    const big = {};
    for (const col of ['A', 'B', 'C']) big[col] = [...root.querySelectorAll(`[data-col="${col}"] > .sec`)].map(e => e.dataset.sec);
    c.layout.big = big;
  }
  stamp(c, 'layout');
  ctx.save(c);
}
function arrangeClick(b, c, root) {
  const how = b.dataset.arr;
  if (how === 'done') { ctx.arranging = false; return ctx.rerender(); }
  if (how === 'reset') {
    if (!confirm(`Put every section back where it started${isSmall() ? ' on phones' : ''}?`)) return;
    c.layout = c.layout || {};
    if (isSmall()) delete c.layout.small; else delete c.layout.big;
    stamp(c, 'layout'); ctx.save(c); return ctx.rerender();
  }
  const el = root.querySelector(`.sec[data-sec="${b.dataset.sec}"]`); if (!el) return;
  const colEl = el.parentElement;
  if (how === 'up' && el.previousElementSibling) colEl.insertBefore(el, el.previousElementSibling);
  else if (how === 'down' && el.nextElementSibling) colEl.insertBefore(el.nextElementSibling, el);
  else if (how === 'left' || how === 'right') {
    const order = ['A', 'B', 'C'], i = order.indexOf(colEl.dataset.col) + (how === 'left' ? -1 : 1);
    const dest = root.querySelector(`[data-col="${order[i]}"]`); if (!dest) return;
    dest.append(el);
  } else return;
  readLayout(root, c);
  ctx.rerender();
  root.querySelector(`.sec[data-sec="${b.dataset.sec}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// Dragging by the handle: works with a finger, a pen or a mouse
function startDrag(e, c, root) {
  const handle = e.target.closest('[data-drag]'); if (!handle) return;
  e.preventDefault();
  const el = handle.closest('.sec'); const r = el.getBoundingClientRect();
  const ghost = el.cloneNode(true); ghost.classList.add('dragghost');
  Object.assign(ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
  document.body.append(ghost);
  el.classList.add('dragging');
  const dy = e.clientY - r.top, dx = e.clientX - r.left;
  const scroller = root.closest('.sheet') || document.scrollingElement;
  let raf = 0, lastY = e.clientY;
  const move = ev => {
    ghost.style.top = `${ev.clientY - dy}px`; ghost.style.left = `${ev.clientX - dx}px`;
    lastY = ev.clientY;
    ghost.style.display = 'none';
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    ghost.style.display = '';
    const col = under?.closest('[data-col]'); if (!col || !root.contains(col)) return;
    const sibs = [...col.querySelectorAll(':scope > .sec')].filter(x => x !== el);
    const after = sibs.find(x => { const b = x.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    if (after) col.insertBefore(el, after); else col.append(el);
  };
  // scroll the sheet when dragging near the top or bottom edge
  const tick = () => {
    const h = innerHeight;
    if (lastY < 90) scroller.scrollTop -= 14; else if (lastY > h - 70) scroller.scrollTop += 14;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const up = () => {
    cancelAnimationFrame(raf);
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
    ghost.remove(); el.classList.remove('dragging');
    readLayout(root, c); ctx.rerender();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}

/* ---------- page: spells ---------- */
function pageSpells(c) {
  const mode = L.tableSettings().spellMode;
  const info = M.casterInfo(c), m = M.ensureMagic(c);
  const filter = ctx.spellFilter || 'mine';
  const casters = (c.classes || []).map(k => ({ k, cls: L.get(k.clsId), sub: L.get(k.subId) }))
    .map(x => ({ ...x, abil: x.sub?.spellAbil || x.cls?.spellAbil })).filter(x => x.abil);
  const ABN = Object.fromEntries(R.ABILS);
  const statLine = casters.map(x => `<div class="castline"><b>${esc(x.cls.name)}</b><span>${ABN[x.abil]}</span><span>Save DC <b>${R.saveDc(c, x.abil)}</b></span><span>Attack <b>${R.sign(R.spellAttack(c, x.abil))}</b></span></div>`).join('')
    || '<p class="empty">Pick a spellcasting class on the Sheet page and its spells show up here.</p>';

  let resource = '';
  if (mode === 'points' && info.points) {
    const { max, left } = M.pointsLeft(c);
    const strain = [5, 6].filter(l => l <= info.maxLevel).map(l => {
      const used = Number(m.strain[l]) || 0;
      return `<span class="strain ${used >= M.FREE_STRAIN ? 'out' : ''}">Level ${l}: ${Math.max(0, M.FREE_STRAIN - used)} of ${M.FREE_STRAIN} casts before the strain save</span>`;
    }).join('');
    resource = `<div class="spts">
      <div class="sptnum"><span class="lbl">Spell points</span><b>${left}</b><small>of ${max}</small></div>
      <div class="sptbar"><i style="width:${max ? (left / max) * 100 : 0}%"></i></div>
      <div class="row"><button class="btn small" type="button" data-act="sp" data-d="-1" aria-label="Spend 1 point">−1</button><button class="btn small" type="button" data-act="sp" data-d="1" aria-label="Get 1 point back">+1</button>
      <label class="mini">Max override <input class="f n" data-k="magic.maxOverride" data-type="num" inputmode="numeric" value="${esc(m.maxOverride ?? '')}" placeholder="${info.points}" data-rerender></label></div>
      ${strain ? `<div class="strains">${strain}<span class="hint">Levels 7 to 9 always need the save. Strain save: DC 10 + spell level; a failure adds exhaustion equal to half the spell level.</span></div>` : ''}
      <p class="hint">Cost by spell level: ${Object.entries(M.COST).filter(([l]) => Number(l) <= info.maxLevel).map(([l, v]) => `${l}: ${v}`).join(' · ')}</p>
    </div>`;
  } else if (mode === 'slots' && info.slots.length) {
    resource = `<div class="slotgrid">${info.slots.map((n, i) => {
      const lvl = i + 1, used = Number(m.slots[lvl]) || 0;
      return `<div class="slotrow"><span class="lbl">Level ${lvl}</span><div class="uses">${Array.from({ length: n }, (_, k) => `<button type="button" class="use ${k < n - used ? 'on' : ''}" data-act="slot" data-l="${lvl}" data-on="${k < n - used ? 1 : 0}" aria-label="Level ${lvl} slot ${k + 1}: ${k < n - used ? 'available, tap to use' : 'used, tap to get back'}"></button>`).join('')}</div></div>`;
    }).join('')}</div>`;
  }
  if (info.pact.slots) {
    resource += `<div class="slotrow pact"><span class="lbl">Pact Magic (level ${info.pact.level} slots, back on a short rest)</span><div class="uses">${Array.from({ length: info.pact.slots }, (_, k) => `<button type="button" class="use ${k < info.pact.slots - m.pact ? 'on' : ''}" data-act="pactslot" data-on="${k < info.pact.slots - m.pact ? 1 : 0}" aria-label="Pact slot ${k + 1}"></button>`).join('')}</div></div>`;
  }

  const mine = new Set(c.mySpells || []);
  const other = (c.otherSpells || []).map(id => L.get(id)).filter(Boolean);
  const avail = [...M.availableSpells(c), ...other.filter(s => !M.availableSpells(c).some(x => x.id === s.id))];
  const maxLvl = M.maxCastLevel(c);
  const shown = avail.filter(s => filter === 'all' || mine.has(s.id) || M.alwaysPrepared(c, s));
  const groups = [];
  for (let l = 0; l <= 9; l++) {
    const list = shown.filter(s => Number(s.level) === l).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    const head = l === 0 ? 'Cantrips' : `Level ${l}${mode === 'points' ? ` · ${M.COST[l]} points` : ''}`;
    groups.push(`<section class="splvl ${l > maxLvl && l > 0 ? 'beyond' : ''}"><h4>${head}${l > maxLvl && l > 0 ? ' <small>not yet</small>' : ''}</h4>${list.map(s => {
      const always = M.alwaysPrepared(c, s), isMine = mine.has(s.id) || always;
      const isOther = other.some(o => o.id === s.id);
      return `<div class="sprow ${isMine ? 'mine' : ''}">
        ${always ? '<span class="always" title="Always prepared (subclass)">Always</span>' : `<button type="button" class="star ${isMine ? 'on' : ''}" data-act="mine" data-id="${s.id}" aria-pressed="${isMine}" aria-label="${isMine ? 'Remove from' : 'Add to'} my spells: ${esc(s.name)}">★</button>`}
        <button type="button" class="spname" data-act="libview" data-id="${s.id}">${esc(s.name)}${s.conc ? ' <i class="tag">C</i>' : ''}${s.ritual ? ' <i class="tag">R</i>' : ''}${isOther ? ' <i class="tag">other list</i>' : ''}</button>
        <span class="spmeta">${esc(s.time || '')} · ${esc(s.range || '')}</span>
        ${l > 0 ? `<button class="btn small" type="button" data-act="cast" data-id="${s.id}">Cast</button>` : '<span></span>'}
        ${isOther && !isPlayer() ? `<button class="x" type="button" data-act="otherdel" data-id="${s.id}" aria-label="Remove">×</button>` : ''}
      </div>`;
    }).join('')}</section>`);
  }
  return `
  <div class="cols spcols">
    <div class="col">
      ${panel('Spellcasting', `${statLine}${resource}<p class="hint">Table Rules: ${mode === 'points' ? 'spell points' : 'spell slots'}. Your DM sets this for the whole table.</p>`)}
      ${isPlayer() ? '' : panel('Spells from other lists', `<p class="hint">Racial spells, feats, Magical Secrets and the like.</p>
        <div class="row"><input class="f" id="otherSpell" list="dl-allspells" placeholder="Spell name" autocomplete="off" style="flex:1"><button class="btn small" type="button" data-act="otherspell">Add</button></div>
        <datalist id="dl-allspells">${L.all('spell').map(s => `<option value="${esc(s.name)}">${s.level ? `Level ${s.level}` : 'Cantrip'}</option>`).join('')}</datalist>`)}
    </div>
    <div class="col">
      ${panel('Spells', `
        <div class="seg spf" role="group" aria-label="Which spells"><button type="button" data-act="spfilter" data-v="mine" aria-pressed="${filter === 'mine'}">My spells</button><button type="button" data-act="spfilter" data-v="all" aria-pressed="${filter === 'all'}">Everything I can learn</button></div>
        <p class="hint">${filter === 'mine' ? 'Tap ★ under "Everything I can learn" to add spells you know or have prepared.' : 'Tap ★ to mark spells you know or have prepared. Tap a name to read it.'}</p>
        ${groups.join('') || `<p class="empty">${filter === 'mine' ? 'No spells marked yet.' : 'No spells for your classes in the library yet.'}</p>`}`)}
    </div>
  </div>`;
}

/* ---------- page: notes ---------- */
// A big typing area plus handwritten pages (S Pen, finger or mouse)
function pageNotes(c) {
  const pages = c.inkPages || [];
  return `<div class="notespage">
    ${panel('Notes', `<textarea class="f" data-k="journal" placeholder="Anything you want to remember: names, clues, plans, loot to sell…">${esc(c.journal || '')}</textarea>`)}
    ${panel('Handwritten pages', `<div class="ink-grid">
      ${pages.map((p, i) => `<button type="button" class="ink-thumb" data-act="inkopen" data-id="${esc(p.id)}" aria-label="Open page ${i + 1}"><canvas data-ink="${esc(p.id)}"></canvas><span>Page ${i + 1}</span>${p.updated ? `<small>${esc(new Date(p.updated).toLocaleDateString())}</small>` : ''}</button>`).join('')}
      <button type="button" class="ink-thumb add" data-act="inknew"><span class="plus">+</span><span>New page</span></button>
    </div>`)}
  </div>`;
}
function openInk(c, id) {
  const view = document.querySelector('#inkView');
  const page = (c.inkPages || []).find(p => p.id === id); if (!page || !view) return;
  view.hidden = false; document.body.classList.add('ink-open');
  openInkEditor(view, page, {
    onChange: (strokes, prefs) => {
      const pg = (c.inkPages || []).find(p => p.id === id); if (!pg) return;
      pg.strokes = strokes; pg.lastColor = prefs.color; pg.lastSize = prefs.size; pg.updated = Date.now();
      stamp(c, 'inkPages'); ctx.save(c);
    },
    onClose: () => { view.hidden = true; view.innerHTML = ''; document.body.classList.remove('ink-open'); ctx.rerender(); },
    onDelete: () => {
      if (!confirm('Delete this page? This can\'t be undone.')) return;
      c.inkPages = (c.inkPages || []).filter(p => p.id !== id); stamp(c, 'inkPages'); ctx.save(c);
      view.hidden = true; view.innerHTML = ''; document.body.classList.remove('ink-open'); ctx.rerender();
    },
  });
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
    ${INF.heldHere(c).length ? infusedBlock(c) : ''}
    ${(c.magicItems || []).some(m => m.weight) ? `<p class="hint">Includes ${(c.magicItems || []).reduce((t, m) => t + (Number(m.weight) || 0), 0)} lb of magic items from your DM.</p>` : ''}
  </section>
  ${panel('Coins', `<div class="coins">${coins}</div>
    <div class="coinfoot"><span class="sub">100 coins weigh 1 lb · ${calc('coinwt')}</span>
    <button class="btn small" type="button" data-act="consolidate">Consolidate into gold, silver, copper</button></div>
    <p class="hint">10 copper = 1 silver · 5 silver = 1 electrum · 2 electrum = 1 gold · 10 gold = 1 platinum. Consolidating leaves platinum alone.</p>`)}
  ${(c.magicItems || []).length ? panel('Magic items from your DM', `<div class="tablewrap"><table class="inv"><thead><tr><th>Item</th><th>Weight</th><th>Attunement</th></tr></thead><tbody>
    ${c.magicItems.map(m => `<tr><td><details class="mi"><summary><b>${esc(m.name)}</b></summary><p class="sub">${esc(m.type || '')}</p>${fmt(m.desc)}</details></td><td class="num">${m.weight ? `${m.weight} lb` : '—'}</td><td>${m.attuned ? '<span class="attb">Attuned</span>' : esc(m.attune || 'None')}</td></tr>`).join('')}
    </tbody></table></div><p class="hint">Your DM manages these in the magic item app.</p>`, 'invcat') : ''}
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
    ${[['Dark', true], ['Light', false]].map(([label, dark]) => `<span class="lbl">${label}</span><div class="swatches">${Object.entries(PRESETS).filter(([, p]) => p.dark === dark).map(([k, p]) => `
      <button type="button" class="preset ${t.preset === k ? 'on' : ''}" data-act="preset" data-v="${k}" style="--sw-a:${p.page};--sw-b:${p.panel};--sw-c:${p.accent};--sw-t:${p.text}">
        <span class="chip"><i></i><i></i><i></i></span>${p.name}</button>`).join('')}</div>`).join('')}

    <h3>Accent color</h3>
    <div class="accents">${CLASS_ACCENTS.map(([n, h]) => `<button type="button" class="acc ${t.accent === h ? 'on' : ''}" data-act="accent" data-v="${h}" style="--sw:${h}" title="${n}" aria-label="${n} accent"></button>`).join('')}
      <label class="acc custom" title="Any color"><input type="color" data-theme-k="accent" value="${t.accent || (PRESETS[t.preset] || PRESETS.night).accent}" aria-label="Pick any accent color"></label>
      <button type="button" class="linkbtn" data-act="accent" data-v="">Palette default</button></div>

    <h3>Heading font</h3>
    <div class="fonts">${Object.entries(HEAD_FONTS).map(([k, [n, fam]]) => `<button type="button" class="fontbtn ${t.head === k ? 'on' : ''}" data-act="font" data-w="head" data-v="${k}" style="font-family:${esc(fam)}" title="${esc(n)}">${esc(c.name || n)}</button>`).join('')}</div>
    <h3>Text font</h3>
    <div class="fonts">${['Sans', 'Serif'].map(g => `<span class="lbl grp">${g === 'Sans' ? 'Sans serif' : 'Serif'}</span>${Object.entries(BODY_FONTS).filter(([, f]) => (g === 'Sans' ? f[2].startsWith('Sans') : !f[2].startsWith('Sans'))).map(([k, [n, fam, kind]]) => `<button type="button" class="fontbtn body ${t.body === k ? 'on' : ''}" data-act="font" data-w="body" data-v="${k}" style="font-family:${esc(fam)}">${esc(n)}<small>${esc(kind.includes('easy') ? 'Made for easy reading' : kind === 'Slab serif' ? 'Slab serif' : '')}</small></button>`).join('')}`).join('')}</div>

    <h3>Frame</h3>
    <div class="frames">${Object.entries(FRAMES).map(([k, n]) => `<button type="button" class="framebtn ${t.frame === k ? 'on' : ''}" data-act="frame" data-v="${k}" aria-label="${esc(n)} frame">
      <span class="panel fdemo" data-fd="${k}"><span class="ph">${esc(n)}</span><i></i><i></i></span></button>`).join('')}</div>

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
let painting = false;
export function renderPage(root, c, page) {
  // redrawing removes the box being typed in, which fires its change event: don't start a second redraw inside the first
  if (painting) return;
  painting = true;
  try { paintPage(root, c, page); } finally { painting = false; }
}
function paintPage(root, c, page) {
  root.innerHTML = page === 'character' ? pageCharacter(c) : page === 'inventory' ? pageInventory(c) : page === 'spells' ? pageSpells(c) : page === 'notes' ? pageNotes(c)
    : page === 'creatures' ? CR.pageCreatures(c, { isPlayer, panel }) : pageSheet(c);
  if (page === 'notes') for (const cv of root.querySelectorAll('canvas[data-ink]')) renderThumb(cv, (c.inkPages || []).find(p => p.id === cv.dataset.ink)?.strokes);
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
      case 'attuned': { const n = (c.attuned || []).filter(x => x.name).length + (c.magicItems || []).filter(x => x.attuned).length + INF.heldHere(c).filter(x => x.attuned).length, max = Number(c.attuneMax) || 3; out = `${n} of ${max}`; el.classList.toggle('over', n > max); break; }
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
    if (el.matches('[data-wsq]')) {
      const c = getChar(); CR.setQuery(el.value);
      const q = el.value.trim().toLowerCase(), favs = new Set(c.wildFav || []);
      const shown = CR.wildChoices(c).filter(m => !q || m.name.toLowerCase().includes(q)).sort((a, b) => (favs.has(b.id) - favs.has(a.id)) || CR.crNum(b.cr) - CR.crNum(a.cr) || a.name.localeCompare(b.name));
      const box = root.querySelector('#wsList'); if (box) box.innerHTML = CR.wildRows(c, shown, favs);
      return;
    }
    if (!el.dataset.k || el.type === 'checkbox' || el.tagName === 'SELECT') return;
    if (el.dataset.k === 'hp.cur' || el.dataset.k === 'hp.temp') return; // saved on change, as an adjustment
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
    // choosing a suggestion from the list fills the sheet right away
    if (el.hasAttribute('data-pick') && el.type !== 'checkbox' && (!e.inputType || e.inputType === 'insertReplacementText')) ctx.picked();
  });
  root.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('[data-theme-k]')) return themeInput(el, getChar(), true);
    if (el.matches('[data-img]')) return pickImage(el, getChar(), el.dataset.img, 800);
    if (el.matches('[data-bgimg]')) return pickImage(el, getChar(), 'theme.bg.img', 1920);
    if (!el.dataset.k) return;
    const c = getChar();
    if (el.dataset.k === 'hp.cur' || el.dataset.k === 'hp.temp') {
      const n = el.value.trim() === '' ? 0 : Number(el.value);
      if (!Number.isFinite(n)) return;
      hpOp(c, el.dataset.k === 'hp.cur' ? { k: 'set', cur: n } : { k: 'set', temp: n });
      updateCalcs(root, c); ctx.save(c); return;
    }
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.type === 'num' && el.type !== 'checkbox') v = Number(v);
    if (el.type === 'checkbox' || el.tagName === 'SELECT') {
      setPath(c, el.dataset.k, v);
      stamp(c, stampPathFor(el, el.dataset.k));
    }
    updateCalcs(root, c);
    ctx.save(c);
    if (el.hasAttribute('data-pick')) return ctx.picked();
    if (el.hasAttribute('data-rerender')) ctx.rerender();
  });
  root.addEventListener('click', e => {
    const ar = e.target.closest('[data-arr]');
    if (ar) return arrangeClick(ar, getChar(), root);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.closest('summary')) e.preventDefault(); // a button in a row's title shouldn't also open or close the row
    act(b, getChar(), root);
  });
  root.addEventListener('pointerdown', e => { if (ctx.arranging && e.target.closest('[data-drag]')) startDrag(e, getChar(), root); });
}

const LOCKED_LISTS = ['classes', 'racial', 'classFeat', 'feats', 'creatures'];
function act(b, c, root) {
  const d = b.dataset;
  if (isPlayer()) {
    if ((d.act === 'rowadd' || d.act === 'rowdel') && LOCKED_LISTS.includes(d.list)) return;
    if (d.act === 'rowdel' && d.list === 'defenses' && c.defenses?.[d.i]?.auto) return;
    if (d.act === 'rank' && lockedSkill(c, d.s)) return;
    if (d.act === 'otherspell' || d.act === 'otherdel') return;
  }
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
      const hp = c.hp;
      if (d.how === 'dmg') {
        const fromTemp = Math.min(Number(hp.temp) || 0, amt);
        const form = hp.form ? { ...hp.form } : null;
        hpOp(c, { k: 'dmg', n: amt });
        if (amt - fromTemp > 0 && c.ip === 'spent') { c.ip = 'recharging'; stamp(c, 'ip'); }
        const t = fromTemp ? ` (${fromTemp} from temp HP)` : '';
        if (form && !c.hp.form) ctx.toast(`Took ${amt}${t}. ${form.name} dropped to 0 and you're back to yourself${c.hp.formEnded?.over ? `, taking the ${c.hp.formEnded.over} left over` : ''}.`);
        else if (form) ctx.toast(`Took ${amt}${t}. ${form.name}: ${c.hp.form.cur} of ${c.hp.form.max} HP left.`);
        else ctx.toast(fromTemp ? `Took ${amt}: ${fromTemp} from temp HP, ${amt - fromTemp} from HP.` : `Took ${amt} damage.`);
      } else if (d.how === 'heal') {
        hpOp(c, { k: 'heal', n: amt });
        ctx.toast(`Healed ${amt}.`);
      } else {
        // temp HP doesn't stack: keep the higher
        const before = Number(hp.temp) || 0;
        hpOp(c, { k: 'temp', n: amt });
        ctx.toast(amt > before ? `Temp HP is now ${amt}.` : `Kept your current ${before} temp HP (temp HP doesn't stack).`);
      }
      ctx.save(c); return ctx.rerender();
    }
    /* ---------- creatures ---------- */
    case 'wsform': case 'cform': {
      if (c.hp?.form) { ctx.toast(`Revert from ${c.hp.form.name} first.`); return; }
      let name, n, ac, cid;
      if (d.act === 'wsform') {
        const m = (c.wildBeasts || []).find(x => x.id === d.id); if (!m) return;
        name = m.name; n = Math.max(1, Number(m.hp) || 1); ac = CR.acNum(m.ac); cid = m.id;
        const ui = CR.wildUses(c);
        if (ui >= 0) {
          const f = c.limited[ui], left = Number(f.left) || 0;
          if (left <= 0 && !confirm(`No ${f.name} uses left. Transform anyway?`)) return;
          if (left > 0) { f.left = left - 1; stamp(c, 'limited'); }
        }
      } else {
        const x = (c.creatures || []).find(y => y.id === d.id); if (!x) return;
        name = x.ov?.name || x.name; n = CR.maxHpOf(c, x); ac = CR.acNum(CR.acOf(c, x)); cid = x.id;
      }
      hpOp(c, { k: 'form', n, name, ac, cid });
      ctx.toast(`You're a ${name}: ${n} HP. Damage comes off its HP first.`);
      ctx.save(c); return ctx.rerender();
    }
    case 'crevert': {
      const f = c.hp?.form; if (!f) return;
      hpOp(c, { k: 'revert' });
      ctx.toast(`Back to yourself (${c.hp.cur} HP).`);
      ctx.save(c); return ctx.rerender();
    }
    case 'wsfav': {
      const set = new Set(c.wildFav || []);
      set.has(d.id) ? set.delete(d.id) : set.add(d.id);
      c.wildFav = [...set]; return touch('wildFav');
    }
    case 'csum': case 'chp': {
      const x = (c.creatures || []).find(y => y.id === d.id); if (!x) return;
      const s = CR.compState(c, x);
      c.compHp = c.compHp || {};
      const rec = { cur: s.cur, temp: s.temp, out: s.out };
      if (d.act === 'csum') { rec.out = !s.out; if (rec.out && s.cur <= 0) rec.cur = s.max; }
      else if (d.how === 'full') { rec.cur = s.max; rec.temp = 0; }
      else {
        const amt = Math.abs(parseInt(root.querySelector(`[data-camt="${CSS.escape(d.id)}"]`)?.value, 10));
        if (!amt) { ctx.toast('Type an amount first.'); root.querySelector(`[data-camt="${CSS.escape(d.id)}"]`)?.focus(); return; }
        if (d.how === 'dmg') { const ft = Math.min(rec.temp, amt); rec.temp -= ft; rec.cur = Math.max(0, rec.cur - (amt - ft)); if (rec.cur === 0) ctx.toast(`${x.ov?.name || x.name} drops to 0 HP.`); }
        else if (d.how === 'heal') rec.cur = Math.min(s.max, rec.cur + amt);
        else rec.temp = Math.max(rec.temp, amt);
      }
      c.compHp[x.id] = rec;
      return touch(`compHp.${x.id}`);
    }
    case 'cadd': if (isPlayer()) return; return ctx.addCreature?.(d.kind);
    case 'cdel': {
      if (isPlayer()) return;
      const i = (c.creatures || []).findIndex(y => y.id === d.id); if (i < 0) return;
      if (!confirm(`Remove ${c.creatures[i].ov?.name || c.creatures[i].name} from this sheet?`)) return;
      c.creatures.splice(i, 1); if (c.compHp) delete c.compHp[d.id];
      stamp(c, 'compHp');
      return touch('creatures');
    }
    case 'troll': {
      const x = T.tablesFor(c).find(y => y.t.id === d.tid); if (!x) return;
      const n = T.rollDie(x.t.die); if (n == null) return ctx.toast(`Can't roll "${x.t.die}".`);
      const row = T.rowForRoll(x.t, n);
      lastRoll[x.t.id] = { n, row };
      const res = row >= 0 ? (x.t.rows[row].slice(1).filter(Boolean).join(' · ') || x.t.rows[row][0]) : '';
      ctx.toast(row >= 0 ? `${x.t.title || 'Rolled'}: ${n}. ${T.fillAll(c, res)}` : `Rolled ${n}: no row covers that number.`);
      ctx.rerender();
      // bring the result row into view inside the table
      const hi = document.querySelector(`.xtable[data-xt="${CSS.escape(x.t.id)}"] tr.hi`), wrap = hi?.closest('.ctable-wrap');
      if (hi && wrap) wrap.scrollTop = hi.offsetTop - wrap.clientHeight / 2 + hi.offsetHeight / 2;
      return;
    }
    case 'infnew': return ctx.infuse?.();
    case 'infend': {
      const i = (c.infused || []).findIndex(x => x.id === d.id); if (i < 0) return;
      const v = INF.view(c.infused[i]);
      if (!confirm(`End the infusion on ${v.name}?${c.infused[i].holder ? ` ${INF.holderName(c, c.infused[i].holder)} loses it.` : ''}`)) return;
      c.infused.splice(i, 1); ctx.toast(`${v.name} is no longer infused.`);
      return touch('infused');
    }
    case 'infatt': {
      c.infAttuned = c.infAttuned || {};
      if (c.infAttuned[d.key]) delete c.infAttuned[d.key]; else c.infAttuned[d.key] = true;
      return touch('infAttuned');
    }
    case 'consolidate': c.coins = R.consolidateCoins(c.coins); ctx.toast('Coins consolidated.'); return touch('coins');
    case 'imgdel': setPath(c, d.p, ''); return touch(d.p);
    case 'abil': return ctx.openAbility(d.a);
    case 'libview': return ctx.viewEntry(d.id);
    case 'levelup': return ctx.levelUp();
    case 'optpick': return ctx.pickOption(d.group);
    case 'inknew': { const p = { id: uid(), strokes: [], updated: Date.now() }; c.inkPages = [...(c.inkPages || []), p]; stamp(c, 'inkPages'); ctx.save(c); return openInk(c, p.id); }
    case 'inkopen': return openInk(c, d.id);
    case 'optdel': {
      const o = L.get(d.id);
      if (!confirm(`Remove ${o?.name || 'this option'}? You can choose it again later.`)) return;
      c.options = (c.options || []).filter(p => p.id !== d.id); return touch('options');
    }
    case 'xpadd': {
      const n = parseInt(document.querySelector('#xpAdd')?.value, 10);
      if (!n) { ctx.toast('Type how much XP to add.'); return; }
      c.xp = (Number(c.xp) || 0) + n; stamp(c, 'xp'); ctx.save(c); ctx.rerender();
      ctx.toast(readyToLevel(c) ? `+${n} XP. Ready to level up!` : `+${n} XP.`); return;
    }
    case 'shortrest': return ctx.shortRest();
    case 'longrest': return ctx.longRest();
    case 'ip': { const st = c.ip || 'ready'; c.ip = st === 'ready' ? 'spent' : 'ready'; return touch('ip'); }
    case 'cast': return ctx.cast(d.id);
    case 'mine': {
      const set = new Set(c.mySpells || []);
      set.has(d.id) ? set.delete(d.id) : set.add(d.id);
      c.mySpells = [...set]; return touch('mySpells');
    }
    case 'spfilter': ctx.spellFilter = d.v; return ctx.rerender();
    case 'slot': {
      const m = M.ensureMagic(c), lvl = Number(d.l), have = M.casterInfo(c).slots[lvl - 1] || 0;
      m.slots[lvl] = Math.max(0, Math.min(have, (Number(m.slots[lvl]) || 0) + (d.on === '1' ? 1 : -1))); return touch('magic');
    }
    case 'pactslot': { const m = M.ensureMagic(c), have = M.casterInfo(c).pact.slots; m.pact = Math.max(0, Math.min(have, m.pact + (d.on === '1' ? 1 : -1))); return touch('magic'); }
    case 'sp': { const m = M.ensureMagic(c); const { max } = M.pointsLeft(c); m.spent = Math.max(0, Math.min(max, m.spent - Number(d.d))); return touch('magic'); }
    case 'otherspell': {
      const inp = document.querySelector('#otherSpell'); const sp = L.findByName('spell', inp?.value);
      if (!sp) { ctx.toast('Pick a spell from the suggestions.'); inp?.focus(); return; }
      c.otherSpells = [...new Set([...(c.otherSpells || []), sp.id])];
      c.mySpells = [...new Set([...(c.mySpells || []), sp.id])];
      stamp(c, 'otherSpells'); ctx.toast(`Added ${sp.name}.`); return touch('mySpells');
    }
    case 'otherdel': c.otherSpells = (c.otherSpells || []).filter(x => x !== d.id); c.mySpells = (c.mySpells || []).filter(x => x !== d.id); stamp(c, 'otherSpells'); return touch('mySpells');
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
