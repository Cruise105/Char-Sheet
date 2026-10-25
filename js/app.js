import { db } from './db.js';
import { newCharacter, upgrade, merge, stamp, uid, hpOp } from './model.js';
import * as R from './rules.js';
import { initSheet, renderPage, bindSheet, updateCalcs, lookPanel, applyTheme, esc, remindersFor } from './sheet.js';
import { PRESETS } from './theme.js';
import * as sync from './sync.js';
import * as L from './library.js';
import { resolvePicks, syncAuto } from './autofill.js';
import { initLibrary, showLibrary, entryHtml } from './libui.js';
import * as M from './magic.js';
import * as B from './bridge.js';
import { isDmEmail } from './dm.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const state = { chars: [], cur: null, page: 'sheet', settings: { role: 'player', red: false }, dmOk: false };
// DM mode needs both: DM chosen in Settings, and this device signed in to the DM's Google account
const isDm = () => state.settings.role === 'dm' && state.dmOk;
async function checkEmail(email) {
  state.dmOk = await isDmEmail(email);
  if (state.settings.role === 'dm' && email && !state.dmOk) {
    state.settings.role = 'player'; saveSettings();
    toast('Dungeon Master mode is only for your DM\'s Google account. This device stays in Player mode.');
    refreshRoleUi();
  }
  return state.dmOk;
}
function refreshRoleUi() {
  const known = !!sync.currentEmail();
  const dmBtn = document.querySelector('[data-role="dm"]');
  if (dmBtn) dmBtn.hidden = known && !state.dmOk;
  const hint = document.querySelector('#roleHint');
  if (hint) hint.textContent = known && !state.dmOk
    ? 'This device is signed in as a player. Dungeon Master mode is only available on your DM\'s Google account.'
    : 'The DM keeps every sheet in a folder in their Google Drive and shares each one with its player. Players see only their own sheet.';
  for (const b of document.querySelectorAll('[data-role]')) b.setAttribute('aria-pressed', String(b.dataset.role === (isDm() ? 'dm' : state.settings.role === 'dm' && !known ? 'dm' : 'player')));
}

/* ---------- toasts + choices ---------- */
function toast(msg) {
  document.querySelectorAll('.toast').forEach(x => x.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 4200);
}
function choose(question, options) {
  const dlg = $('#chooseDlg');
  dlg.querySelector('.q').textContent = question;
  dlg.querySelector('.opts').innerHTML = options.map(([v, l]) => `<button class="btn" type="button" value="${esc(v)}">${esc(l)}</button>`).join('') + '<button class="btn ghost" type="button" value="">Cancel</button>';
  return new Promise(resolve => {
    const onClick = e => { const b = e.target.closest('button[value]'); if (!b) return; dlg.removeEventListener('click', onClick); dlg.close(); resolve(b.value || null); };
    dlg.addEventListener('click', onClick);
    dlg.showModal();
  });
}

/* ---------- saving ---------- */
let saveTimer = null;
function save(c) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => db.put(c), 250);
}
async function flush() { if (saveTimer && state.cur) { clearTimeout(saveTimer); saveTimer = null; await db.put(state.cur); } }

/* ---------- settings ---------- */
async function loadSettings() {
  const s = await db.getMeta('settings');
  if (s) Object.assign(state.settings, s);
  applyRed();
}
function saveSettings() { db.setMeta('settings', { ...state.settings }); }
function applyRed() {
  document.documentElement.dataset.red = state.settings.red ? '1' : '';
  $('#redBtn').setAttribute('aria-pressed', String(!!state.settings.red));
  $('meta[name="theme-color"]').content = state.settings.red ? '#000000' : (state.cur ? (PRESETS[state.cur.theme.preset] || PRESETS.night).page : '#121821');
}

/* ---------- home: the character list ---------- */
async function showHome() {
  await flush();
  state.cur = null;
  app.dataset.view = 'home';
  applyTheme(document.body, newCharacter().theme);
  document.body.style.removeProperty('--bg-blur');
  $('#title').textContent = 'Characters';
  document.title = 'Character Sheets';
  state.chars = (await db.all()).map(upgrade).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const dm = isDm();
  const list = $('#charList');
  list.innerHTML = state.chars.map(c => {
    const cls = (c.classes || []).filter(k => k.name).map(k => `${k.name}${k.sub ? ` (${k.sub})` : ''} ${k.level}`).join(' / ');
    const linked = sync.linkOf(c.id);
    return `<li><article class="card" data-id="${c.id}">
      <button class="cardopen" type="button" data-open="${c.id}">
        <span class="cardbg"${c.theme.bg.img ? ` style="background-image:url('${c.theme.bg.img}')"` : ''}></span>
        <span class="cardbody">
          <span class="cn">${esc(c.name) || 'Unnamed character'}</span>
          <span class="cl">${esc([c.race, cls].filter(Boolean).join(' · ')) || 'No race or class yet'}</span>
          <span class="cm">${esc(c.player || '')}${linked ? `<span class="tag">${dm ? 'In your Drive folder' : 'Synced with Drive'}</span>` : ''}</span>
        </span>
      </button>
      <div class="cardacts">
        ${dm ? `<button class="btn small" type="button" data-share="${c.id}">Share with player</button>` : (linked ? '' : `<button class="btn small" type="button" data-link="${c.id}">Link to Drive</button>`)}
        <button class="btn small" type="button" data-export="${c.id}">Save a copy</button>
        <button class="btn small danger" type="button" data-del="${c.id}">Delete</button>
      </div>
    </article></li>`;
  }).join('');
  for (const card of list.querySelectorAll('.card')) applyTheme(card, state.chars.find(c => c.id === card.dataset.id).theme);
  $('#homeEmpty').hidden = state.chars.length > 0;
  $('#newBtn2').hidden = state.chars.length > 0;
  $('#homeEmpty').innerHTML = dm
    ? '<p>No characters yet. Make one here, or connect Google Drive in Settings to pull in the sheets already in your Character Sheets folder.</p>'
    : '<p>No characters yet. Make a new one, or if your DM already shared your sheet, connect Google Drive in Settings and open it.</p>';
  applyRed();
}

async function newChar() {
  const c = newCharacter('');
  c.edits = {};
  await db.put(c);
  await openCharacter(c.id);
  setTimeout(() => $('#page .charname')?.focus(), 50);
}

