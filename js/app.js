import { db } from './db.js';
import { newCharacter, upgrade, merge, stamp, uid, hpOp, getPath, setPath, replayHp } from './model.js';
import * as R from './rules.js';
import { initSheet, renderPage, bindSheet, updateCalcs, lookPanel, applyTheme, esc, remindersFor, setLiveView, combatView, refreshCombatBar } from './sheet.js';
import { PRESETS } from './theme.js';
import * as sync from './sync.js';
import * as L from './library.js';
import { resolvePicks, syncAuto, clearSoftChoices } from './autofill.js';
import { initLibrary, showLibrary, entryHtml } from './libui.js';
import * as M from './magic.js';
import * as O from './options.js';
import * as B from './bridge.js';
import * as CR from './creatures.js';
import * as INF from './infuse.js';
import { isDmEmail } from './dm.js';
import { fmt, tabIndent } from './text.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const state = { chars: [], cur: null, page: 'sheet', settings: { role: 'player', red: false }, dmOk: false };
// DM mode needs both: DM chosen in Settings, and this device signed in to the DM's Google account
const isDm = () => state.settings.role === 'dm' && state.dmOk;
async function checkEmail(email) {
  // DM of the table chosen in the launcher; before any table exists, the account this app was set up for
  const tr = sync.tableRole();
  state.dmOk = tr === 'dm' || (tr !== 'player' && await isDmEmail(email));
  if (state.settings.autoRole && tr) { state.settings.role = tr === 'dm' ? 'dm' : 'player'; delete state.settings.autoRole; saveSettings(); refreshRoleUi(); }
  if (state.settings.role === 'dm' && email && !state.dmOk) {
    state.settings.role = 'player'; saveSettings();
    toast(sync.tableRole() === 'player' ? 'You\'re a player at this table, so this device stays in Player mode.' : 'Dungeon Master mode is for the DM of a table (create one in the launcher). This device stays in Player mode.');
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
  liveSendOps(c);
}
async function flush() { if (saveTimer && state.cur) { clearTimeout(saveTimer); saveTimer = null; await db.put(state.cur); } }

/* ---------- settings ---------- */
async function loadSettings() {
  const s = await db.getMeta('settings');
  if (s) Object.assign(state.settings, s);
  else state.settings.autoRole = true; // a brand-new device: take the role from the table chosen in the launcher
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
  liveFollow(null);
  app.dataset.view = 'home';
  applyTheme(document.body, newCharacter().theme);
  document.body.style.removeProperty('--bg-blur');
  $('#title').textContent = 'Characters';
  document.title = 'Character Sheets';
  state.chars = (await db.all()).map(upgrade).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const dm = isDm();
  // DM: the suite's campaigns. The filter here only changes what this screen shows, never the other apps.
  const camps = dm ? sync.campaignList() : [];
  const bar = $('#campBar');
  bar.hidden = !camps.length;
  let view = state.settings.campView;
  if (view == null || (view !== 'all' && view !== 'none' && !camps.some(k => k.id === view))) view = sync.currentCampaignId() || 'all';
  const untagged = state.chars.some(c => !c.campaignId);
  if (camps.length) {
    const cur = sync.currentCampaignId();
    bar.innerHTML = `<label>Show <select class="f" id="campView">
      <option value="all"${view === 'all' ? ' selected' : ''}>All characters</option>
      ${camps.map(k => `<option value="${esc(k.id)}"${view === k.id ? ' selected' : ''}>${esc(k.name || 'Unnamed campaign')}${k.id === cur ? ' (current)' : ''}</option>`).join('')}
      ${untagged || view === 'none' ? `<option value="none"${view === 'none' ? ' selected' : ''}>No campaign</option>` : ''}
    </select></label>`;
  }
  const shown = !camps.length || view === 'all' ? state.chars : state.chars.filter(c => (view === 'none' ? !c.campaignId : c.campaignId === view));
  const campSel = c => `<select class="f campsel" data-camp="${c.id}" aria-label="Campaign for ${esc(c.name || 'this character')}">
    ${c.campaignId && !camps.some(k => k.id === c.campaignId) ? `<option value="${esc(c.campaignId)}" selected>Unknown campaign</option>` : ''}
    <option value=""${c.campaignId ? '' : ' selected'}>No campaign</option>
    ${camps.map(k => `<option value="${esc(k.id)}"${c.campaignId === k.id ? ' selected' : ''}>${esc(k.name || 'Unnamed campaign')}</option>`).join('')}</select>`;
  const list = $('#charList');
  list.innerHTML = shown.map(c => {
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
        ${camps.length ? campSel(c) : ''}
      </div>
    </article></li>`;
  }).join('');
  for (const card of list.querySelectorAll('.card')) applyTheme(card, state.chars.find(c => c.id === card.dataset.id).theme);
  $('#homeEmpty').hidden = shown.length > 0;
  if (!shown.length && state.chars.length) {
    $('#homeEmpty').hidden = false;
    $('#homeEmpty').innerHTML = '<p>No characters in this campaign yet. Pick "All characters" above to see everyone.</p>';
    $('#newBtn2').hidden = false;
    applyRed();
    return;
  }
  $('#newBtn2').hidden = state.chars.length > 0;
  if (!dm) sharedBanner();
  $('#homeEmpty').innerHTML = dm
    ? '<p>No characters yet. Make one here, or connect Google Drive in Settings to pull in the sheets already in your Character Sheets folder.</p>'
    : '<p>No characters yet. Make a new one, or if your DM already shared your sheet, connect Google Drive in Settings and open it.</p>';
  applyRed();
}

// A player: sheets the DM shared that this device hasn't opened yet, offered right here
async function sharedBanner(tries = 0) {
  let box = $('#sharedBox');
  if (!box) { box = document.createElement('div'); box.id = 'sharedBox'; box.className = 'sharedbox'; $('#charList').before(box); }
  const p = await sync.pendingShared().catch(() => null);
  if (app.dataset.view !== 'home') return;
  if (!p && tries < 4) setTimeout(() => { if (app.dataset.view === 'home') sharedBanner(tries + 1); }, 4000); // signing in can take a moment
  if (!p) { box.hidden = true; return; }
  const names = p.sheets.map(s => s.name || 'a character');
  box.hidden = false;
  box.innerHTML = `<p><b>Your DM shared ${names.length ? esc(names.join(' and ')) : 'the Table Library'} with you.</b> ${names.length && p.lib ? 'The Table Library comes with it. ' : ''}Google asks you to pick shared files once: tap Open, then tap ${names.length + (p.lib ? 1 : 0) > 1 ? 'each file' : 'the file'} and Select.</p>
    <button class="btn primary" type="button" id="openShared">Open ${names.length === 1 ? esc(names[0]) : 'them'}</button>`;
  $('#openShared').onclick = async () => {
    try { const n = await sync.openPending(p); if (n) { toast('Opened. It stays in step with your DM from now on.'); showHome(); } }
    catch (err) { toast(err.message); }
  };
}
async function newChar() {
  const c = newCharacter('');
  c.edits = {};
  c.abilGen = { done: false }; // a new character sets their scores with a method the table allows
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
// chosen: a race, background or first class a player just picked for themselves (they get one go at it)
function picked(chosen = '') {
  const c = state.cur; if (!c) return;
  if (chosen && player()) {
    resolvePicks(c);
    const idOf = { race: () => c.raceId, background: () => c.bgId, 'classes.0.name': () => c.classes?.[0]?.clsId }[chosen];
    const name = getPath(c, chosen);
    const what = { race: R.F.is2024() ? 'species' : 'race', background: 'background', 'classes.0.name': 'class' }[chosen];
    const undo = () => { setPath(c, chosen, ''); stamp(c, chosen); save(c); renderSheet(); };
    if (!idOf?.()) { undo(); if (name) toast(`Pick a ${what} from the list. Ask your DM to add it to the Library if it isn't there.`); return; }
    if (!confirm(`Choose ${name} as your ${what}? Once it's chosen, only your DM can change it.`)) { undo(); return; }
  }
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
      <label class="chk"><input type="radio" name="lc" value="new" ${st.idx === 'new' ? 'checked' : ''}><span>A new class (multiclass) at level 1</span></label>
      ${st.idx === 'new' ? `<select class="f" data-lu="newName" aria-label="New class"><option value="">Choose a class…</option>${L.all('class').filter(k => !c.classes.some(x => x.clsId === k.id)).map(k => `<option value="${esc(k.name)}" ${st.newName === k.name ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>` : ''}</div>`;
    if (st.idx === -1) return `<h2>Level up</h2>${choose}`;
    return `<h2>Level up to ${total}</h2>
      ${choose}
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
          <label class="hf"><span class="lbl">+1 to</span><select class="f" data-lu="asiA">${R.ABILS.map(([k, n]) => `<option value="${k}" ${st.asiA === k ? 'selected' : ''}>${n} (${R.baseScore(c, k)})</option>`).join('')}</select></label>
          <label class="hf"><span class="lbl">+1 to</span><select class="f" data-lu="asiB">${R.ABILS.map(([k, n]) => `<option value="${k}" ${st.asiB === k ? 'selected' : ''}>${n} (${R.baseScore(c, k)})</option>`).join('')}</select></label></div>
          ${['asiA', 'asiB'].some(x => R.baseScore(c, st[x]) + (st.asiA === st.asiB ? 2 : 1) > 20) ? '<p class="warn">That would take a score past 20.</p>' : ''}`
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
      const optBefore = O.counts(c); // before the level changes, to tell what's new
      if (clearSoftChoices(c)) stamp(c, 'choicesDone'); // skill and ability pick reminders from before are done
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
          c.feats.push({ name: f?.name || st.feat.trim(), text: f ? [f.prereq ? `Prerequisite: ${f.prereq}` : '', f.desc].filter(Boolean).join('\n\n') : '', src: `Level ${total}`, id: uid(), ...(f ? { libId: `feat:${f.id}` } : {}) });
          stamp(c, 'feats');
        }
      }
      resolvePicks(c);
      const added = syncAuto(c);
      save(c);
      $('#actDlg').close();
      const optAfter = O.counts(c);
      const newPicks = Object.entries(optAfter).filter(([k, n]) => n > (optBefore[k] || 0)).map(([k, n]) => `${n - (optBefore[k] || 0)} ${k}`);
      toast(`Level ${total}! +${g} HP${added.features ? `, ${added.features} new feature${added.features === 1 ? '' : 's'}` : ''}.${newPicks.length ? ` New to choose under Class options: ${newPicks.join(', ')}.` : ''}`);
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

// DM: give this character a companion or a form from the Bestiary
function addCreature(kind = 'companion') {
  const c = state.cur;
  const st = { q: '', list: null, err: '', loading: true, open: '' };
  const draw = () => {
    const q = st.q.trim().toLowerCase();
    const hits = (st.list || []).filter(m => !q || m.name.toLowerCase().includes(q) || String(m.type || '').toLowerCase().includes(q)).slice(0, 60);
    return `<h2>Add a ${kind === 'form' ? 'form' : 'companion'}</h2>
      <p class="sub">${kind === 'form' ? 'A shape they can take, like Polymorph. Its HP replaces theirs until it drops or they revert.' : 'A creature at their side with its own HP: Homunculus Servant, Eldritch Cannon, a familiar…'} From your Bestiary.</p>
      <input class="f" type="search" data-crq value="${esc(st.q)}" placeholder="Search your Bestiary" aria-label="Search your Bestiary" autocomplete="off">
      <div class="optlist">${st.loading ? '<p class="empty">Reading your Bestiary…</p>' : st.err ? `<p class="empty">${esc(st.err)}</p>` : hits.map(m => `
        <div class="optrow"><button type="button" class="optname" data-crread="${esc(m.id)}" aria-expanded="${st.open === m.id}">${esc(m.name)} <small>${esc([m.size, m.type].filter(Boolean).join(' '))} · CR ${esc(m.cr)}</small></button>
          <button class="btn small primary" type="button" data-crpick="${esc(m.id)}">Add</button>
          ${st.open === m.id ? `<div class="optdesc">${CR.statBlock(c, m)}</div>` : ''}</div>`).join('') || '<p class="empty">Nothing matches. Add it to the Bestiary first, then try again.</p>'}</div>
      <div class="row end"><button class="btn primary" type="button" data-close>Done</button></div>`;
  };
  const dlg = actDialog(draw, (e, paint) => {
    const r = e.target.closest('[data-crread]');
    if (r) { st.open = st.open === r.dataset.crread ? '' : r.dataset.crread; return paint(); }
    const pk = e.target.closest('[data-crpick]');
    if (pk) {
      const m = st.list.find(x => x.id === pk.dataset.crpick); if (!m) return;
      c.creatures = [...(c.creatures || []), { id: uid(), kind, monId: m.id, name: m.name, snap: B.snapOf(m), ov: {} }];
      stamp(c, 'creatures'); save(c);
      toast(`Added ${m.name} to ${c.name || 'this sheet'}.`);
      dlg.close();
    }
  }, (e, paint) => {
    if (e.type !== 'input' || !e.target.matches('[data-crq]')) return;
    st.q = e.target.value; const pos = e.target.selectionStart; paint();
    const f = dlg.querySelector('[data-crq]'); f.focus(); f.setSelectionRange(pos, pos);
  });
  sync.bestiaryMonsters().then(list => {
    st.loading = false;
    if (!list) st.err = navigator.onLine ? "Couldn't read your Bestiary. Make sure it's syncing with Google Drive, and that you're signed in here." : 'Adding from the Bestiary needs a connection.';
    else st.list = list;
    if (dlg.open) { const pos = dlg.querySelector('[data-crq]')?.selectionStart; paint(); if (pos != null) { const f = dlg.querySelector('[data-crq]'); f.focus(); f.setSelectionRange(pos, pos); } }
  }).catch(() => { st.loading = false; st.err = "Couldn't read your Bestiary just now."; if (dlg.open) paint(); });
  const paint = () => { dlg.querySelector('.body').innerHTML = draw(); };
}

// Artificer: put a known infusion into an item and hand it to someone
function infuseDialog() {
  const c = state.cur;
  const known = INF.known(c);
  const used = new Set((c.infused || []).map(i => i.optId));
  const st = { opt: known.find(o => !used.has(o.id))?.id || '', target: '', holder: '' };
  const max = INF.limit(c), n = (c.infused || []).length;
  const draw = () => {
    const o = L.get(st.opt);
    const full = max != null && n >= max;
    const oldest = full ? [...c.infused].sort((a, b) => a.at - b.at)[0] : null;
    return `<h2>Infuse an item</h2>
      <p class="sub">${max != null ? `${n} of ${max} infused items.` : 'Add an Infused Items column to the class table to track the limit.'}</p>
      <label class="hf"><span class="lbl">Infusion</span><select class="f" data-inf="opt">${known.map(k => `<option value="${esc(k.id)}" ${k.id === st.opt ? 'selected' : ''} ${used.has(k.id) ? 'disabled' : ''}>${esc(k.name)}${used.has(k.id) ? ' (already in an item)' : ''}</option>`).join('')}</select></label>
      ${o && !o.itemSnap ? `<label class="hf"><span class="lbl">The item it goes into</span><input class="f" data-inf="target" value="${esc(st.target)}" placeholder="Longsword, shield, a backpack…" autocomplete="off"></label>` : o?.itemSnap ? `<p class="hint">Makes a ${esc(o.itemSnap.name)}.</p>` : ''}
      <label class="hf"><span class="lbl">Who holds it</span><select class="f" data-inf="holder"><option value="">You (${esc(c.name || 'this character')})</option>${INF.party(c).map(p => `<option value="${esc(p.id)}" ${p.id === st.holder ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      ${o ? `<details class="optdesc"><summary>Read ${esc(o.name)}</summary>${esc(o.desc || '').split(/\n{2,}/).map(t => `<p>${t}</p>`).join('')}</details>` : '<p class="empty">No infusions known. Choose them under Class options.</p>'}
      ${oldest ? `<p class="warn">You're at your limit, so ${esc(INF.view(oldest).name)} stops being infused.</p>` : ''}
      <div class="row end"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="button" data-infgo ${o ? '' : 'disabled'}>Infuse</button></div>`;
  };
  const dlg = actDialog(draw, (e, paint) => {
    if (!e.target.closest('[data-infgo]')) return;
    const o = L.get(st.opt); if (!o) return;
    if (!o.itemSnap && !st.target.trim()) { toast('Name the item it goes into.'); dlg.querySelector('[data-inf="target"]')?.focus(); return; }
    const r = INF.infuse(c, st.opt, st.target, st.holder);
    if (!r.ok) return toast(r.reason);
    stamp(c, 'infused'); save(c);
    const v = INF.view(r.rec);
    toast(`${v.name} is infused${st.holder ? ` and goes to ${INF.holderName(c, st.holder)}` : ''}.${r.ended ? ` ${INF.view(r.ended).name} is no longer infused.` : ''}`);
    dlg.close();
  }, (e, paint) => {
    const k = e.target.dataset.inf; if (!k) return;
    st[k] = e.target.value;
    if (k !== 'target' && e.type === 'change') paint();
  });
}

// Choose a class option (Invocation, Metamagic…) from the Library
function pickOption(group) {
  const c = state.cur;
  const st = { open: '' };
  const para = fmt;
  const draw = () => {
    const g = O.groupsFor(c).find(x => x.group === group);
    const left = g ? g.count - g.chosen.length : 0;
    const list = O.choicesIn(c, group);
    return `<h2>${esc(group)}</h2>
      <p class="sub">${left > 0 ? `Choose ${left} more.` : 'All chosen.'} Tap a name to read it.</p>
      <div class="optlist">${list.map(({ o, why }) => `
        <div class="optrow ${why ? 'blocked' : ''}">
          <button type="button" class="optname" data-optread="${esc(o.id)}" aria-expanded="${st.open === o.id}">${esc(o.name)}${o.prereq ? ` <small>${esc(o.prereq)}</small>` : ''}</button>
          ${why ? `<span class="why">${esc(why)}</span>` : `<button class="btn small primary" type="button" data-optchoose="${esc(o.id)}" ${left > 0 ? '' : 'disabled'}>Choose</button>`}
          ${st.open === o.id ? `<div class="optdesc">${para(o.desc)}${o.note ? `<aside class="rulenote"><b>Table Rules</b>${para(o.note)}</aside>` : ''}</div>` : ''}
        </div>`).join('') || `<p class="empty">Nothing in the Library for ${esc(group)} yet.${isDm() ? ' Add them under Library, Class options.' : ' Ask your DM to add them.'}</p>`}</div>
      <div class="row end"><button class="btn primary" type="button" data-close>Done</button></div>`;
  };
  actDialog(draw, (e, paint) => {
    const r = e.target.closest('[data-optread]');
    if (r) { st.open = st.open === r.dataset.optread ? '' : r.dataset.optread; return paint(); }
    const ch = e.target.closest('[data-optchoose]');
    if (ch) {
      const o = L.get(ch.dataset.optchoose); if (!o || O.blockedBy(c, o)) return;
      c.options = [...(c.options || []), { id: o.id, group }];
      stamp(c, 'options'); save(c);
      toast(`Chose ${o.name}.`);
      const g = O.groupsFor(c).find(x => x.group === group);
      if (g && g.chosen.length >= g.count) $('#actDlg').close(); else paint();
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
      // 2024 Rage: one use comes back on a short rest
      if (R.F.is2024() && R.F.canRage(c) && Number(c.rage?.used) > 0) { c.rage = { ...c.rage, used: Number(c.rage.used) - 1 }; stamp(c, 'rage'); n++; }
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
    c.rage = { on: false, used: 0 };
    for (const p of ['classes', 'limited', 'death', 'exhaustion', 'magic', 'ip', 'rage']) stamp(c, p);
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
  liveFollow(c);
}
// Live link: while a sheet is open, everything the player sees arrives the moment it changes, and this sheet's
// own changes go out the same way. All of it lives under this character's own secret key (liveKey), which only
// this sheet's player and the DM know. Drive still carries everything a few seconds later as the saved copy;
// every change carries a time (and HP changes an id), so nothing is applied twice or overwrites newer work.
const HP_PATHS = new Set(['hpOps', 'hpBase', 'hp', 'hp.cur', 'hp.temp']);
const NOT_LIVE = new Set(['combat', 'combatReq', 'edits', 'updated']); // turns travel on their own path
// Fields that arrive from the DM's other apps on their own channels, or that are too big to send on every change
// (handwritten note pages, every beast a Wild Shaper can take): these stay on Drive's few-second path
const BIG_OR_CHANNEL = ['sn', 'magicItems', 'attuneMax', 'boons', 'conditions', 'wildBeasts', 'creatures', 'infusedHeld', 'inkPages'];
const notLive = path => HP_PATHS.has(path) || NOT_LIVE.has(path) || BIG_OR_CHANNEL.some(f => path === f || path.startsWith(f + '.'));
const follow = { id: '', key: '', stop: null, known: new Set(), pushed: {}, stats: '', chT: {} };
let liveRedraw = null;
function redrawSoon() { clearTimeout(liveRedraw); liveRedraw = setTimeout(() => { if (state.cur) renderSheet(); }, 120); }
function liveFollow(c) {
  const key = c?.liveKey || '';
  const id = key ? c.id : '';
  if (id === follow.id && key === follow.key) return;
  follow.stop?.();
  Object.assign(follow, { id, key, stop: null, known: new Set((c?.hpOps || []).map(o => o.id)), pushed: { ...(c?.edits || {}) }, stats: '', chT: {} });
  if (!id) return;
  sync.live().then(L => {
    if (!L || follow.id !== id || follow.key !== key) return;
    const cur = () => (state.cur?.id === id ? state.cur : null);
    // one entry at a time; an older core without that falls back to hearing the whole list
    const each = typeof L.cwatchEach === 'function' ? L.cwatchEach
      : (k, p, cb) => L.cwatch(k, p, all => Object.entries(all || {}).forEach(([n, v]) => cb(n, v)));
    const stops = [
      // where the fight stands for this character (combat tracker)
      L.cwatch(key, 'view', v => { setLiveView(id, v); if (cur()) refreshCombatBar($('#page'), cur()); }),
      // HP changes from the combat tracker (or this character's other devices)
      each(key, 'ops', (_, op) => {
        const c = cur(); if (!c || !op?.id) return;
        follow.known.add(op.id);
        if ((c.hpOps || []).some(o => o.id === op.id) || op.t <= (c.hpBase?.t || 0)) return;
        c.hpOps = [...(c.hpOps || []), op];
        replayHp(c); c.edits = c.edits || {}; c.edits.hpOps = Date.now(); c.updated = Date.now();
        db.put(c); liveStats(c); redrawSoon();
      }),
      // any other field of this sheet changed on another device (the player's or the DM's) or by the tracker
      each(key, 'sheet', (enc, rec) => {
        const c = cur(); if (!c || !rec) return;
        const le = c.edits || (c.edits = {});
        const path = L.decPath(enc), t = Number(rec.t) || 0;
        if (!t || notLive(path)) return;
        // a newer local change to this field (or a whole list/section it sits in) wins
        if (Object.keys(le).some(k => (path === k || path.startsWith(k + '.')) && le[k] >= t)) return;
        for (const k of Object.keys(le)) if (k.startsWith(path + '.')) delete le[k];
        setPath(c, path, rec.v === undefined ? null : structuredClone(rec.v));
        le[path] = t; follow.pushed[path] = t; c.updated = Math.max(c.updated || 0, t);
        db.put(c); liveStats(c); redrawSoon();
      }),
      // channels from the DM's other apps: Session Notes, Magic Items, boons, combat conditions, and later ones
      each(key, 'ch', (name, ch) => {
        const c = cur(); if (!c || !ch || (ch.t || 0) <= (follow.chT[name] || 0)) return;
        let fields = null;
        try { fields = typeof ch.json === 'string' ? JSON.parse(ch.json) : ch.fields; } catch { fields = ch.fields; }
        if (!fields) return;
        follow.chT[name] = ch.t;
        // each field carries the channel's time, so it and the Drive copy agree on which is newer
        const le = c.edits || (c.edits = {});
        let changed = 0;
        for (const [f, v] of Object.entries(fields)) {
          if ((le[f] || 0) > ch.t) continue; // the sheet already has something newer for this field
          if (JSON.stringify(c[f] ?? null) !== JSON.stringify(v ?? null)) { c[f] = v ?? null; changed++; }
          le[f] = ch.t;
        }
        if (changed) { db.put(c); redrawSoon(); }
      }),
    ];
    follow.stop = () => stops.forEach(s => s());
    liveStats(c);
    // clear out big fields an earlier version sent live, so they're never downloaded again
    for (const f of BIG_OR_CHANNEL) L.cput(key, `sheet/${L.encPath(f)}`, null);
  });
}
// This sheet's own changes go straight out: HP changes, every other field, and the numbers the tracker shows
function liveSendOps(c) {
  if (!follow.key || c?.id !== follow.id) return;
  sync.live().then(L => {
    if (!L || follow.key !== c.liveKey) return;
    for (const op of c.hpOps || []) {
      if (follow.known.has(op.id)) continue;
      follow.known.add(op.id);
      if (op.by === 'bestiary' || Date.now() - (op.t || 0) > 15000) continue; // the tracker sent its own
      L.cput(follow.key, `ops/${op.id}`, op);
    }
    for (const [path, t] of Object.entries(c.edits || {})) {
      if ((follow.pushed[path] || 0) >= t || notLive(path)) continue;
      follow.pushed[path] = t;
      const v = getPath(c, path);
      L.cput(follow.key, `sheet/${L.encPath(path)}`, { v: v === undefined ? null : v, t });
    }
    liveStats(c);
  });
}
function liveStats(c) {
  if (!follow.key || c?.id !== follow.id) return;
  let s;
  try {
    const f = c.hp?.form;
    s = { hp: f ? f.cur : Number(c.hp?.cur) || 0, temp: Number(c.hp?.temp) || 0, maxHp: f ? f.max : Number(c.hp?.max) || 0,
      ac: f && f.ac != null ? f.ac : R.armorClass(c).withTemp, passive: R.passivePerception(c), ip: c.ip || 'ready',
      exh: Number(c.exhaustion) || 0, form: f ? f.name : '' };
  } catch { return; }
  const k = JSON.stringify(s);
  if (k === follow.stats) return;
  follow.stats = k;
  sync.live().then(L => L?.cput(follow.key, 'stats', { ...s, t: Date.now() }));
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
  if (typing) { refreshFields($('#page'), state.cur); updateCalcs($('#page'), state.cur); } else renderSheet();
}
// Someone is typing: bring every other box up to date (HP from the Bestiary, a player's change) without redrawing the page
function refreshFields(root, c) {
  const active = document.activeElement;
  for (const el of root.querySelectorAll('[data-k]')) {
    if (el === active || !('value' in el)) continue;
    const v = getPath(c, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (String(el.value) !== String(v ?? '')) el.value = v ?? '';
  }
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
      ${player() && c.abilGen?.done ? `<div class="srow rorow"><span>Base score (${esc(METHOD_NAMES[c.abilGen.method] || 'set')})</span><b>${esc(ab.base)}</b></div>`
        : `<label class="hf"><span class="lbl">Base score (rolled or point-buy)</span><input class="f n" data-ab="base" inputmode="numeric" value="${esc(ab.base)}"></label>`}
      ${!player() || (c.abilGen && !c.abilGen.done) ? `<button class="linkbtn" type="button" data-scores>${c.abilGen && !c.abilGen.done ? 'Set all six scores (roll, array or point buy)' : 'Set all six scores with a method'}</button>` : ''}
      <span class="lbl">Increases and where they came from</span>
      <div class="adjlist">${(ab.adj || []).map((x, i) => lockedAdj(x) ? `
        <div class="srow rorow"><span>${esc(x.src)}${x.note ? ` · ${esc(x.note)}` : ''}</span><b>${R.sign(Number(x.v) || 0)}</b></div>` : `
        <div class="srow">
          <select class="f" data-adj="${i}" data-f="src" aria-label="Source">${(player() ? PLAYER_SRCS : ALL_SRCS).map(s => `<option ${x.src === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
          <input class="f" data-adj="${i}" data-f="note" value="${esc(x.note)}" placeholder="Detail (Level 4, Belt of…)" aria-label="Detail" autocomplete="off">
          <input class="f n" data-adj="${i}" data-f="v" inputmode="numeric" value="${esc(x.v)}" aria-label="Amount">
          <button class="x" type="button" data-adjdel="${i}" aria-label="Remove">×</button>
        </div>`).join('') || '<p class="empty">No increases yet.</p>'}</div>
      <button class="linkbtn" type="button" data-adjadd>Add an increase</button>
      ${(() => { const fx = [...R.fxFor(c, 'abil', a), ...R.fxFor(c, 'abilSet', a)]; return fx.length ? `<span class="lbl">From items, diseases and boons (applied automatically)</span>
      <div class="adjlist">${fx.map(e => `<div class="srow rorow"><span>${esc(e.src)}</span><b>${e.k === 'abilSet' ? `becomes ${esc(e.v)} if lower` : R.sign(Number(e.v) || 0)}</b></div>`).join('')}</div>` : ''; })()}`;
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
    if (e.target.closest('[data-scores]')) { dlg.close(); return openScores({ methods: true }); }
    if (e.target.closest('[data-adjadd]')) { c.abil[a].adj.push({ src: player() ? 'Training' : 'Racial', note: '', v: 1, id: uid() }); touch(); draw(); dlg.querySelector('.adjlist .srow:last-child input.n')?.focus(); }
    const del = e.target.closest('[data-adjdel]');
    if (del && !lockedAdj(c.abil[a].adj[Number(del.dataset.adjdel)])) { c.abil[a].adj.splice(Number(del.dataset.adjdel), 1); touch(); draw(); }
    if (e.target.closest('[data-close]')) dlg.close();
  };
  dlg.onclose = () => renderSheet();
  dlg.showModal();
}


/* ---------- ability scores for a new character: roll, standard array or point buy (whichever the table allows) ---------- */
const METHOD_NAMES = { roll: 'rolled', array: 'standard array', pointbuy: 'point buy' };
const ARRAY = [15, 14, 13, 12, 10, 8];
const PB_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }, PB_POINTS = 27;
const d6 = () => { const b = new Uint32Array(1); crypto.getRandomValues(b); return 1 + (b[0] % 6); };
// 4d6, the lowest die set aside
function rollScore() { const dice = [d6(), d6(), d6(), d6()]; const low = dice.indexOf(Math.min(...dice)); return { dice, low, total: dice.reduce((t, x, i) => t + (i === low ? 0 : x), 0) }; }
const allowedMethods = () => { const m = String(L.tableSettings().abilMethods || 'roll,array,pointbuy').split(',').filter(x => METHOD_NAMES[x]); return m.length ? m : ['roll', 'array', 'pointbuy']; };
// 2024: the background raises three abilities, +2 and +1 or +1 to each (never above 20)
export function bgIncrease(c) {
  if (L.edition() !== '2024') return null;
  const bg = L.get(c.bgId); return bg?.abilScores?.length ? bg : null;
}
export const bgIncreaseDone = c => Object.values(c.abil || {}).some(a => (a.adj || []).some(x => x.bg24));
function openScores({ methods = false } = {}) {
  const c = state.cur, ok = allowedMethods();
  const scoresSet = !!(c.abilGen ? c.abilGen.done : true);
  // the scores are already set: only the background's increases, unless the DM asked to set all six again
  const onlyBg = scoresSet && !(methods && isDm());
  c.abilGen = c.abilGen || { done: true };
  const keys = R.ABILS.map(([k]) => k);
  const bg = bgIncrease(c);
  const had = {}; for (const k of keys) for (const x of c.abil[k].adj || []) if (x.bg24) had[k] = Number(x.v) || 0;
  const hv = Object.entries(had);
  const st = { method: ok.includes(c.abilGen.method) ? c.abilGen.method : (c.abilGen.rolls && ok.includes('roll') ? 'roll' : ok[0]), pick: {}, pb: Object.fromEntries(keys.map(k => [k, 8])),
    bgMode: hv.length === 3 ? '111' : '21', two: hv.find(([, v]) => v === 2)?.[0] || '', one: hv.find(([, v]) => v === 1 && hv.length < 3)?.[0] || '' };
  const bgV = k => (!bg ? 0 : st.bgMode === '111' ? (bg.abilScores.includes(k) ? 1 : 0) : k === st.two ? 2 : k === st.one ? 1 : 0);
  const bgOk = () => !bg || st.bgMode === '111' || (st.two && st.one && st.two !== st.one);
  const adj = k => (c.abil[k].adj || []).filter(x => !x.bg24).reduce((t, x) => t + (Number(x.v) || 0), 0) + bgV(k);
  const pool = () => (st.method === 'roll' ? (c.abilGen.rolls || []).map(r => r.total) : st.method === 'array' ? ARRAY : []);
  const base = k => (st.method === 'pointbuy' ? st.pb[k] : st.pick[k] == null ? null : pool()[st.pick[k]]);
  const spent = () => keys.reduce((t, k) => t + PB_COST[st.pb[k]], 0);
  const complete = () => bgOk() && (onlyBg || (st.method === 'pointbuy' ? spent() <= PB_POINTS : pool().length === 6 && keys.every(k => st.pick[k] != null)));
  const cur = k => Number(c.abil[k].base) || 0;
  const draw = () => {
    const p = pool(), used = new Set(Object.values(st.pick));
    const rows = R.ABILS.map(([k, n]) => {
      const b = onlyBg ? cur(k) : base(k), a = adj(k), fin = b == null ? '—' : b + a;
      const ctrl = onlyBg ? `<b class="pbv">${b}</b>` : st.method === 'pointbuy'
        ? `<button class="step" type="button" data-pb="${k}" data-d="-1" ${st.pb[k] <= 8 ? 'disabled' : ''} aria-label="Lower ${n}">−</button><b class="pbv">${st.pb[k]}</b><button class="step" type="button" data-pb="${k}" data-d="1" ${st.pb[k] >= 15 || PB_COST[st.pb[k] + 1] - PB_COST[st.pb[k]] > PB_POINTS - spent() ? 'disabled' : ''} aria-label="Raise ${n}">+</button>`
        : `<select class="f" data-pick="${k}" aria-label="${n}" ${p.length ? '' : 'disabled'}><option value="">Choose</option>${p.map((v, i) => `<option value="${i}" ${st.pick[k] === i ? 'selected' : ''} ${used.has(i) && st.pick[k] !== i ? 'disabled' : ''}>${v}</option>`).join('')}</select>`;
      return `<div class="scrow"><span class="scn">${n}</span><span class="scc">${ctrl}</span><span class="sca">${a ? R.sign(a) : ''}</span><b class="scf">${fin}</b><small class="scm">${b == null ? '' : R.sign(R.mod(b + a))}</small></div>`;
    }).join('');
    const tabs = ok.length > 1 ? `<div class="seg" role="group" aria-label="Method">${ok.map(m => `<button type="button" data-m="${m}" aria-pressed="${st.method === m}">${m === 'roll' ? 'Roll' : m === 'array' ? 'Standard array' : 'Point buy'}</button>`).join('')}</div>` : `<p class="hint">Your table uses ${METHOD_NAMES[ok[0]] === 'rolled' ? 'rolling' : METHOD_NAMES[ok[0]]}.</p>`;
    const rolled = c.abilGen.rolls;
    const how = st.method === 'roll'
      ? (rolled ? `<div class="rolls">${rolled.map(r => `<span class="rollset"><b>${r.total}</b><small>${r.dice.map((x, i) => i === r.low ? `<s>${x}</s>` : x).join(' ')}</small></span>`).join('')}</div>
          <p class="hint">Rolled 4d6 six times, the lowest die set aside each time. Put each number on an ability.</p>${isDm() ? '<button class="linkbtn" type="button" data-reroll>Roll again (DM)</button>' : ''}`
        : `<p class="hint">Roll 4d6 six times; the lowest die of each roll is set aside. The rolls are kept on the sheet, so they count.</p><button class="btn primary" type="button" data-roll>Roll the dice</button>`)
      : st.method === 'array' ? '<p class="hint">Put each of 15, 14, 13, 12, 10 and 8 on an ability.</p>'
      : `<p class="hint">Every score starts at 8. Raising one costs points (14 costs 7, 15 costs 9); 15 is the highest you can buy.</p><p class="pbleft ${spent() > PB_POINTS ? 'over' : ''}"><b>${PB_POINTS - spent()}</b> of ${PB_POINTS} points left</p>`;
    const bgBox = bg ? `<div class="bgasi"><span class="lbl">${esc(bg.name)} background</span><p class="hint">${esc(bg.abilNote)}</p>
      <div class="seg" role="group" aria-label="How to raise them"><button type="button" data-bgm="21" aria-pressed="${st.bgMode === '21'}">+2 and +1</button><button type="button" data-bgm="111" aria-pressed="${st.bgMode === '111'}">+1 to all three</button></div>
      ${st.bgMode === '21' ? `<div class="row"><label class="mini">+2 to <select class="f" data-bg2><option value="">Choose</option>${bg.abilScores.map(a => `<option value="${a}" ${st.two === a ? 'selected' : ''}>${R.ABIL_SHORT[a]}</option>`).join('')}</select></label>
        <label class="mini">+1 to <select class="f" data-bg1><option value="">Choose</option>${bg.abilScores.filter(a => a !== st.two).map(a => `<option value="${a}" ${st.one === a ? 'selected' : ''}>${R.ABIL_SHORT[a]}</option>`).join('')}</select></label></div>` : ''}</div>` : '';
    return `<h2>${onlyBg ? 'Background increases' : 'Ability scores'}</h2>${onlyBg ? '' : tabs + how}${bgBox}
      <div class="scgrid"><div class="scrow head"><span></span><span>Base</span><span>${R.F.is2024() ? 'Bonus' : 'Race'}</span><span>Score</span><span></span></div>${rows}</div>
      <div class="row end"><button class="btn ghost" type="button" data-close>Later</button><button class="btn primary" type="button" data-apply ${complete() ? '' : 'disabled'}>Use these scores</button></div>`;
  };
  actDialog(draw, (e, paint) => {
    const m = e.target.closest('[data-m]'); if (m) { st.method = m.dataset.m; st.pick = {}; return paint(); }
    const bm = e.target.closest('[data-bgm]'); if (bm) { st.bgMode = bm.dataset.bgm; return paint(); }
    if (e.target.closest('[data-roll]') || e.target.closest('[data-reroll]')) {
      if (c.abilGen.rolls && !isDm()) return;
      c.abilGen = { ...c.abilGen, rolls: Array.from({ length: 6 }, rollScore), rolledAt: Date.now() }; st.pick = {};
      stamp(c, 'abilGen'); save(c); return paint(); // kept straight away, so closing the window doesn't undo a roll
    }
    const pb = e.target.closest('[data-pb]');
    if (pb) { const k = pb.dataset.pb, d = Number(pb.dataset.d), v = st.pb[k] + d; if (v >= 8 && v <= 15 && (d < 0 || spent() - PB_COST[st.pb[k]] + PB_COST[v] <= PB_POINTS)) st.pb[k] = v; return paint(); }
    if (e.target.closest('[data-apply]') && complete()) {
      for (const k of keys) {
        if (!onlyBg) c.abil[k].base = base(k);
        if (bg) {
          c.abil[k].adj = (c.abil[k].adj || []).filter(x => !x.bg24);
          const v = bgV(k); if (v) c.abil[k].adj.push({ id: uid(), src: 'Background', note: bg.name, v, bg24: true });
        }
        stamp(c, `abil.${k}`);
      }
      if (!onlyBg) c.abilGen = { ...c.abilGen, method: st.method, done: true, at: Date.now() };
      stamp(c, 'abilGen'); save(c); $('#actDlg').close(); toast('Ability scores set.');
    }
  }, (e, paint) => {
    const s = e.target.closest('[data-pick]'); if (s) { st.pick[s.dataset.pick] = s.value === '' ? null : Number(s.value); paint(); }
    if (e.target.matches('[data-bg2]')) { st.two = e.target.value; if (st.one === st.two) st.one = ''; paint(); }
    if (e.target.matches('[data-bg1]')) { st.one = e.target.value; paint(); }
  });
}

/* ---------- the equipment list: add gear to the inventory; armor sets AC when worn, weapons become attacks ---------- */
const EQ_CAT = { armor: 'armor', weapon: 'weapons', tool: 'tools', gear: 'general', mount: 'general' };
const EQ_KINDS = [['', 'Everything'], ['weapon', 'Weapons'], ['armor', 'Armor'], ['gear', 'Gear'], ['tool', 'Tools'], ['mount', 'Mounts and vehicles']];
function pickEquipment(cat) {
  const c = state.cur;
  const st = { q: '', kind: { armor: 'armor', weapons: 'weapon', tools: 'tool' }[cat] || '', added: [] };
  const list = () => L.all('item').filter(e => (!st.kind || e.cat === st.kind) && (!st.q || `${e.name} ${e.sub || ''}`.toLowerCase().includes(st.q.toLowerCase())));
  const draw = () => `<h2>Equipment</h2>
    <div class="row"><input class="f" data-eqq placeholder="Search: longsword, rope, chain mail…" value="${esc(st.q)}" autocomplete="off" style="flex:1"><select class="f" data-eqk>${EQ_KINDS.map(([k, n]) => `<option value="${k}" ${st.kind === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="eqlist">${list().slice(0, 150).map(e => `<button type="button" class="eqrow" data-eqadd="${esc(e.id)}"><b>${esc(e.name)}</b><small>${esc([e.sub, Number(e.wt) ? `${e.wt} lb` : '', e.cat === 'weapon' && e.weapon ? [e.weapon.dmg, e.weapon.type].filter(Boolean).join(' ') : '', e.cat === 'armor' && e.armor ? (e.armor.kind === 'shield' ? `+${e.armor.base} AC` : `AC ${e.armor.base}`) : ''].filter(Boolean).join(' · '))}</small></button>`).join('') || '<p class="empty">Nothing matches.</p>'}</div>
    ${st.added.length ? `<p class="hint">Added: ${st.added.map(esc).join(', ')}</p>` : ''}
    <div class="row end"><button class="btn primary" type="button" data-close>Done</button></div>`;
  const dlg = actDialog(draw, (e, paint) => {
    const b = e.target.closest('[data-eqadd]'); if (!b) return;
    const it = L.get(b.dataset.eqadd); if (!it) return;
    const where = EQ_CAT[it.cat] || 'general';
    const row = { id: uid(), name: it.name, wt: Number(it.wt) || 0, qty: 1, magic: false, desc: [it.cost ? `${it.cost}` : '', it.weapon?.props || ''].filter(Boolean).join(' · '), eqId: it.id };
    c.inv[where] = [...(c.inv[where] || []), row]; stamp(c, `inv.${where}`);
    if (it.cat === 'weapon') addWeaponAttack(c, it, row);
    save(c); st.added.push(it.name);
    const box = dlg.querySelector('.eqlist'), top = box?.scrollTop || 0; paint(); const nb = dlg.querySelector('.eqlist'); if (nb) nb.scrollTop = top;
    toast(it.cat === 'weapon' ? `${it.name} added, with an attack for it.` : it.cat === 'armor' ? `${it.name} added. Tap ${it.armor?.kind === 'shield' ? 'Use this shield' : 'Wear'} in your inventory to put it on.` : `${it.name} added.`);
  }, (e, paint) => {
    if (e.target.matches('[data-eqq]')) { st.q = e.target.value; const pos = e.target.selectionStart; paint(); const q = dlg.querySelector('[data-eqq]'); q.focus(); q.setSelectionRange(pos, pos); }
    if (e.target.matches('[data-eqk]') && e.type === 'change') { st.kind = e.target.value; paint(); }
  });
}
// Proficient with this weapon? Simple/Martial from the class, or named among other weapons ("longswords, rapiers")
function weaponProf(c, it) {
  const w = it.weapon || {};
  if (c.profs?.[w.kind]) return true;
  const other = String(c.profs?.weaponsOther || '').toLowerCase(), n = it.name.toLowerCase().replace(/,.*$/, '');
  return !!other && (other.includes(n) || other.includes(n.replace(/s$/, '')) || other.includes(`${n}s`));
}
function addWeaponAttack(c, it, row) {
  const w = it.weapon || {}, props = String(w.props || '').toLowerCase();
  const monk = R.F.classLevel(c, 'Monk') > 0 && w.monk; // Martial Arts: Dexterity works with monk weapons
  const abil = props.includes('finesse') || monk ? 'finesse' : w.ranged ? 'dex' : 'str';
  const notes = [w.props, w.range ? `range ${w.range} ft` : '', w.versatile ? `${w.versatile} two-handed` : ''].filter(Boolean).join(' · ');
  c.attacks = [...(c.attacks || []), { id: uid(), name: it.name, abil, prof: weaponProf(c, it), bonus: 0, dmg: w.dmg || '', addMod: !!w.dmg, type: w.type || '', notes, ranged: !!w.ranged, eqRow: row.id }];
  stamp(c, 'attacks');
}
// Magic weapons and armor: the base item's numbers from the equipment list, under the magic item's name
function useMagicGear(act, m) {
  const c = state.cur, base = L.findByName('item', m.base); if (!base) return;
  if (act === 'miattack') { addWeaponAttack(c, { ...base, name: m.name }, { id: '' }); c.attacks[c.attacks.length - 1].miCid = m.cid; delete c.attacks[c.attacks.length - 1].eqRow; stamp(c, 'attacks'); save(c); renderSheet(); toast(`${m.name} is in your attacks.`); return; }
  const a = c.ac, key = `mi:${m.cid}`;
  if (m.base === 'Shield') {
    if (a.shieldFrom === key && Number(a.shield)) { a.shield = 0; a.shieldFrom = ''; toast('Shield put away.'); }
    else { a.shield = Number(base.armor?.base) || 2; a.shieldFrom = key; a.shieldOff = false; toast(`Using ${m.name}.`); }
  } else if (a.armorFrom === key && a.mode !== 'unarmored') {
    Object.assign(a, { mode: 'unarmored', armorName: '', base: 10, maxDex: '', str: '', stealthDis: false, armorFrom: '' }); toast(`${m.name} taken off.`);
  } else {
    const x = base.armor || {}, mithral = /mithral/i.test(m.name); // mithral: no Strength requirement or Stealth disadvantage
    Object.assign(a, { mode: 'armor', armorName: m.name, base: Number(x.base) || 10, maxDex: x.dexCap === '' || x.dexCap == null ? '' : Number(x.dexCap), str: mithral ? '' : x.str || '', stealthDis: mithral ? false : !!x.stealthDis, armorFrom: key });
    toast(`Wearing ${m.name}.`);
  }
  stamp(c, 'ac'); save(c); renderSheet();
}
function useEquipment(act, row) {
  const c = state.cur, it = L.get(row.eqId); if (!it) return;
  const a = c.ac;
  if (act === 'eqattack') { addWeaponAttack(c, it, row); save(c); renderSheet(); toast(`${it.name} is in your attacks.`); return; }
  if (act === 'eqshield') {
    if (a.shieldFrom === row.id && Number(a.shield)) { a.shield = 0; a.shieldFrom = ''; toast('Shield put away.'); }
    else { a.shield = Number(it.armor?.base) || 2; a.shieldFrom = row.id; a.shieldOff = false; toast(c.profs?.shields ? `Using the ${it.name}.` : `Using the ${it.name}. You aren't proficient with shields: disadvantage on Strength and Dexterity checks, saves and attacks, and no spells.`); }
    stamp(c, 'ac'); save(c); renderSheet(); return;
  }
  if (act === 'eqwear') {
    if (a.armorFrom === row.id && a.mode !== 'unarmored') {
      Object.assign(a, { mode: 'unarmored', armorName: '', base: 10, maxDex: '', str: '', stealthDis: false, armorFrom: '' }); toast(`${it.name} taken off.`);
    } else {
      const x = it.armor || {};
      Object.assign(a, { mode: 'armor', armorName: it.name, base: Number(x.base) || 10, maxDex: x.dexCap === '' || x.dexCap == null ? '' : Number(x.dexCap), str: x.str || '', stealthDis: !!x.stealthDis, armorFrom: row.id });
      toast(c.profs?.[x.kind] ? `Wearing the ${it.name}.` : `Wearing the ${it.name}. You aren't proficient with ${x.kind} armor: disadvantage on Strength and Dexterity checks, saves and attacks, and no spells.`);
    }
    stamp(c, 'ac'); save(c); renderSheet();
  }
}
/* ---------- armor class ---------- */
// How the AC is worked out, in a few words ("Unarmored Defense (10 + Dex + Con) · includes +1 temp")
function acHow(c) {
  const ac = R.armorClass(c), t = Number(c.ac.temp) || 0;
  return [ac.how, ...(ac.feat || []).map(b => `${b.name} +${b.v}`), t ? `includes ${R.sign(t)} temp` : ''].filter(Boolean).map(esc).join(' · ');
}
function openAc() {
  const c = state.cur, a = c.ac, dlg = $('#acDlg');
  const draw = () => {
    dlg.querySelector('.body').innerHTML = `
      <h2>Armor class</h2>
      <div class="abilsum"><b>${R.armorClass(c).withTemp}</b><span>${acHow(c)}</span></div>
      <div class="seg" role="group" aria-label="Armor or unarmored">
        <button type="button" data-mode="armor" aria-pressed="${a.mode !== 'unarmored'}">Wearing armor</button>
        <button type="button" data-mode="unarmored" aria-pressed="${a.mode === 'unarmored'}">Unarmored</button>
      </div>
      ${a.mode === 'unarmored' ? `
        <p class="hint">10 + Dexterity. Unarmored Defense (Barbarian, Monk) and Draconic Resilience count on their own when they're among your features; only pick an ability below for something else that works the same way.</p>
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
  const sum = () => { dlg.querySelector('.abilsum').innerHTML = `<b>${R.armorClass(c).withTemp}</b><span>${acHow(c)}</span>`; };
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
  // your approved players at the table: tap one instead of typing their email
  let box = dlg.querySelector('.tplayers');
  if (!box) { box = document.createElement('div'); box.className = 'tplayers'; input.closest('label').before(box); }
  box.innerHTML = '<p class="hint">Looking up the players at your table…</p>';
  box.onclick = e => { const b = e.target.closest('[data-tp]'); if (!b) return; input.value = b.dataset.tp; box.querySelectorAll('[data-tp]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); };
  sync.tablePlayers().then(list => {
    box.innerHTML = list.length ? `<span class="lbl">Players at your table</span><div class="tpbtns">${list.map(p => `<button type="button" class="btn small" data-tp="${esc(p.email)}" aria-pressed="${input.value.toLowerCase() === p.email.toLowerCase()}">${esc(p.name || p.email)}<small>${esc(p.email)}</small></button>`).join('')}</div>`
      : '<p class="hint">No players have joined your table yet. Send them an invite link from the launcher, or type an email below.</p>';
  }).catch(err => { box.innerHTML = `<p class="hint">${esc(err.message)}</p>`; });
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
    ? (isDm() ? `Delete ${c.name || 'this character'}? Its Drive copy goes to your Drive's trash (you can restore it from there for 30 days), and it's removed from your other devices' sync. A player it was shared with keeps their own copy.` : `Delete ${c.name || 'this character'} from this device? The copy in Drive stays with your DM.`)
    : `Delete ${c.name || 'this character'}? This can't be undone. Use "Save a copy" first if you might want it back.`;
  if (!confirm(msg)) return;
  await db.del(id);
  if (linked && isDm()) {
    const ok = await sync.trashSheet(id);
    toast(ok ? `Deleted ${c.name || 'the character'}. Its Drive copy is in your Drive's trash.` : `Deleted ${c.name || 'the character'} here. Its Drive copy couldn't be moved to the trash right now; delete it from the Character Sheets folder in Drive.`);
  } else { await sync.forget(id); toast(`Deleted ${c.name || 'the character'}.`); }
  showHome();
}

/* ---------- settings dialog ---------- */
function renderTableRules() {
  const box = $('#tableRules'), t = L.tableSettings();
  if (isDm()) {
    box.innerHTML = `<div class="trrow"><span>Spellcasting</span><div class="seg" role="group" aria-label="Spellcasting"><button type="button" data-ts="spellMode" data-v="points" aria-pressed="${t.spellMode === 'points'}">Spell points</button><button type="button" data-ts="spellMode" data-v="slots" aria-pressed="${t.spellMode === 'slots'}">Spell slots</button></div></div>
      <div class="trrow"><span>Leveling</span><div class="seg" role="group" aria-label="Leveling"><button type="button" data-ts="leveling" data-v="xp" aria-pressed="${t.leveling === 'xp'}">Experience points</button><button type="button" data-ts="leveling" data-v="milestone" aria-pressed="${t.leveling === 'milestone'}">Milestone</button></div></div>
      <div class="trrow"><span>Initiative</span><div class="seg" role="group" aria-label="Initiative"><button type="button" data-ts="initiative" data-v="active" aria-pressed="${t.initiative === 'active'}">Active Initiative</button><button type="button" data-ts="initiative" data-v="standard" aria-pressed="${t.initiative === 'standard'}">Standard</button></div></div>
      <div class="trrow"><span>Rules</span><div class="seg" role="group" aria-label="Edition of the rules"><button type="button" data-ts="edition" data-v="2014" aria-pressed="${t.edition !== '2024'}">2014 (SRD 5.1)</button><button type="button" data-ts="edition" data-v="2024" aria-pressed="${t.edition === '2024'}">2024 (SRD 5.2)</button></div></div>
      <div class="trrow"><span>Ability scores</span><div class="seg" role="group" aria-label="Ways to set ability scores">${['roll', 'array', 'pointbuy'].map(m => `<button type="button" data-tsm="${m}" aria-pressed="${allowedMethods().includes(m)}">${m === 'roll' ? 'Rolling' : m === 'array' ? 'Standard array' : 'Point buy'}</button>`).join('')}</div></div>
      <p class="hint">These apply to every sheet at the table. Players get the change with the Table Library. Ability scores: pick every way new characters may use (at least one). Rules: the Library and the pickers show that edition's classes, species, backgrounds, feats, spells and equipment; sheets already made keep what they have.</p>`;
  } else {
    box.innerHTML = `<p>Your table plays the ${t.edition === '2024' ? '2024' : '2014'} rules. Your DM has set ${t.spellMode === 'points' ? 'spell points' : 'spell slots'}, ${t.initiative === 'active' ? 'Active Initiative' : 'standard initiative'} and ${t.leveling === 'milestone' ? 'milestone leveling' : 'experience points'}. New characters set ability scores by ${allowedMethods().map(m => ({ roll: 'rolling', array: 'the standard array', pointbuy: 'point buy' })[m]).join(' or ')}.</p>`;
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
  // Apps that have joined the suite link by permanent id on their own: show the link, nothing to choose
  const joined = { sn: (src.sn?.pcs || []).some(p => p.charId), mi: (src.mi?.state?.pcs || []).some(p => p.charId) };
  const sel = (c, app, list, cur) => joined[app] ? `<span class="hint">${cur ? 'Linked by ID' : 'Not in that app yet (it adds the current campaign\'s characters on its next sync)'}</span>` : `<select class="f" data-link="${app}" data-char="${c.id}"><option value="">${cur ? 'Match by name' : 'Match by name (none found)'}</option><option value="none" ${links[c.id]?.[app] === 'none' ? 'selected' : ''}>Not linked</option>${list.map(o => `<option value="${esc(o.id)}" ${links[c.id]?.[app] === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
  const su = sync.suiteStatus();
  box.innerHTML = `${src.error ? `<p class="warn">${esc(src.error)}</p>` : ''}
    <p class="hint">Suite core ${su.version ? `version ${su.version}` : 'not loaded'}${su.campaigns ? `: ${su.campaigns} campaign${su.campaigns === 1 ? '' : 's'}, current is ${esc(su.current || 'none')}.` : '.'}</p>
    ${su.note ? `<p class="warn">${esc(su.note)}</p>` : ''}
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
  levelUp, shortRest, longRest, openScores, pickEquipment, useEquipment, useMagicGear, cast: castSpell, spellFilter: 'mine', pickOption, addCreature, infuse: infuseDialog,
  // send a change right away (a turn button), once the save has landed
  syncSoon: () => setTimeout(async () => { await flush(); sync.syncNow({ quiet: true }); }, 300),
  liveSend: (key, req) => sync.live().then(L => L?.cput(key, 'req', req)),
};

async function start() {
  await loadSettings();
  await L.loadLibrary();
  R.F.useLibrary(L.get, L.edition); // class tables, option names and the edition, for features that change the numbers
  initSheet(sheetCtx);
  initLibrary($('#libview'), { toast, isDm: () => isDm(), libraryEdited: () => {}, chars: () => state.chars.map(c => ({ id: c.id, name: c.name })), magicItems: () => B.magicItemList() });
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

  // DM: the campaign view filter (this screen only) and each character's campaign tag
  $('#campBar').addEventListener('change', e => {
    if (e.target.id !== 'campView') return;
    state.settings.campView = e.target.value; saveSettings(); showHome();
  });
  $('#charList').addEventListener('change', async e => {
    const sel = e.target.closest('[data-camp]'); if (!sel) return;
    const c = await db.get(sel.dataset.camp); if (!c) return;
    c.campaignId = sel.value; stamp(c, 'campaignId'); await db.put(c);
    toast(sel.value ? `${c.name || 'Character'} moved to ${sel.selectedOptions[0].textContent}.` : `${c.name || 'Character'} has no campaign now.`);
    showHome(); sync.syncNow({ quiet: true });
  });
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
      state.settings.role = r.dataset.role; delete state.settings.autoRole; saveSettings();
      refreshRoleUi();
      if (r.dataset.role === 'dm' && !state.dmOk) toast(sync.currentEmail() ? 'Dungeon Master mode is for the DM of a table: create one in the launcher.' : 'Connect Google Drive with your DM account to turn on Dungeon Master mode.');
      if (state.cur) renderSheet();
      sync.renderStatus();
      renderTableRules();
      renderLinked();
      if (app.dataset.view === 'home') showHome();
      if (app.dataset.view === 'library') showLibrary();
    }
    const tsm = e.target.closest('[data-tsm]');
    if (tsm) {
      const cur = new Set(allowedMethods()), m = tsm.dataset.tsm;
      if (cur.has(m)) { if (cur.size === 1) { toast('Keep at least one way to set ability scores.'); return; } cur.delete(m); } else cur.add(m);
      L.setTableSetting('abilMethods', ['roll', 'array', 'pointbuy'].filter(x => cur.has(x)).join(',')).then(() => { renderTableRules(); sync.syncNow({ quiet: true }); });
    }
    const ts = e.target.closest('[data-ts]');
    if (e.target.closest('#linkSync')) { sync.syncNow({ interactive: true }).then(renderLinked); }
    if (ts) { L.setTableSetting(ts.dataset.ts, ts.dataset.v).then(() => { renderTableRules(); if (state.cur) renderSheet(); sync.syncNow({ quiet: true }); }); } // every app follows
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

  // Tab indents inside text boxes (Shift+Tab steps back) instead of jumping to the next field
  document.addEventListener('keydown', tabIndent);
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
