import { db } from './db.js';
import { newCharacter, upgrade, merge, stamp, uid } from './model.js';
import * as R from './rules.js';
import { initSheet, renderPage, bindSheet, updateCalcs, lookPanel, applyTheme, esc } from './sheet.js';
import { PRESETS } from './theme.js';
import * as sync from './sync.js';
import * as L from './library.js';
import { resolvePicks, syncAuto } from './autofill.js';
import { initLibrary, showLibrary, entryHtml } from './libui.js';

const $ = s => document.querySelector(s);
const app = $('#app');
const state = { chars: [], cur: null, page: 'sheet', settings: { role: 'player', red: false } };

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
  const dm = state.settings.role === 'dm';
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

/* ---------- the sheet view ---------- */
async function openCharacter(id) {
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
async function changedFromDrive() {
  if (app.dataset.view === 'home') return showHome();
  if (app.dataset.view === 'library') return;
  const fresh = await db.get(state.cur.id);
  if (!fresh) return;
  await flush();
  const res = merge(state.cur, fresh);
  state.cur = res.merged;
  if (!res.changed) return;
  const typing = document.activeElement?.closest?.('#page') && document.activeElement.matches('input,textarea,select');
  if (typing) updateCalcs($('#page'), state.cur); else renderSheet();
}

/* ---------- ability score breakdown ---------- */
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
      <div class="adjlist">${(ab.adj || []).map((x, i) => `
        <div class="srow">
          <select class="f" data-adj="${i}" data-f="src" aria-label="Source">${['Racial', 'ASI', 'Feat', 'Training', 'Magic item', 'Boon', 'Other'].map(s => `<option ${x.src === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
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
    if (e.target.closest('[data-adjadd]')) { c.abil[a].adj.push({ src: 'Racial', note: '', v: 1, id: uid() }); touch(); draw(); dlg.querySelector('.adjlist .srow:last-child input.n')?.focus(); }
    const del = e.target.closest('[data-adjdel]');
    if (del) { c.abil[a].adj.splice(Number(del.dataset.adjdel), 1); touch(); draw(); }
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
    ? `Delete ${c.name || 'this character'} from this device? ${state.settings.role === 'dm' ? 'The copy in your Drive folder stays; delete it there too if you want it gone.' : 'The copy in Drive stays with your DM.'}`
    : `Delete ${c.name || 'this character'}? This can't be undone. Use "Save a copy" first if you might want it back.`;
  if (!confirm(msg)) return;
  await db.del(id); await sync.forget(id);
  toast(`Deleted ${c.name || 'the character'}.`);
  showHome();
}

/* ---------- settings dialog ---------- */
function openSettings() {
  const dlg = $('#settingsDlg');
  for (const b of dlg.querySelectorAll('[data-role]')) b.setAttribute('aria-pressed', String(b.dataset.role === state.settings.role));
  sync.renderStatus();
  dlg.showModal();
}

/* ---------- wiring ---------- */
const sheetCtx = {
  save, toast, titleChanged, openNew: null,
  rerender: () => renderSheet(),
  themeChanged, closeLook, openAbility, openAc,
  picked, viewEntry,
};

async function start() {
  await loadSettings();
  await L.loadLibrary();
  initSheet(sheetCtx);
  initLibrary($('#libview'), { toast, isDm: () => state.settings.role === 'dm', libraryEdited: () => {} });
  $('#libBtn').addEventListener('click', () => openLibraryView());
  bindSheet($('#app'), () => state.cur);
  const tb = () => document.documentElement.style.setProperty('--tb', `${$('.topbar').offsetHeight}px`);
  tb(); window.addEventListener('resize', tb);

  $('#backBtn').addEventListener('click', () => { closeLook(); showHome(); });
  $('#newBtn').addEventListener('click', newChar);
  $('#newBtn2').addEventListener('click', newChar);
  $('#lookBtn').addEventListener('click', () => ($('#look').hidden ? openLook() : closeLook()));
  $('#redBtn').addEventListener('click', () => { state.settings.red = !state.settings.red; saveSettings(); applyRed(); });
  $('#settingsBtn').addEventListener('click', openSettings);
  for (const b of document.querySelectorAll('[data-page]')) b.addEventListener('click', () => { state.page = b.dataset.page; renderSheet(); $('#sheetwrap').scrollTop = 0; });

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
      for (const b of sd.querySelectorAll('[data-role]')) b.setAttribute('aria-pressed', String(b.dataset.role === state.settings.role));
      sync.renderStatus();
      if (app.dataset.view === 'home') showHome();
      if (app.dataset.view === 'library') showLibrary();
    }
    if (e.target.closest('#exportAll')) exportAll();
    if (e.target.closest('[data-close]')) sd.close();
  });
  $('#importFile').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; sd.close(); });
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target === d) d.close(); });

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#look').hidden && !document.querySelector('dialog[open]')) closeLook(); });
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  await sync.initSync({
    toast, choose,
    settings: () => state.settings,
    changedFromDrive,
    openCharacter,
  });
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