/* ---------- library view ---------- */
async function openLibraryView(id = null) {
  await flush();
  closeLook();
  state.cur = null;
  app.dataset.view = 'library';
  $('#title').textContent = 'Library';
  document.title = 'Library';
  applyTheme(document.body, newCharacter().theme);
  showLibrary(id);
  applyRed();
}
function viewEntry(id) {
  const dlg = $('#entryDlg');
  const show = x => { dlg.querySelector('.body').innerHTML = entryHtml(L.get(x)); dlg.querySelector('.body').scrollTop = 0; };
  show(id);
  dlg.onclick = e => {
    const b = e.target.closest('[data-libopen]'); if (b) show(b.dataset.libopen);
    if (e.target.closest('[data-close]') || e.target === dlg) dlg.close();
  };
  dlg.showModal();
}
// A race, class, subclass, background or level changed: fill the sheet from the library
function picked() {
  const c = state.cur; if (!c) return;
  const before = JSON.stringify([c.raceId, c.bgId, c.classes.map(k => [k.clsId, k.subId, k.level])]);
  resolvePicks(c);
  const after = JSON.stringify([c.raceId, c.bgId, c.classes.map(k => [k.clsId, k.subId, k.level])]);
  const added = syncAuto(c);
  save(c);
  renderSheet();
  if (before !== after) {
    const bits = [];
    if (added.traits) bits.push(`${added.traits} racial trait${added.traits === 1 ? '' : 's'}`);
    if (added.features) bits.push(`${added.features} class feature${added.features === 1 ? '' : 's'}`);
    bits.push(...added.names);
    if (bits.length) toast(`Added ${bits.join(', ')}.`);
  }
}

/* ---------- level up, rests, casting ---------- */
const ABN = Object.fromEntries(R.ABILS);
function actDialog(draw, onClick, onInput) {
  const dlg = $('#actDlg');
  const paint = () => { dlg.querySelector('.body').innerHTML = draw(); };
  paint();
  dlg.onclick = e => { if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close(); onClick?.(e, paint); };
  dlg.oninput = e => onInput?.(e, paint);
  dlg.onchange = e => onInput?.(e, paint);
  dlg.onclose = () => renderSheet();
  dlg.showModal();
  return dlg;
}

