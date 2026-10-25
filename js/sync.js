// Google Drive sync for character sheets.
//
// The DM's device keeps every sheet in a "Character Sheets" folder in the DM's own Drive and shares
// each one with its player (edit access to that one file only). A player's device opens the sheet
// shared with them once, through Google's file picker, and from then on keeps it in step.
// The app only ever sees files it made or that someone picked for it, never the rest of anyone's Drive.
import { db } from './db.js';
import { merge, hashOf, upgrade } from './model.js';
import { CLIENT_ID, APP_ID, PICKER_API_KEY } from './config.js';
import { exportCustom, mergeCustom, replaceCustom } from './library.js';
import { runBridge, writeParty, loadBestiary } from './bridge.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
// The DM's device also reads Session Notes and the magic item app, which keep their files in the app's private Drive folder
const DM_SCOPE = `${SCOPE} https://www.googleapis.com/auth/drive.appdata`;
const scopeFor = () => (role() === 'dm' ? DM_SCOPE : SCOPE);
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_NAME = 'Character Sheets';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let ctx;
let syncing = false;
let status = 'off'; // off | ok | syncing | signin | offline | error
let lastError = '';
// links: character id -> { fileId, modified, hash }
const ss = { connected: false, email: '', folderId: '', links: {}, dropped: {}, lastSync: 0, lib: { fileId: '', modified: '', hash: '' } };
const LIB_NAME = 'Table Library (character sheet app).json';
const tok = { value: null, exp: 0 };
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ---------- helpers ---------- */
async function saveState() { await db.setMeta('sync', structuredClone(ss)); }
function saveToken() { try { localStorage.setItem('charsheet-token', JSON.stringify(tok)); } catch { /* memory only */ } }
function loadToken() { try { const t = JSON.parse(localStorage.getItem('charsheet-token') || 'null'); if (t && t.exp > Date.now()) Object.assign(tok, t); } catch { /* ignore */ } }
const tokenValid = () => tok.value && tok.exp > Date.now() + 30000 && (tok.scope || SCOPE) === scopeFor();
export const role = () => ctx?.settings().role || 'player';
export const linkOf = id => ss.links[id] || null;
export const currentEmail = () => ss.email || '';

function ago(t) {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
function loadScript(src, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't reach Google. Check your connection and try again."));
    document.head.append(s);
  });
}

/* ---------- sign-in ---------- */
async function signIn() {
  await loadScript('https://accounts.google.com/gsi/client', () => window.google?.accounts?.oauth2);
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: scopeFor(),
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        tok.value = r.access_token; tok.scope = scopeFor();
        tok.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        saveToken();
        resolve();
      },
      error_callback: e => reject(new Error(e?.type === 'popup_closed' ? 'Sign-in was closed before it finished.' : (e?.message || 'Sign-in failed.'))),
    });
    client.requestAccessToken({ prompt: ss.connected && !ss.needScope ? '' : 'consent' });
  });
}
async function ensureToken(interactive) {
  if (tokenValid()) return true;
  if (!interactive) { setStatus('signin'); return false; }
  await signIn();
  return true;
}

/* ---------- Drive calls ---------- */
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${tok.value}`, ...(opts.headers || {}) } });
  if (r.status === 401) { tok.value = null; saveToken(); const e = new Error('auth'); e.auth = true; throw e; }
  if (r.status === 403) {
    let j = null; try { j = await r.clone().json(); } catch { /* not json */ }
    if (JSON.stringify(j || '').includes('insufficient')) { tok.value = null; ss.needScope = true; saveToken(); const e = new Error('auth'); e.auth = true; e.scope = true; throw e; }
  }
  if (r.status === 404) { const e = new Error('missing'); e.missing = true; throw e; }
  if (!r.ok) {
    let msg = `Google Drive answered with an error (${r.status}).`;
    try { const j = await r.json(); if (j?.error?.message) msg = j.error.message; } catch { /* keep generic */ }
    throw new Error(msg);
  }
  return r;
}
const meta = async id => (await api(`${API}/files/${id}?fields=id,name,modifiedTime,trashed`)).json();
const download = async id => { const r = await api(`${API}/files/${id}?alt=media`); const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch { return null; } };

async function writeFile(data, { fileId, name, parent }) {
  const body = JSON.stringify(data);
  if (fileId) {
    const r = await api(`${UPLOAD}/${fileId}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    const res = await r.json();
    if (name) await api(`${API}/files/${fileId}?fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    return res;
  }
  const boundary = 'cs' + Math.random().toString(36).slice(2);
  const m = JSON.stringify({ name, mimeType: 'application/json', ...(parent ? { parents: [parent] } : {}) });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${m}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await api(`${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
  return r.json();
}
const fileName = c => `${(c.name || 'Unnamed character').replace(/[\\/]/g, '-')} (character sheet).json`;

/* ---------- DM: the shared folder ---------- */
async function ensureFolder() {
  if (ss.folderId) {
    try { const f = await meta(ss.folderId); if (!f.trashed) return ss.folderId; } catch (e) { if (e.auth) throw e; }
  }
  const q = encodeURIComponent(`mimeType='${FOLDER_MIME}' and name='${FOLDER_NAME}' and trashed=false`);
  const found = (await (await api(`${API}/files?q=${q}&fields=files(id)&pageSize=1`)).json()).files?.[0];
  if (found) ss.folderId = found.id;
  else {
    const r = await api(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }) });
    ss.folderId = (await r.json()).id;
  }
  await saveState();
  return ss.folderId;
}
async function listFolder() {
  const q = encodeURIComponent(`'${ss.folderId}' in parents and trashed=false`);
  const r = await api(`${API}/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=200`);
  return (await r.json()).files || [];
}

/* ---------- one sheet in step ---------- */
// Pull the Drive copy if it changed, merge, then push if this device has something newer.
async function syncOne(c, fileId, knownModified) {
  const link = ss.links[c.id] || (ss.links[c.id] = { fileId, modified: '', hash: '' });
  link.fileId = fileId;
  let changed = false;
  const mod = knownModified || (await meta(fileId)).modifiedTime;
  if (mod !== link.modified) {
    const remote = await download(fileId);
    if (remote?.app === 'charsheet' && remote.id === c.id) {
      const res = merge(c, remote);
      if (res.changed) { c = res.merged; await db.put(c); changed = true; }
    }
    link.modified = mod;
  }
  const h = hashOf(c);
  if (h !== link.hash) {
    const res = await writeFile(c, { fileId, name: link.name !== c.name ? fileName(c) : undefined });
    link.modified = res.modifiedTime; link.hash = h; link.name = c.name;
  }
  return { c, changed };
}