function levelUp() {
  const c = state.cur;
  const st = { idx: c.classes.length === 1 ? 0 : -1, newName: '', roll: '', avg: false, asi: 'asi', asiA: 'str', asiB: 'str', feat: '', sub: '', bonus: c.hpPerLevel ?? '' };
  const conMod = () => R.amod(c, 'con');
  const row = () => st.idx === 'new' ? null : c.classes[st.idx];
  const clsOf = () => st.idx === 'new' ? L.findByName('class', st.newName) : L.get(row()?.clsId);
  const die = () => Number(st.idx === 'new' ? (clsOf()?.hd || 8) : (clsOf()?.hd || row()?.hd || 8));
  const newLvl = () => st.idx === 'new' ? 1 : (Number(row()?.level) || 0) + 1;
  const avg = () => Math.floor(die() / 2) + 1;
  const gain = () => {
    const r = Number(st.roll) || 0;
    if (!st.avg && !r) return null;
    const base = st.avg ? avg() : Math.max(r, avg());
    return Math.max(1, base + conMod() + (Number(st.bonus) || 0));
  };
  const isAsi = () => (clsOf()?.asi || [4, 8, 12, 16, 19]).includes(newLvl());
  const needsSub = () => { const k = clsOf(); return k && !row()?.subId && newLvl() >= (k.subclassLevel || 3) && L.subclassesOf(k.id).length; };
  const draw = () => {
    const total = R.totalLevel(c) + 1;
    const r = Number(st.roll) || 0, g = gain();
    const choose = `<span class="lbl">Which class gains the level?</span><div class="pickrows">${c.classes.map((k, i) => `<label class="chk"><input type="radio" name="lc" value="${i}" ${st.idx === i ? 'checked' : ''}><span>${esc(k.name || 'Class')} ${esc(k.level)} → ${Number(k.level) + 1}</span></label>`).join('')}
      <label class="chk"><input type="radio" name="lc" value="new" ${st.idx === 'new' ? 'checked' : ''}><span>A new class (multiclass)</span></label>
      ${st.idx === 'new' ? `<input class="f" data-lu="newName" list="dl-class" value="${esc(st.newName)}" placeholder="Class name" autocomplete="off">` : ''}</div>`;
    if (st.idx === -1) return `<h2>Level up</h2>${choose}`;
    return `<h2>Level up to ${total}</h2>
      ${c.classes.length > 1 || st.idx === 'new' ? choose : `<p class="sub">${esc(row().name || 'Class')} ${esc(row().level)} → ${newLvl()}</p>`}
      <div class="lusec"><h3>Hit points</h3>
        <div class="row"><label class="hf"><span class="lbl">Roll your d${die()}</span><input class="f n" data-lu="roll" inputmode="numeric" value="${esc(st.roll)}" placeholder="1–${die()}"></label>
        <button class="btn ${st.avg ? 'primary' : ''}" type="button" data-lu-avg>Take average (${avg()})</button></div>
        <label class="hf"><span class="lbl">Extra HP per level (Dwarven Toughness, Tough…)</span><input class="f n" data-lu="bonus" inputmode="numeric" value="${esc(st.bonus)}" placeholder="0"></label>
        <p class="lugain">${g == null ? 'Roll or take the average.' : `${!st.avg && r && r < avg() ? `A ${r} is under the average, so you get ${avg()}. ` : ''}+${g} HP <small>(${st.avg || r < avg() ? avg() : r} ${conMod() >= 0 ? '+' : '−'} ${Math.abs(conMod())} Con${Number(st.bonus) ? ` + ${Number(st.bonus)}` : ''})</small>`}</p>
      </div>
      ${needsSub() ? `<div class="lusec"><h3>Choose your subclass</h3><select class="f" data-lu="sub"><option value="">Choose…</option>${L.subclassesOf(clsOf().id).map(s => `<option value="${esc(s.name)}" ${st.sub === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>` : ''}
      ${isAsi() ? `<div class="lusec"><h3>Ability Score Improvement or feat</h3>
        <div class="seg"><button type="button" data-lu-asi="asi" aria-pressed="${st.asi === 'asi'}">Ability scores</button><button type="button" data-lu-asi="feat" aria-pressed="${st.asi === 'feat'}">Feat</button></div>
        ${st.asi === 'asi' ? `<p class="hint">Pick the same ability twice for +2.</p><div class="row">
          <label class="hf"><span class="lbl">+1 to</span><select class="f" data-lu="asiA">${R.ABILS.map(([k, n]) => `<option value="${k}" ${st.asiA === k ? 'selected' : ''}>${n} (${R.score(c, k)})</option>`).join('')}</select></label>
          <label class="hf"><span class="lbl">+1 to</span><select class="f" data-lu="asiB">${R.ABILS.map(([k, n]) => `<option value="${k}" ${st.asiB === k ? 'selected' : ''}>${n} (${R.score(c, k)})</option>`).join('')}</select></label></div>
          ${['asiA', 'asiB'].some(x => R.score(c, st[x]) + (st.asiA === st.asiB ? 2 : 1) > 20) ? '<p class="warn">That would take a score past 20.</p>' : ''}`
        : `<input class="f" data-lu="feat" list="dl-feats" value="${esc(st.feat)}" placeholder="Feat name" autocomplete="off"><datalist id="dl-feats">${L.all('feat').map(f => `<option value="${esc(f.name)}"></option>`).join('')}</datalist>
          ${L.findByName('feat', st.feat)?.prereq ? `<p class="hint">Prerequisite: ${esc(L.findByName('feat', st.feat).prereq)}</p>` : ''}`}
      </div>` : ''}
      <div class="row end"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-lu-go ${g == null || (st.idx === 'new' && !st.newName.trim()) ? 'disabled' : ''}>Level up</button></div>`;
  };
  actDialog(draw, (e, paint) => {
    if (e.target.closest('[data-lu-avg]')) { st.avg = !st.avg; return paint(); }
    const asi = e.target.closest('[data-lu-asi]'); if (asi) { st.asi = asi.dataset.luAsi; return paint(); }
    if (e.target.closest('[data-lu-go]')) {
      const g = gain(); if (g == null) return;
      if (player() && st.idx === 'new' && !clsOf()) { toast('Pick a class from the list. Ask your DM to add it to the Library if it isn\'t there.'); return; }
      if (player() && isAsi() && st.asi === 'feat' && !L.findByName('feat', st.feat)) { toast('Pick a feat from the list. Ask your DM to add it to the Library if it isn\'t there.'); return; }
      const total = R.totalLevel(c) + 1;
      const asiNow = isAsi();
      if (st.idx === 'new') {
        const k = clsOf();
        c.classes.push({ name: k?.name || st.newName.trim(), sub: '', clsId: k?.id || '', subId: '', level: 1, hd: k?.hd || 8, hdUsed: 0 });
      } else row().level = newLvl();
      const target = st.idx === 'new' ? c.classes[c.classes.length - 1] : row();
      if (st.sub) target.sub = st.sub;
      c.hp.max = (Number(c.hp.max) || 0) + g; hpOp(c, { k: 'gain', n: g });
      c.hpPerLevel = st.bonus;
      stamp(c, 'hp.max'); stamp(c, 'hpPerLevel');
      if (asiNow) {
        if (st.asi === 'asi') {
          for (const a of [st.asiA, st.asiB]) { c.abil[a].adj.push({ src: 'ASI', note: `Level ${total}`, v: 1, id: uid() }); stamp(c, `abil.${a}`); }
        } else if (st.feat.trim()) {
          const f = L.findByName('feat', st.feat);
          c.feats.push({ name: f?.name || st.feat.trim(), text: f ? [f.prereq ? `Prerequisite: ${f.prereq}` : '', f.desc].filter(Boolean).join('\n\n') : '', src: `Level ${total}`, id: uid() });
          stamp(c, 'feats');
        }
      }
      resolvePicks(c);
      const added = syncAuto(c);
      save(c);
      $('#actDlg').close();
      toast(`Level ${total}! +${g} HP${added.features ? `, ${added.features} new feature${added.features === 1 ? '' : 's'}` : ''}.`);
    }
  }, (e, paint) => {
    const el = e.target;
    if (el.name === 'lc') { st.idx = el.value === 'new' ? 'new' : Number(el.value); st.sub = ''; return paint(); }
    const k = el.dataset.lu; if (!k) return;
    st[k] = el.value;
    if (k === 'roll') st.avg = false;
    if (e.type === 'change' || ['asiA', 'asiB', 'sub'].includes(k) || (k === 'newName' && L.findByName('class', el.value)) || (k === 'feat' && L.findByName('feat', el.value))) {
      const pos = el.selectionStart; paint();
      const again = $(`#actDlg [data-lu="${k}"]`); if (again && document.activeElement !== again && el.tagName === 'INPUT') { again.focus(); try { again.setSelectionRange(pos, pos); } catch { /* number field */ } }
    } else {
      // keep typing smooth: update just the result line
      const g = $('#actDlg .lugain'); if (g) { const tmp = document.createElement('div'); tmp.innerHTML = draw(); g.innerHTML = tmp.querySelector('.lugain')?.innerHTML || ''; }
      const go = $('#actDlg [data-lu-go]'); if (go) go.disabled = gain() == null || (st.idx === 'new' && !st.newName.trim());
    }
  });
}

function shortRest() {
  const c = state.cur;
  const log = [];
  const draw = () => `<h2>Short rest</h2>
    <p class="hint">Spend hit dice one at a time: roll at the table, type the number, tap Spend. Your Con modifier (${R.sign(R.amod(c, 'con'))}) is added for you.</p>
    <p class="sub">HP ${c.hp.cur} of ${c.hp.max}</p>
    ${c.classes.map((k, i) => { const left = Math.max(0, (Number(k.level) || 0) - (Number(k.hdUsed) || 0)); return `
      <div class="hdspend"><span><b>d${esc(k.hd)}</b> ${esc(k.name || '')} <small>${left} left</small></span>
        <input class="f n" data-hd="${i}" inputmode="numeric" placeholder="Roll" ${left ? '' : 'disabled'} aria-label="Hit die roll">
        <button class="btn small" type="button" data-hdgo="${i}" ${left ? '' : 'disabled'}>Spend</button></div>`; }).join('')}
    ${log.length ? `<ul class="restlog">${log.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="hint">Finishing the rest refills short-rest features${M.casterInfo(c).pact.slots ? ' and Pact Magic slots' : ''}.</p>
    <div class="row end"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-sr-done>Finish short rest</button></div>`;
  actDialog(draw, (e, paint) => {
    const go = e.target.closest('[data-hdgo]');
    if (go) {
      const i = Number(go.dataset.hdgo), k = c.classes[i];
      const roll = parseInt($(`#actDlg [data-hd="${i}"]`).value, 10);
      if (!roll || roll < 1 || roll > Number(k.hd)) { toast(`Type your d${k.hd} roll (1 to ${k.hd}).`); return; }
      const heal = Math.max(0, roll + R.amod(c, 'con'));
      k.hdUsed = (Number(k.hdUsed) || 0) + 1;
      hpOp(c, { k: 'heal', n: heal });
      stamp(c, 'classes'); save(c);
      log.push(`d${k.hd}: rolled ${roll} ${R.amod(c, 'con') >= 0 ? '+' : '−'} ${Math.abs(R.amod(c, 'con'))} = ${heal} HP`);
      return paint();
    }
    if (e.target.closest('[data-sr-done]')) {
      let n = 0;
      for (const f of c.limited || []) if (f.rec === 'Short rest' && Number(f.left) !== Number(f.total)) { f.left = f.total; n++; }
      M.restoreShort(c);
      stamp(c, 'limited'); stamp(c, 'magic'); save(c);
      $('#actDlg').close();
      toast(`Short rest done.${n ? ` Refilled ${n} feature${n === 1 ? '' : 's'}.` : ''}`);
    }
  });
}

function longRest() {
  const c = state.cur;
  const st = { ate: true };
  const totalHd = c.classes.reduce((t, k) => t + (Number(k.level) || 0), 0);
  const regain = Math.max(1, Math.floor(totalHd / 2));
  const draw = () => `<h2>Long rest</h2>
    <ul class="restlist">
      <li>HP back to full (${c.hp.max}) and temporary HP cleared</li>
      <li>Regain up to ${regain} spent hit dice</li>
      <li>Refill all limited features</li>
      ${M.casterInfo(c).level || M.casterInfo(c).pact.slots ? `<li>Refill ${L.tableSettings().spellMode === 'points' ? 'spell points and the strain-free 5th and 6th level casts' : 'spell slots'}</li>` : ''}
      <li>Reset death saves</li>
      ${Number(c.exhaustion) ? '<li>Lower exhaustion by 1 (if you had food and water)</li>' : ''}
    </ul>
    ${Number(c.exhaustion) ? `<label class="chk"><input type="checkbox" data-ate ${st.ate ? 'checked' : ''}><span>Had food and water</span></label>` : ''}
    <div class="row end"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-lr-go>Finish long rest</button></div>`;
  actDialog(draw, e => {
    if (!e.target.closest('[data-lr-go]')) return;
    hpOp(c, { k: 'set', cur: Number(c.hp.max) || 0, temp: 0 });
    let left = regain;
    for (const k of [...c.classes].sort((a, b) => Number(b.hd) - Number(a.hd))) { const back = Math.min(left, Number(k.hdUsed) || 0); k.hdUsed = (Number(k.hdUsed) || 0) - back; left -= back; }
    for (const f of c.limited || []) f.left = f.total;
    c.death = { s: 0, f: 0 };
    if (Number(c.exhaustion) && st.ate) c.exhaustion = Number(c.exhaustion) - 1;
    M.restoreAll(c);
    c.ip = 'ready';
    for (const p of ['classes', 'limited', 'death', 'exhaustion', 'magic', 'ip']) stamp(c, p);
    save(c);
    $('#actDlg').close();
    toast('Long rest done. You wake refreshed.');
  }, e => { if (e.target.matches('[data-ate]')) st.ate = e.target.checked; });
}