/* ---------- other apps' private files (DM) ---------- */
async function findAppdata(name) {
  ss.appdata = ss.appdata || {};
  if (ss.appdata[name]) return ss.appdata[name];
  const q = encodeURIComponent(`name='${name}'`);
  const f = (await (await api(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=1`)).json()).files?.[0];
  if (f) ss.appdata[name] = f.id;
  return f?.id || null;
}
// Other apps' files only download again when they've changed
const appCache = {};
async function readAppdata(name) {
  const id = await findAppdata(name);
  if (!id) return null;
  try {
    const m = await meta(id);
    if (appCache[name] && appCache[name].modified === m.modifiedTime) return appCache[name].data;
    const data = await download(id);
    appCache[name] = { modified: m.modifiedTime, data };
    return data;
  } catch (e) { if (e.missing) { delete ss.appdata[name]; delete appCache[name]; return null; } throw e; }
}
async function writeAppdata(name, data) {
  const h = hashOf({ ...data, updated: 0 });
  ss.appHash = ss.appHash || {};
  if (ss.appHash[name] === h) return;
  let id = await findAppdata(name);
  if (id) await writeFile(data, { fileId: id });
  else {
    const boundary = 'cs' + Math.random().toString(36).slice(2);
    const m = JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${m}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
    const r = await api(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    ss.appdata[name] = (await r.json()).id;
  }
  ss.appHash[name] = h;
}
const bridgeIO = () => ({ readAppdata, writeAppdata, sheetFileId: id => ss.links[id]?.fileId || '', folderId: ss.folderId });

/* ---------- the library file ---------- */
// DM: one file in the folder, merged both ways so your PC and tablet stay in step.
// Player: read-only copy of the DM's file.
async function syncLibrary(dm) {
  const lib = ss.lib || (ss.lib = { fileId: '', modified: '', hash: '' });
  let changed = false;
  if (dm && !lib.fileId) {
    const q = encodeURIComponent(`'${ss.folderId}' in parents and name='${LIB_NAME}' and trashed=false`);
    const found = (await (await api(`${API}/files?q=${q}&fields=files(id,modifiedTime)&pageSize=1`)).json()).files?.[0];
    if (found) lib.fileId = found.id;
    else {
      const data = exportCustom();
      const res = await writeFile(data, { name: LIB_NAME, parent: ss.folderId });
      Object.assign(lib, { fileId: res.id, modified: res.modifiedTime, hash: hashOf(data) });
      return false;
    }
  }
  if (!lib.fileId) return false;
  let m;
  try { m = await meta(lib.fileId); } catch (e) { if (e.missing) { lib.fileId = ''; return false; } throw e; }
  if (m.modifiedTime !== lib.modified) {
    const remote = await download(lib.fileId);
    changed = dm ? await mergeCustom(remote) : await replaceCustom(remote);
    lib.modified = m.modifiedTime;
    if (!dm) lib.hash = hashOf(remote);
  }
  if (dm) {
    const data = exportCustom(), h = hashOf(data);
    if (h !== lib.hash) { const res = await writeFile(data, { fileId: lib.fileId }); lib.modified = res.modifiedTime; lib.hash = h; }
  }
  return changed;
}

/* ---------- the sync pass ---------- */
export async function syncNow({ interactive = false, quiet = false } = {}) {
  if (!ss.connected && !interactive) return;
  if (syncing) return;
  if (!navigator.onLine) { setStatus('offline'); if (interactive) ctx.toast("You're offline. Changes will sync when you're back online."); return; }
  syncing = true;
  try {
    if (!(await ensureToken(interactive))) return;
    setStatus('syncing');
    if (!ss.email) {
      const me = await (await api(`${API}/about?fields=user(emailAddress)`)).json();
      ss.email = me.user?.emailAddress || '';
    }
    // only the DM's Google account can run Dungeon Master mode
    if (ctx.checkEmail) await ctx.checkEmail(ss.email);
    const names = [];
    if (role() === 'dm') {
      await ensureFolder();
      // pull in Session Notes and magic items first, so this pass uploads what changed
      try { const b = await runBridge(bridgeIO()); if (b.changed.length) names.push(...b.changed); ss.needScope = false; }
      catch (e) { if (e.auth) throw e; }
      const files = await listFolder();
      const byFile = new Map(Object.entries(ss.links).map(([cid, l]) => [l.fileId, cid]));
      for (const f of files) {
        if (f.name === LIB_NAME) continue;
        const cid = byFile.get(f.id);
        let local = cid ? await db.get(cid) : null;
        if (!local) {
          // A sheet in the folder this device hasn't seen yet
          const remote = await download(f.id);
          if (remote?.app !== 'charsheet' || ss.dropped?.[remote.id]) continue;
          const existing = await db.get(remote.id);
          local = existing || upgrade(remote);
          if (!existing) { await db.put(local); names.push(local.name || 'a character'); }
          ss.links[local.id] = { fileId: f.id, modified: '', hash: '' };
        }
        const { changed, c } = await syncOne(local, f.id, f.modifiedTime);
        if (changed) names.push(c.name || 'a character');
      }
      // sheets removed from the folder: keep this device's copy, just stop syncing it (and don't put it back)
      const live = new Set(files.map(f => f.id));
      ss.dropped = ss.dropped || {};
      for (const [cid, l] of Object.entries(ss.links)) if (!live.has(l.fileId)) { delete ss.links[cid]; ss.dropped[cid] = true; }
      // every other character on the DM's device goes in the folder, shared with a player or not
      for (const c of await db.all()) {
        if (ss.links[c.id] || ss.dropped[c.id]) continue;
        const res = await writeFile(c, { name: fileName(c), parent: ss.folderId });
        ss.links[c.id] = { fileId: res.id, modified: res.modifiedTime, hash: hashOf(c), name: c.name };
      }
      if (await syncLibrary(true)) names.push('the library');
      try { await writeParty(bridgeIO()); } catch (e) { if (e.auth) throw e; }
    } else {
      try { if (await syncLibrary(false)) names.push('the library'); } catch (e) { if (e.auth) throw e; }
      for (const [cid, l] of Object.entries(ss.links)) {
        const c = await db.get(cid);
        if (!c) { delete ss.links[cid]; continue; }
        try {
          const { changed } = await syncOne(c, l.fileId);
          if (changed) names.push(c.name || 'your character');
        } catch (e) {
          if (e.missing) { delete ss.links[cid]; ctx.toast(`${c.name || 'A character'} is no longer shared with you in Drive. This device keeps its copy.`); }
          else throw e;
        }
      }
    }
    const first = !ss.connected;
    ss.connected = true; ss.lastSync = Date.now();
    await saveState();
    setStatus('ok');
    if (names.length) ctx.changedFromDrive({ library: names.includes('the library') });
    if (first) { ctx.toast(role() === 'dm' ? 'Google Drive connected. Sheets now live in the "Character Sheets" folder in your Drive.' : 'Google Drive connected. Now tap "Open shared files" and pick your sheet and the Table Library.'); startAuto(); }
    else if (names.length && !quiet) ctx.toast(`Updated from Drive: ${[...new Set(names)].join(', ')}`);
    else if (interactive && !names.length) ctx.toast('Everything is in sync.');
  } catch (err) {
    if (err.auth) { setStatus('signin'); if (interactive || err.scope) ctx.toast(err.scope ? 'Sign in again so this device can also read Session Notes and the magic item app.' : 'Google sign-in expired. Tap Sign in to sync again.'); }
    else { lastError = err.message || String(err); setStatus('error'); if (interactive) ctx.toast(lastError); }
  } finally {
    syncing = false;
    renderStatus();
  }
}

/* ---------- DM: share a sheet with a player ---------- */
export async function shareWithPlayer(c, email) {
  email = (email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That doesn't look like an email address.");
  if (!navigator.onLine) throw new Error("You're offline. Sharing needs a connection.");
  await ensureToken(true);
  await ensureFolder();
  let link = ss.links[c.id];
  if (!link) {
    const res = await writeFile(c, { name: fileName(c), parent: ss.folderId });
    link = ss.links[c.id] = { fileId: res.id, modified: res.modifiedTime, hash: hashOf(c), name: c.name };
  }
  await api(`${API}/files/${link.fileId}/permissions?sendNotificationEmail=false&fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  });
  // the player can read the table library too
  try {
    await syncLibrary(true);
    if (ss.lib?.fileId) await api(`${API}/files/${ss.lib.fileId}/permissions?sendNotificationEmail=false&fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'reader', emailAddress: email }),
    });
  } catch (e) { if (e.auth) throw e; }
  ss.connected = true;
  await saveState();
  startAuto();
  renderStatus();
  return link.fileId;
}
// DM: put a character in the folder without sharing it yet (an NPC, or one you'll share later)
export async function addToFolder(c) {
  await ensureToken(true);
  await ensureFolder();
  if (ss.links[c.id]) return;
  const res = await writeFile(c, { name: fileName(c), parent: ss.folderId });
  ss.links[c.id] = { fileId: res.id, modified: res.modifiedTime, hash: hashOf(c), name: c.name };
  await saveState();
}
export async function sharedWith(c) {
  const l = ss.links[c.id];
  if (!l || !tokenValid()) return null;
  const r = await api(`${API}/files/${l.fileId}/permissions?fields=permissions(emailAddress,role)`);
  return ((await r.json()).permissions || []).filter(p => p.role === 'writer').map(p => p.emailAddress).filter(Boolean);
}

/* ---------- Player: open the sheet the DM shared ---------- */
async function pick() {
  if (!PICKER_API_KEY) throw new Error('The file picker needs its API key first. Your DM adds it once (README, "One-time Google setup").');
  await loadScript('https://apis.google.com/js/api.js', () => window.gapi);
  await new Promise(res => gapi.load('picker', res));
  return new Promise(resolve => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes('application/json').setIncludeFolders(false).setOwnedByMe(false);
    const p = new google.picker.PickerBuilder()
      .setTitle('Choose your character sheet and the Table Library')
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .addView(view)
      .setOAuthToken(tok.value).setDeveloperKey(PICKER_API_KEY).setAppId(APP_ID)
      .setCallback(d => {
        if (d.action === google.picker.Action.PICKED) resolve((d.docs || []).map(x => x.id));
        else if (d.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build();
    p.setVisible(true);
  });
}

// Opens a shared sheet. With `into`, the chosen Drive sheet and that local character become one.
export async function openShared(into = null) {
  if (!navigator.onLine) throw new Error("You're offline. Opening from Drive needs a connection.");
  await ensureToken(true);
  const ids = await pick();
  if (!ids?.length) return null;
  let fileId = null, remote = null, gotLib = false;
  for (const id of ids) {
    const data = await download(id);
    if (data?.app === 'charsheet-library') {
      ss.lib = { fileId: id, modified: '', hash: '' };
      await replaceCustom(data); gotLib = true;
    } else if (data?.app === 'charsheet' && !fileId) { fileId = id; remote = data; }
  }
  if (!fileId) {
    if (gotLib) { ss.connected = true; await saveState(); startAuto(); ctx.toast('Table Library connected.'); return null; }
    throw new Error("That file isn't a character sheet from this app.");
  }
  const already = Object.entries(ss.links).find(([, l]) => l.fileId === fileId);
  if (already && (!into || already[0] === into.id)) { await syncNow({ interactive: true }); return already[0]; }

  let c;
  if (into && remote.id !== into.id) {
    const keep = await ctx.choose(
      `Drive has a sheet named "${remote.name || 'Unnamed'}". Which version should both copies use from now on?`,
      [['local', `This device's "${into.name || 'Unnamed'}"`], ['drive', `The Drive sheet "${remote.name || 'Unnamed'}"`]]);
    if (!keep) return null;
    if (keep === 'local') {
      // the Drive file takes this device's sheet
      c = into;
      await writeFile(c, { fileId, name: fileName(c) });
    } else {
      c = upgrade(remote);
      await db.put(c);
    }
  } else {
    const local = await db.get(remote.id);
    c = merge(local, remote).merged;
    await db.put(c);
  }
  ss.links[c.id] = { fileId, modified: '', hash: '' };
  ss.connected = true;
  await saveState();
  if (!gotLib && !ss.lib?.fileId && role() !== 'dm') setTimeout(() => ctx.toast('Your sheet is linked. Also open the Table Library (Settings, Open shared files) so your DM\'s rules and Library reach this device.'), 1500);
  await syncNow({ quiet: true });
  startAuto();
  return c.id;
}

export async function connect() { await syncNow({ interactive: true }); }
export const isConnected = () => ss.connected;

async function disconnect() {
  if (tok.value && window.google?.accounts?.oauth2) { try { google.accounts.oauth2.revoke(tok.value, () => {}); } catch { /* ignore */ } }
  tok.value = null; tok.exp = 0; saveToken();
  Object.assign(ss, { connected: false, email: '', folderId: '', links: {}, dropped: {}, lastSync: 0, lib: { fileId: '', modified: '', hash: '' } });
  await saveState();
  setStatus('off');
  ctx.toast('Disconnected. Characters on this device are untouched, and the copies in Drive stay there.');
}
// DM deleting a character: its Drive copy goes to Drive's trash (recoverable there for 30 days),
// so it doesn't come back on the next sync or linger on the DM's other devices
export async function trashSheet(id) {
  const l = ss.links[id];
  ss.dropped = ss.dropped || {}; ss.dropped[id] = true;
  delete ss.links[id]; await saveState();
  if (!l?.fileId) return true;
  try {
    if (!navigator.onLine || !(await ensureToken(true))) return false;
    await api(`${API}/files/${l.fileId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    return true;
  } catch { return false; }
}
// DM: the Bestiary's monsters, for adding a creature to a sheet
export async function bestiaryMonsters() {
  if (!navigator.onLine) return null;
  if (!(await ensureToken(true))) return null;
  const b = await loadBestiary(bridgeIO());
  return b.ok ? b.list : null;
}
export async function forget(id) { if (ss.links[id]) { delete ss.links[id]; await saveState(); } }

/* ---------- status ---------- */
function setStatus(s) { status = s; renderStatus(); }
export function renderStatus() {
  const btn = $('#syncBtn');
  if (btn) {
    btn.hidden = !ss.connected && status !== 'syncing';
    btn.dataset.state = status;
    const label = { ok: `Synced ${ago(ss.lastSync)}. Tap to sync now.`, syncing: 'Syncing…', signin: 'Sign in to sync', offline: 'Offline. Will sync when back online.', error: `Sync problem: ${lastError}`, off: 'Sync' }[status];
    btn.title = label; btn.setAttribute('aria-label', label);
  }
  const box = $('#syncInfo');
  if (!box) return;
  const dm = role() === 'dm';
  if (!ss.connected) {
    box.innerHTML = `<p>${dm
      ? 'Connect your Google Drive to keep every sheet in a "Character Sheets" folder in your Drive and share each one with its player.'
      : 'Connect Google Drive, then open the files your DM shared with you: your character sheet and the Table Library. Only those files are visible to the app, not the rest of your Drive.'}</p>
      <div class="row"><button class="btn primary" type="button" data-sync="connect">${status === 'syncing' ? 'Connecting…' : 'Connect Google Drive'}</button></div>`;
    return;
  }
  const line = { ok: `Last synced ${ago(ss.lastSync)}.`, syncing: 'Syncing now…', signin: 'Google needs you to sign in again before the next sync.', offline: "You're offline. Changes will sync when you're back online.", error: `The last sync didn't finish: ${lastError}` }[status] || `Last synced ${ago(ss.lastSync)}.`;
  const libLine = dm ? '' : (ss.lib?.fileId ? ' Table Library: connected.' : ' <b>Table Library: not connected.</b> Tap "Open shared files" and pick it, so your DM\'s rules and Library reach this device.');
  box.innerHTML = `<p>${ss.email ? `Signed in as ${esc(ss.email)}. ` : ''}${line}${libLine}</p>
    <div class="row">
      <button class="btn primary" type="button" data-sync="now">${status === 'signin' ? 'Sign in and sync' : 'Sync now'}</button>
      ${dm ? '' : '<button class="btn" type="button" data-sync="open">Open shared files</button>'}
      <button class="btn" type="button" data-sync="disconnect">Disconnect</button>
    </div>`;
}

/* ---------- start-up + triggers ---------- */
export async function initSync(helpers) {
  ctx = helpers;
  const saved = await db.getMeta('sync');
  if (saved) Object.assign(ss, saved);
  loadToken();
  status = ss.connected ? (tokenValid() ? 'ok' : 'signin') : 'off';
  renderStatus();
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-sync]');
    if (e.target.closest('#syncBtn')) return syncNow({ interactive: true });
    if (!b) return;
    const k = b.dataset.sync;
    if (k === 'connect' || k === 'now') syncNow({ interactive: true });
    if (k === 'disconnect') disconnect();
    if (k === 'open') { try { const id = await openShared(); if (id) ctx.openCharacter(id); } catch (err) { ctx.toast(err.message); } }
  });
  if (!ss.connected) return;
  syncNow({ quiet: true });
  startAuto();
}

let autoStarted = false;
function startAuto() {
  if (autoStarted) return;
  autoStarted = true;
  // Push a few seconds after edits settle; look for others' changes every 5 seconds (10 on the DM's device),
  // so HP from the Bestiary or a player shows up within a few seconds
  let last = '', ticks = 0;
  setInterval(async () => {
    if (!ss.connected || syncing || !navigator.onLine || !tokenValid()) { renderStatus(); return; }
    ticks++;
    const chars = await db.all();
    const h = hashOf([chars.filter(c => ss.links[c.id]).map(c => c.updated), role() === 'dm' ? exportCustom().updated : 0]);
    const dirty = chars.some(c => ss.links[c.id] && ss.links[c.id].hash !== hashOf(c)) || (role() === 'dm' && ss.lib?.fileId && ss.lib.hash !== hashOf(exportCustom()));
    if (document.visibilityState === 'visible' && ((dirty && h === last) || ticks % (role() === 'dm' ? 2 : 1) === 0)) syncNow({ quiet: true });
    else if (dirty && h === last) syncNow({ quiet: true });
    last = h;
    renderStatus();
  }, 5000);
  document.addEventListener('visibilitychange', () => syncNow({ quiet: document.visibilityState === 'hidden' }));
  window.addEventListener('online', () => syncNow({ quiet: true }));
  window.addEventListener('offline', () => setStatus('offline'));
}