function castSpell(id) {
  const c = state.cur, s = L.get(id); if (!s) return;
  const mode = L.tableSettings().spellMode;
  const info = M.casterInfo(c);
  const sc = M.spellClass(c, s);
  const pactOk = info.pact.slots && sc?.cls?.caster === 'pact';
  const abil = L.get(sc?.k?.subId)?.spellAbil || sc?.cls?.spellAbil || c.spell?.abil || '';
  const levels = [];
  for (let l = Number(s.level) || 1; l <= Math.max(info.maxLevel, 0); l++) levels.push(l);
  const st = { lvl: pactOk ? info.pact.level : levels[0], pact: !!pactOk, done: null };
  const draw = () => {
    if (st.done) {
      const d = st.done;
      const concRem = s.conc ? remindersFor(c, 'conc') : [];
      return `<h2>${esc(s.name)}</h2><p>Cast at level ${d.lvl}${d.how === 'points' ? ` for ${d.cost} spell points` : d.how === 'pact' ? ' with a Pact Magic slot' : ' with a spell slot'}.${s.conc ? ' <b>Concentration.</b>' : ''}</p>
        ${concRem.length ? `<ul class="reminders">${concRem.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${d.strain ? `<div class="strainbox"><h3>Strain save</h3><p>Make a ${ABN[abil] || 'spellcasting ability'} saving throw, <b>DC ${M.strainDc(d.lvl)}</b>. The spell is cast either way.</p>
          <div class="row"><button class="btn" type="button" data-strain="ok">Saved</button><button class="btn danger" type="button" data-strain="fail">Failed: +${M.strainExhaustion(d.lvl)} exhaustion</button></div></div>`
        : `${d.freeLeft != null ? `<p class="hint">${Math.max(0, d.freeLeft - 1)} of ${M.FREE_STRAIN} level ${d.lvl} casts left before the strain save.</p>` : ''}<div class="row end"><button class="btn primary" type="button" data-close>Done</button></div>`}`;
    }
    const opts = [];
    if (pactOk) opts.push(`<label class="chk"><input type="radio" name="cl" value="pact" ${st.pact ? 'checked' : ''}><span>Pact Magic slot (level ${info.pact.level}) · ${Math.max(0, info.pact.slots - M.ensureMagic(c).pact)} left</span></label>`);
    if (mode === 'points' || !pactOk || info.level) for (const l of levels) {
      const p = M.planCast(c, l, mode);
      const extra = mode === 'points' ? `${M.COST[l]} points${p.ok && p.strain ? ' · strain save' : p.freeLeft != null ? ` · ${p.freeLeft} before strain` : ''}` : `${Math.max(0, (info.slots[l - 1] || 0) - (Number(M.ensureMagic(c).slots[l]) || 0))} slots left`;
      opts.push(`<label class="chk ${p.ok ? '' : 'off'}"><input type="radio" name="cl" value="${l}" ${!st.pact && st.lvl === l ? 'checked' : ''} ${p.ok ? '' : 'disabled'}><span>Level ${l} · ${extra}</span></label>`);
    }
    const plan = M.planCast(c, st.lvl, mode, st.pact);
    return `<h2>Cast ${esc(s.name)}</h2>
      <p class="sub">${s.level ? `Level ${s.level}` : 'Cantrip'} ${esc(s.school || '')}${s.conc ? ' · Concentration' : ''}${s.ritual ? ' · Ritual' : ''}</p>
      ${opts.length ? `<div class="pickrows">${opts.join('')}</div>` : '<p class="warn">You have no way to cast this spell yet.</p>'}
      ${plan.ok ? '' : `<p class="warn">${esc(plan.reason)}</p>`}
      ${s.higher ? `<p class="hint"><b>At Higher Levels.</b> ${esc(s.higher)}</p>` : ''}
      <div class="row end"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-cast-go ${plan.ok && opts.length ? '' : 'disabled'}>Cast</button></div>`;
  };
  actDialog(draw, (e, paint) => {
    if (e.target.closest('[data-cast-go]')) {
      const plan = M.planCast(c, st.lvl, mode, st.pact);
      if (!plan.ok) return toast(plan.reason);
      M.applyCast(c, st.lvl, plan);
      stamp(c, 'magic'); save(c);
      st.done = { ...plan, lvl: st.lvl };
      return paint();
    }
    const sb = e.target.closest('[data-strain]');
    if (sb) {
      if (sb.dataset.strain === 'fail') {
        const add = M.strainExhaustion(st.done.lvl);
        c.exhaustion = Math.min(6, (Number(c.exhaustion) || 0) + add); stamp(c, 'exhaustion'); save(c);
        toast(`Exhaustion is now level ${c.exhaustion}.`);
      } else toast('You hold the strain.');
      $('#actDlg').close();
    }
  }, (e, paint) => {
    if (e.target.name === 'cl') { if (e.target.value === 'pact') { st.pact = true; st.lvl = info.pact.level; } else { st.pact = false; st.lvl = Number(e.target.value); } paint(); }
  });
}

/* ---------- the sheet view ---------- */
async function openCharacter(id) {
  sheetCtx.arranging = false;
  const c = await db.get(id);
  if (!c) return toast("That character isn't on this device.");
  state.cur = upgrade(c);
  app.dataset.view = 'sheet';
  state.page = 'sheet';
  renderSheet();
  $('#page').scrollTop = 0;
  window.scrollTo(0, 0);
}
function titleChanged() {
  const n = state.cur?.name || 'Unnamed character';
  $('#title').textContent = n; document.title = n;
}
function renderSheet() {
  const c = state.cur; if (!c) return;
  titleChanged();
  for (const b of document.querySelectorAll('[data-page]')) b.setAttribute('aria-pressed', String(b.dataset.page === state.page));
  $('#arrangeBtn').setAttribute('aria-pressed', String(!!sheetCtx.arranging));
  app.classList.toggle('arranging', !!sheetCtx.arranging);
  const openDetails = [...document.querySelectorAll('#page details[open]')].map(d => d.querySelector('[data-k]')?.dataset.k).filter(Boolean);
  const scroll = $('#sheetwrap').scrollTop;
  renderPage($('#page'), c, state.page);
  for (const k of openDetails) $(`#page [data-k="${CSS.escape(k)}"]`)?.closest('details')?.setAttribute('open', '');
  $('#sheetwrap').scrollTop = scroll;
  if (sheetCtx.openNew) {
    const first = $(`#page [data-k^="${CSS.escape(sheetCtx.openNew)}."]`) || $(`#page [data-list="${CSS.escape(sheetCtx.openNew)}"] .srow:last-of-type input`);
    first?.closest('details')?.setAttribute('open', '');
    // the newest row in a list is the last one
    const all = $('#page').querySelectorAll(`[data-k^="${CSS.escape(sheetCtx.openNew)}."]`);
    const target = all.length ? all[0] : first;
    target?.focus({ preventScroll: false });
    sheetCtx.openNew = null;
  }
  themeChanged(false);
}
function themeChanged(rerenderLook) {
  const c = state.cur; if (!c) return;
  const wrap = $('#sheetwrap');
  applyTheme(document.body, c.theme);
  const bg = wrap.querySelector('.bglayer');
  const t = c.theme.bg;
  bg.style.backgroundImage = t.img ? `url("${t.img}")` : 'none';
  bg.dataset.fit = t.fit || 'cover';
  applyRed();
  if (rerenderLook && !$('#look').hidden) { const sc = $('#look').scrollTop; $('#look').innerHTML = lookPanel(c); $('#look').scrollTop = sc; }
}
function openLook() {
  const look = $('#look');
  look.innerHTML = lookPanel(state.cur);
  look.hidden = false;
  app.classList.add('looking');
  look.querySelector('h2')?.focus?.();
}
function closeLook() { $('#look').hidden = true; app.classList.remove('looking'); }

// Pull the latest from the device store after a Drive sync brought changes
async function changedFromDrive({ library = false } = {}) {
  if (app.dataset.view === 'home') return showHome();
  if (app.dataset.view === 'library') { if (library) showLibrary(); return; }
  const fresh = await db.get(state.cur.id);
  if (!fresh) return;
  await flush();
  const res = merge(state.cur, fresh);
  state.cur = res.merged;
  // the Table Library carries the DM's switches (spell points, initiative, leveling): redraw for those too
  if (!res.changed && !library) return;
  const typing = document.activeElement?.closest?.('#page') && document.activeElement.matches('input,textarea,select');
  if (typing) updateCalcs($('#page'), state.cur); else renderSheet();
}

/* ---------- ability score breakdown ---------- */
// Increases from a race, a class (ASI at level up), a feat or a boon come from the DM's Library: players can't change them
const ALL_SRCS = ['Racial', 'ASI', 'Feat', 'Training', 'Magic item', 'Boon', 'Other'];
const PLAYER_SRCS = ['Training', 'Magic item', 'Other'];
const player = () => !isDm();
const lockedAdj = x => player() && (x.auto || !PLAYER_SRCS.includes(x.src));
function openAbility(a) {
  const c = state.cur;
  const name = R.ABILS.find(x => x[0] === a)[1];
  const dlg = $('#abilDlg');
  const draw = () => {
    const ab = c.abil[a];
    dlg.querySelector('.body').innerHTML = `
      <h2>${name}</h2>
      <div class="abilsum"><b>${R.score(c, a)}</b><span>${R.sign(R.amod(c, a))}</span></div>
      <label class="hf"><span class="lbl">Base score (rolled or point-buy)</span><input class="f n" data-ab="base" inputmode="numeric" value="${esc(ab.base)}"></label>
      <span class="lbl">Increases and where they came from</span>
      <div class="adjlist">${(ab.adj || []).map((x, i) => lockedAdj(x) ? `
        <div class="srow rorow"><span>${esc(x.src)}${x.note ? ` · ${esc(x.note)}` : ''}</span><b>${R.sign(Number(x.v) || 0)}</b></div>` : `
        <div class="srow">
          <select class="f" data-adj="${i}" data-f="src" aria-label="Source">${(player() ? PLAYER_SRCS : ALL_SRCS).map(s => `<option ${x.src === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <input class="f" data-adj="${i}" data-f="note" value="${esc(x.note)}" placeholder="Detail (Level 4, Belt of…)" aria-label="Detail" autocomplete="off">
          <input class="f n" data-adj="${i}" data-f="v" inputmode="numeric" value="${esc(x.v)}" aria-label="Amount">
          <button class="x" type="button" data-adjdel="${i}" aria-label="Remove">×</button>
        </div>`).join('') || '<p class="empty">No increases yet.</p>'}</div>
      <button class="linkbtn" type="button" data-adjadd>Add an increase</button>`;
  };
  draw();
  const touch = () => { stamp(c, `abil.${a}`); save(c); dlg.querySelector('.abilsum').innerHTML = `<b>${R.score(c, a)}</b><span>${R.sign(R.amod(c, a))}</span>`; };
  dlg.oninput = e => {
    const el = e.target, ab = c.abil[a];
    if (el.dataset.ab === 'base') ab.base = el.value === '' ? '' : Number(el.value) || 0;
    else if (el.dataset.adj != null) { const x = ab.adj[el.dataset.adj]; x[el.dataset.f] = el.dataset.f === 'v' ? (el.value === '' ? '' : Number(el.value) || 0) : el.value; }
    touch();
  };
  dlg.onchange = dlg.oninput;
  dlg.onclick = e => {
    if (e.target.closest('[data-adjadd]')) { c.abil[a].adj.push({ src: player() ? 'Training' : 'Racial', note: '', v: 1, id: uid() }); touch(); draw(); dlg.querySelector('.adjlist .srow:last-child input.n')?.focus(); }
    const del = e.target.closest('[data-adjdel]');
    if (del && !lockedAdj(c.abil[a].adj[Number(del.dataset.adjdel)])) { c.abil[a].adj.splice(Number(del.dataset.adjdel), 1); touch(); draw(); }
    if (e.target.closest('[data-close]')) dlg.close();
  };
  dlg.onclose = () => renderSheet();
  dlg.showModal();
}

/* ---------- armor class ---------- */
function openAc() {
  const c = state.cur, a = c.ac, dlg = $('#acDlg');
  const draw = () => {
    dlg.querySelector('.body').innerHTML = `
      <h2>Armor class</h2>
      <div class="abilsum"><b>${R.armorClass(c).withTemp}</b><span>${Number(a.temp) ? `includes ${R.sign(Number(a.temp))} temp` : ''}</span></div>
      <div class="seg" role="group" aria-label="Armor or unarmored">
        <button type="button" data-mode="armor" aria-pressed="${a.mode !== 'unarmored'}">Wearing armor</button>
        <button type="button" data-mode="unarmored" aria-pressed="${a.mode === 'unarmored'}">Unarmored</button>
      </div>
      ${a.mode === 'unarmored' ? `
        <p class="hint">10 + Dexterity, plus a second ability for Unarmored Defense (Constitution for Barbarians, Wisdom for Monks).</p>
        <label class="hf"><span class="lbl">Unarmored Defense adds</span><select class="f" data-ac="unarmoredAbil"><option value="">Nothing</option>${R.ABILS.filter(([k]) => k !== 'dex').map(([k, n]) => `<option value="${k}" ${a.unarmoredAbil === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`
      : `
        <div class="grid2">
          <label class="hf"><span class="lbl">Armor name</span><input class="f" data-ac="armorName" value="${esc(a.armorName)}" placeholder="Chain shirt" autocomplete="off"></label>
          <label class="hf"><span class="lbl">Armor's base AC</span><input class="f n" data-ac="base" data-num inputmode="numeric" value="${esc(a.base)}"></label>
          <label class="hf"><span class="lbl">Max Dex bonus</span><input class="f n" data-ac="maxDex" data-num inputmode="numeric" value="${esc(a.maxDex)}" placeholder="none"></label>
          <label class="hf"><span class="lbl">Strength needed</span><input class="f n" data-ac="str" data-num inputmode="numeric" value="${esc(a.str)}" placeholder="—"></label>
        </div>
        <label class="chk"><input type="checkbox" data-ac="stealthDis" ${a.stealthDis ? 'checked' : ''}><span>Disadvantage on Stealth</span></label>
        <p class="hint">Light armor: leave Max Dex blank. Medium: 2. Heavy: 0.</p>`}
      <div class="grid2">
        <label class="hf"><span class="lbl">Shield</span><input class="f n" data-ac="shield" data-num inputmode="numeric" value="${esc(a.shield)}"></label>
        <label class="hf"><span class="lbl">Other bonuses (ring, fighting style)</span><input class="f n" data-ac="misc" data-num inputmode="numeric" value="${esc(a.misc)}"></label>
        <label class="hf"><span class="lbl">Temporary AC bonus</span><input class="f n" data-ac="temp" data-num inputmode="numeric" value="${esc(a.temp)}"></label>
        <label class="hf"><span class="lbl">Initiative bonus (Alert, etc.)</span><input class="f n" data-init inputmode="numeric" value="${esc(c.init.misc)}"></label>
      </div>`;
  };
  draw();
  const sum = () => { dlg.querySelector('.abilsum').innerHTML = `<b>${R.armorClass(c).withTemp}</b><span>${Number(a.temp) ? `includes ${R.sign(Number(a.temp))} temp` : ''}</span>`; };
  dlg.oninput = e => {
    const el = e.target;
    if (el.dataset.init != null) { c.init.misc = Number(el.value) || 0; stamp(c, 'init.misc'); save(c); return; }
    const k = el.dataset.ac; if (!k) return;
    a[k] = el.type === 'checkbox' ? el.checked : el.dataset.num != null ? (el.value === '' ? '' : Number(el.value) || 0) : el.value;
    stamp(c, `ac.${k}`); save(c); sum();
  };
  dlg.onchange = dlg.oninput;
  dlg.onclick = e => {
    const m = e.target.closest('[data-mode]');
    if (m) { a.mode = m.dataset.mode; stamp(c, 'ac.mode'); save(c); draw(); }
    if (e.target.closest('[data-close]')) dlg.close();
  };
  dlg.onclose = () => renderSheet();
  dlg.showModal();
}

/* ---------- share / link / export / import ---------- */
async function shareDialog(id) {
  const c = await db.get(id); if (!c) return;
  const dlg = $('#shareDlg');
  dlg.querySelector('.who').textContent = c.name || 'this character';
  const input = dlg.querySelector('input');
  input.value = c.playerEmail || '';
  const status = dlg.querySelector('.status');
  status.textContent = '';
  dlg.querySelector('.current').textContent = '';
  sync.sharedWith(c).then(list => { if (list?.length) dlg.querySelector('.current').textContent = `Shared with ${list.filter(e => e !== ''.trim()).join(', ')}.`; }).catch(() => {});
  dlg.showModal();
  dlg.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    status.textContent = 'Sharing…';
    try {
      const cur = upgrade(await db.get(id));
      cur.playerEmail = input.value.trim(); stamp(cur, 'playerEmail'); await db.put(cur);
      await sync.shareWithPlayer(cur, input.value);
      dlg.close();
      toast(`Shared ${cur.name || 'the sheet'} with ${input.value.trim()}. They can open it from Settings on their device.`);
      showHome();
    } catch (err) { status.textContent = err.message; }
  };
}

async function linkDialog(id) {
  const c = await db.get(id); if (!c) return;
  try {
    const got = await sync.openShared(upgrade(c));
    if (got) { toast('Linked. This sheet now syncs with Drive.'); showHome(); }
  } catch (err) { toast(err.message); }
}

function download(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function exportOne(id) {
  const c = await db.get(id);
  download(`${(c.name || 'character').replace(/[^\w -]+/g, '')}.charsheet.json`, c);
}
async function exportAll() {
  const chars = await db.all();
  download(`character-sheets-backup-${new Date().toISOString().slice(0, 10)}.json`, { app: 'charsheet', backup: true, exported: new Date().toISOString(), chars });
  toast(`Saved ${chars.length} character${chars.length === 1 ? '' : 's'}.`);
}
async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = data?.backup ? data.chars : [data];
    let n = 0;
    for (const r of list) {
      if (r?.app !== 'charsheet' || !r.id) continue;
      const local = await db.get(r.id);
      await db.put(merge(local ? upgrade(local) : null, r).merged); n++;
    }
    toast(n ? `Loaded ${n} character${n === 1 ? '' : 's'}.` : "That file doesn't hold any character sheets from this app.");
    showHome();
  } catch { toast("That file couldn't be read."); }
}
async function deleteChar(id) {
  const c = await db.get(id); if (!c) return;
  const linked = sync.linkOf(id);
  const msg = linked
    ? `Delete ${c.name || 'this character'} from this device? ${isDm() ? 'The copy in your Drive folder stays; delete it there too if you want it gone.' : 'The copy in Drive stays with your DM.'}`
    : `Delete ${c.name || 'this character'}? This can't be undone. Use "Save a copy" first if you might want it back.`;
  if (!confirm(msg)) return;
  await db.del(id); await sync.forget(id);
  toast(`Deleted ${c.name || 'the character'}.`);
  showHome();
}

/* ---------- settings dialog ---------- */
function renderTableRules() {
  const box = $('#tableRules'), t = L.tableSettings();
  if (isDm()) {
    box.innerHTML = `<div class="trrow"><span>Spellcasting</span><div class="seg" role="group" aria-label="Spellcasting"><button type="button" data-ts="spellMode" data-v="points" aria-pressed="${t.spellMode === 'points'}">Spell points</button><button type="button" data-ts="spellMode" data-v="slots" aria-pressed="${t.spellMode === 'slots'}">Spell slots</button></div></div>
      <div class="trrow"><span>Leveling</span><div class="seg" role="group" aria-label="Leveling"><button type="button" data-ts="leveling" data-v="xp" aria-pressed="${t.leveling === 'xp'}">Experience points</button><button type="button" data-ts="leveling" data-v="milestone" aria-pressed="${t.leveling === 'milestone'}">Milestone</button></div></div>
      <div class="trrow"><span>Initiative</span><div class="seg" role="group" aria-label="Initiative"><button type="button" data-ts="initiative" data-v="active" aria-pressed="${t.initiative === 'active'}">Active Initiative</button><button type="button" data-ts="initiative" data-v="standard" aria-pressed="${t.initiative === 'standard'}">Standard</button></div></div>
      <p class="hint">These apply to every sheet at the table. Players get the change with the Table Library.</p>`;
  } else {
    box.innerHTML = `<p>Your DM has set ${t.spellMode === 'points' ? 'spell points' : 'spell slots'}, ${t.initiative === 'active' ? 'Active Initiative' : 'standard initiative'} and ${t.leveling === 'milestone' ? 'milestone leveling' : 'experience points'}.</p>`;
  }
}
// DM: which Session Notes character and which magic item character each sheet belongs to
async function renderLinked() {
  const box = $('#linkedApps'), set = $('#linkedSet');
  set.hidden = !isDm();
  if (set.hidden) return;
  const src = B.sources, opts = B.linkOptions(), links = await B.getLinks();
  const chars = (await db.all()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (!src.read) { box.innerHTML = `<p class="hint">Connect Google Drive and sync once. Your device then reads Session Notes and the magic item app and links each sheet to the same character there, by name.</p>`; return; }
  const sel = (c, app, list, cur) => `<select class="f" data-link="${app}" data-char="${c.id}"><option value="">${cur ? 'Match by name' : 'Match by name (none found)'}</option><option value="none" ${links[c.id]?.[app] === 'none' ? 'selected' : ''}>Not linked</option>${list.map(o => `<option value="${esc(o.id)}" ${links[c.id]?.[app] === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
  box.innerHTML = `${src.error ? `<p class="warn">${esc(src.error)}</p>` : ''}
    <p class="hint">${src.sn ? 'Session Notes found.' : 'Session Notes not found in your Drive.'} ${src.mi ? `Magic item app found${src.miSaved ? `, last saved to Drive ${esc(src.miSaved)}` : ''}.` : 'Magic item app not found in your Drive (turn on its Google Drive sync).'}${src.mi && src.seedOk === false ? " Couldn't load the magic item list from the magic-items site." : ''}</p>
    <table class="links"><thead><tr><th>Sheet</th><th>Session Notes</th><th>Magic items</th></tr></thead><tbody>
    ${chars.map(c => { const r = B.resolvedLinks(c, links); return `<tr><td>${esc(c.name || 'Unnamed')}</td><td>${sel(c, 'sn', opts.sn, r.sn)}${r.sn ? `<small>${esc(r.sn.name)}</small>` : ''}</td><td>${sel(c, 'mi', opts.mi, r.mi)}${r.mi ? `<small>${esc(r.mi.name)}${(() => { const n = src.miCounts[c.id]; if (!n) return ''; return n.held === n.shown ? ` · ${n.held} item${n.held === 1 ? '' : 's'}` : ` · ${n.held} held, only ${n.shown} found in the item list`; })()}</small>` : ''}</td></tr>`; }).join('')}
    </tbody></table>`;
}
function openSettings() {
  const dlg = $('#settingsDlg');
  renderTableRules();
  renderLinked();
  refreshRoleUi();
  sync.renderStatus();
  dlg.showModal();
}

/* ---------- wiring ---------- */
const sheetCtx = {
  save, toast, titleChanged, openNew: null,
  rerender: () => renderSheet(),
  themeChanged, closeLook, openAbility, openAc,
  picked, viewEntry,
  isPlayer: () => !isDm(),
  levelUp, shortRest, longRest, cast: castSpell, spellFilter: 'mine',
};

async function start() {
  await loadSettings();
  await L.loadLibrary();
  initSheet(sheetCtx);
  initLibrary($('#libview'), { toast, isDm: () => isDm(), libraryEdited: () => {}, chars: () => state.chars.map(c => ({ id: c.id, name: c.name })) });
  $('#libBtn').addEventListener('click', () => openLibraryView());
  bindSheet($('#app'), () => state.cur);
  const tb = () => document.documentElement.style.setProperty('--tb', `${$('.topbar').offsetHeight}px`);
  tb(); window.addEventListener('resize', tb);

  $('#backBtn').addEventListener('click', () => { closeLook(); showHome(); });
  $('#newBtn').addEventListener('click', newChar);
  $('#newBtn2').addEventListener('click', newChar);
  $('#lookBtn').addEventListener('click', () => ($('#look').hidden ? openLook() : closeLook()));
  $('#arrangeBtn').addEventListener('click', () => {
    sheetCtx.arranging = !sheetCtx.arranging;
    if (sheetCtx.arranging) { state.page = 'sheet'; closeLook(); }
    renderSheet();
  });
  matchMedia('(max-width: 700px)').addEventListener('change', () => { if (state.cur) renderSheet(); });
  $('#redBtn').addEventListener('click', () => { state.settings.red = !state.settings.red; saveSettings(); applyRed(); });
  $('#settingsBtn').addEventListener('click', openSettings);
  for (const b of document.querySelectorAll('[data-page]')) b.addEventListener('click', () => { state.page = b.dataset.page; sheetCtx.arranging = false; renderSheet(); $('#sheetwrap').scrollTop = 0; });

  $('#charList').addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.open) openCharacter(t.dataset.open);
    if (t.dataset.share) shareDialog(t.dataset.share);
    if (t.dataset.link) linkDialog(t.dataset.link);
    if (t.dataset.export) exportOne(t.dataset.export);
    if (t.dataset.del) deleteChar(t.dataset.del);
  });

  const sd = $('#settingsDlg');
  sd.addEventListener('click', e => {
    const r = e.target.closest('[data-role]');
    if (r) {
      state.settings.role = r.dataset.role; saveSettings();
      refreshRoleUi();
      if (r.dataset.role === 'dm' && !state.dmOk) toast(sync.currentEmail() ? 'Dungeon Master mode is only for your DM\'s Google account.' : 'Connect Google Drive with your DM account to turn on Dungeon Master mode.');
      if (state.cur) renderSheet();
      sync.renderStatus();
      renderTableRules();
      renderLinked();
      if (app.dataset.view === 'home') showHome();
      if (app.dataset.view === 'library') showLibrary();
    }
    const ts = e.target.closest('[data-ts]');
    if (e.target.closest('#linkSync')) { sync.syncNow({ interactive: true }).then(renderLinked); }
    if (ts) { L.setTableSetting(ts.dataset.ts, ts.dataset.v).then(() => { renderTableRules(); if (state.cur) renderSheet(); }); }
    if (e.target.closest('#exportAll')) exportAll();
    if (e.target.closest('[data-close]')) sd.close();
  });
  sd.addEventListener('change', async e => {
    const s = e.target.closest('[data-link]'); if (!s) return;
    await B.setLink(s.dataset.char, s.dataset.link, s.value);
    toast('Link saved. It applies on the next sync.');
    renderLinked(); sync.syncNow({ quiet: true });
  });
  $('#importFile').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; sd.close(); });
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target === d) d.close(); });

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#look').hidden && !document.querySelector('dialog[open]')) closeLook(); });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  await sync.initSync({
    toast, choose,
    // before the account is known (first sign-in on the DM's device) the chosen role is used, so the sign-in asks for the DM's access
    settings: () => ({ ...state.settings, role: state.settings.role === 'dm' && (state.dmOk || !sync.currentEmail()) ? 'dm' : 'player' }),
    checkEmail,
    changedFromDrive,
    openCharacter,
  });
  // know whether this device is the DM's before drawing anything
  await checkEmail(sync.currentEmail());
  await showHome();
  registerSW();
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController) return;
    await flush();
    location.reload();
  });
}

start();
