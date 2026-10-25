// The DM's device links the apps together.
//
// It reads Session Notes and the magic item app from your Google Drive (their private sync files),
// copies what each player should see onto their sheet, and writes a small party file
// (charsheet-party.json) that Session Notes and the Bestiary read for HP, AC and the sheet files.
import { db } from './db.js';
import * as L from './library.js';
import * as R from './rules.js';
import { stamp, hpOp } from './model.js';
import * as T from './tables.js';

const SN_FILE = 'session-notes-sync.json';
const MI_FILE = 'omnithel-items.json';
const BE_FILE = 'bestiary-sync.json';
export const PARTY_FILE = 'charsheet-party.json';
const DAY = 1440, DAWN = 6 * 60;

// What the last read found, for the Linked apps settings
export const sources = { sn: null, mi: null, seed: null, read: 0, error: '', miCounts: {}, miSaved: '', seedOk: null };

// The magic item app's item list lives in its own data.js on the same site
async function loadSeed() {
  if (sources.seed) return sources.seed;
  try {
    // GitHub Pages addresses follow the repository name's capitals (yours is Magic-Items); try both spellings
    let r = null;
    for (const path of ['../Magic-Items/data.js', '../magic-items/data.js']) {
      try { r = await fetch(path, { cache: 'no-cache' }); } catch { r = null; }
      if (r?.ok) break;
    }
    if (!r?.ok) { sources.seedOk = false; return null; }
    const t = await r.text();
    const json = t.slice(t.indexOf('=') + 1).trim().replace(/;\s*$/, '');
    const seed = JSON.parse(json);
    sources.seed = new Map(seed.items.map(i => [i.id, i]));
    sources.seedOk = true;
    return sources.seed;
  } catch { sources.seedOk = false; return null; }
}

// DM: every item the magic item app knows (its list plus your own items and edits), for linking Replicate Magic Item options
export async function magicItemList() {
  const seed = await loadSeed();
  const st = sources.mi?.state || {};
  const items = new Map();
  if (seed) for (const [id, i] of seed) items.set(id, i);
  for (const c of st.custom || []) items.set(c.id, c);
  return [...items.entries()].map(([id, i]) => {
    const e = st.edits?.[id]; const x = e ? { ...i, ...e } : i;
    return { id, ...itemSnapOf(x) };
  }).filter(x => x.name).sort((a, b) => a.name.localeCompare(b.name));
}
// What a sheet needs of an item (never its value)
export function itemSnapOf(i) {
  const a = i.attune || {};
  return {
    name: i.name, type: [i.type, i.rarity].filter(Boolean).join(', '),
    attune: a.mode === 'required' ? `Requires attunement${a.by ? ` ${a.by}` : ''}` : a.mode === 'optional' ? 'Attunement optional' : '',
    desc: i.desc || '', weight: weightLb(i.weight),
  };
}
export { loadSeed };

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
const firstWord = s => norm(s).split(' ')[0];
// Find the record in another app that is this character: an explicit link first, then the same name
function matchBy(list, linkId, name) {
  if (linkId === 'none') return null;
  if (linkId) return list.find(x => x.id === linkId) || null;
  const n = norm(name), f = firstWord(name);
  return list.find(x => norm(x.name) === n) || (f ? list.find(x => firstWord(x.name) === f) : null) || null;
}

function snLivePcs(sn) { return (sn?.pcs || []).filter(p => !p.deleted); }
export function linkOptions() {
  return {
    sn: snLivePcs(sources.sn).map(p => ({ id: p.id, name: p.name })),
    mi: (sources.mi?.state?.pcs || []).map(p => ({ id: p.id, name: p.name })),
  };
}
export async function getLinks() { return (await db.getMeta('links')) || {}; }
export async function setLink(charId, app, id) {
  const links = await getLinks();
  links[charId] = { ...(links[charId] || {}), [app]: id };
  await db.setMeta('links', links);
}
export function resolvedLinks(c, links) {
  const l = links[c.id] || {};
  const sn = matchBy(snLivePcs(sources.sn), l.sn, c.name);
  const mi = matchBy(sources.mi?.state?.pcs || [], l.mi, c.name);
  return { sn, mi };
}

/* ---------- what a sheet shows from each app ---------- */
function snView(sn, pc) {
  if (!pc) return null;
  const dis = new Map((sn.diseases || []).map(d => [d.id, d]));
  const cases = (sn.cases || []).filter(cs => cs.pcId === pc.id && !cs.deleted && cs.revealed && ['incubating', 'sick', 'declining'].includes(cs.state));
  const sv = pc.survival || {};
  return {
    pcId: pc.id,
    deaths: (pc.deaths || []).length,
    favorSpent: !!pc.favor?.spent,
    survival: sv.hunger != null ? { hunger: sv.hunger, thirst: sv.thirst, fatigue: sv.fatigue } : null,
    diseases: cases.map(cs => {
      const d = dis.get(cs.diseaseId) || {};
      const log = cs.log || [];
      return {
        id: cs.id, name: d.name || 'Disease', state: cs.state, stage: cs.stage || 0, dc: d.dc || null,
        effects: (d.stages || []).slice(0, Math.max(0, cs.stage || 0)),
        pass: log.filter(x => x.result === 'success').length, fail: log.filter(x => x.result === 'failure').length,
      };
    }),
  };
}
const weightLb = w => { const m = /([\d.]+)\s*lb/i.exec(String(w || '')); return m ? Number(m[1]) : 0; };
function miView(mi, seed, holder) {
  if (!holder) return null;
  const st = mi.state || {};
  const items = new Map();
  if (seed) for (const [id, i] of seed) items.set(id, i);
  for (const c of st.custom || []) items.set(c.id, c);
  const get = id => { const i = items.get(id); const e = st.edits?.[id]; return i ? (e ? { ...i, ...e } : i) : null; };
  const held = (st.inv || []).filter(x => x.holder === holder.id);
  const list = held.map(x => {
    const i = get(x.itemId); if (!i) return null;
    const a = i.attune || {};
    // value deliberately left out: players shouldn't know what items are worth
    return {
      cid: x.cid, name: i.name, type: [i.type, i.rarity].filter(Boolean).join(', '),
      attune: a.mode === 'required' ? `Requires attunement${a.by ? ` ${a.by}` : ''}` : a.mode === 'optional' ? 'Attunement optional' : '',
      attuned: !!x.attuned, desc: i.desc || '', weight: weightLb(i.weight),
    };
  }).filter(Boolean);
  return { items: list, limit: Number(holder.limit) || 3, held: held.length };
}

// Dawn counter from Session Notes' clock (minutes; dawn is 6:00)
const dawnIndex = mins => Math.floor((Number(mins) - DAWN) / DAY);
function campaignOf(sn, pc) {
  const list = (sn?.campaigns || []).filter(c => !c.deleted);
  return list.find(c => c.id === pc?.campaignId) || list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0] || null;
}

/* ---------- the Bestiary: stat blocks for Wild Shape, familiars, companions ---------- */
// Its built-in SRD monsters live in srd-monsters.json on the same site; yours (and SRD ones you edited) in its Drive sync file.
let srdMonsters = null;
async function loadSrdMonsters() {
  if (srdMonsters) return srdMonsters;
  for (const path of ['../Bestiary/srd-monsters.json', '../bestiary/srd-monsters.json']) {
    try { const r = await fetch(path, { cache: 'no-cache' }); if (r.ok) { srdMonsters = await r.json(); return srdMonsters; } } catch { /* try the other spelling */ }
  }
  return null;
}
export const bestiary = { list: null, byId: new Map(), ok: null, mine: 0 };
async function loadBestiary(io) {
  const [srd, be] = await Promise.all([loadSrdMonsters(), io.readAppdata(BE_FILE).catch(e => { if (e.auth) throw e; return null; })]);
  if (!srd && !be) { bestiary.ok = false; return bestiary; }
  const gone = new Set((be?.deletedSrd || []).map(d => d.id));
  const byId = new Map();
  for (const m of srd || []) if (!gone.has(m.id)) byId.set(m.id, m);
  const mine = be?.app === 'bestiary' ? (be.monsters || []) : [];
  for (const m of mine) if (m?.id && m.name && !m.deleted) byId.set(m.id, m);
  bestiary.byId = byId; bestiary.list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  bestiary.ok = true; bestiary.mine = mine.length;
  return bestiary;
}
export { loadBestiary };
export const crNum = cr => { const t = String(cr ?? '').trim(); if (t.includes('/')) { const [a, b] = t.split('/').map(Number); return b ? a / b : NaN; } return t === '' || t === '—' ? NaN : Number(t); };
// Just the stat block, without lore, pictures or the DM's notes
const SNAP_KEYS = ['id', 'name', 'size', 'type', 'subtype', 'alignment', 'ac', 'hp', 'hpFormula', 'speed', 'str', 'dex', 'con', 'int', 'wis', 'cha',
  'saves', 'skills', 'vulnerabilities', 'resistances', 'immunities', 'conditionImmunities', 'senses', 'languages', 'cr', 'pb',
  'traits', 'actions', 'bonusActions', 'reactions', 'source'];
export function snapOf(m) {
  const o = {};
  for (const k of SNAP_KEYS) if (m[k] !== undefined && m[k] !== '' && !(Array.isArray(m[k]) && !m[k].length)) o[k] = m[k];
  return o;
}
// The highest Wild Shape CR this character's classes ever reach, so a level up doesn't have to wait for your device
function wildCap(c) {
  let cap = NaN;
  for (const k of c.classes || []) for (const src of [L.get(k.clsId), L.get(k.subId)]) for (const col of src?.table || []) {
    if (!/wild shape max cr/i.test(col.name || '')) continue;
    for (const v of col.vals || []) { const n = crNum(v); if (Number.isFinite(n)) cap = Number.isFinite(cap) ? Math.max(cap, n) : n; }
  }
  return cap;
}
const isBeast = m => /^beast/i.test(String(m.type || '').trim());

/* ---------- the pass ---------- */
// io: { readAppdata(name), writeAppdata(name, data), sheetFileId(charId), folderId }
export async function runBridge(io) {
  sources.error = '';
  try {
    const [sn, mi] = await Promise.all([io.readAppdata(SN_FILE), io.readAppdata(MI_FILE)]);
    sources.sn = sn?.app === 'session-notes' ? sn : null;
    sources.mi = mi?.app === 'omnithel-items' ? mi : null;
    sources.miSaved = sources.mi?.stamp ? new Date(sources.mi.stamp).toLocaleString() : '';
  } catch (e) {
    if (e.auth || e.scope) throw e;
    sources.error = e.message; return { changed: [] };
  }
  const seed = sources.mi ? await loadSeed() : null;
  sources.read = Date.now();
  const links = await getLinks();
  const boons = L.all('boon');
  try { await loadBestiary(io); } catch (e) { if (e.auth) throw e; }
  const changed = [];
  const all = await db.all();
  // the party roster players see (names only), so an artificer can hand an infused item to someone
  const roster = all.filter(c => c.name).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(L.tableSettings().party || []) !== JSON.stringify(roster)) await L.setTableSetting('party', roster);
  // infused items held by someone other than the artificer who made them
  const heldBy = new Map();
  for (const x of all) for (const inf of x.infused || []) {
    if (!inf.holder || inf.holder === x.id) continue;
    if (!heldBy.has(inf.holder)) heldBy.set(inf.holder, []);
    heldBy.get(inf.holder).push({ ...inf, key: `${x.id}:${inf.id}`, by: x.name || 'an artificer', byId: x.id });
  }
  for (const c of all) {
    let dirty = false;
    const put = (path, val) => {
      if (JSON.stringify(c[path] ?? null) === JSON.stringify(val ?? null)) return;
      c[path] = val; stamp(c, path); dirty = true;
    };
    const { sn: pc, mi: holder } = resolvedLinks(c, links);
    if (sources.sn) put('sn', snView(sources.sn, pc));
    if (sources.mi) {
      const v = miView(sources.mi, seed, holder);
      sources.miCounts[c.id] = v ? { held: v.held, shown: v.items.length } : null;
      put('magicItems', v ? v.items : []);
      if (v && Number(c.attuneMax) !== v.limit) { c.attuneMax = v.limit; stamp(c, 'attuneMax'); dirty = true; }
    }
    // Boons the DM gave this character (or the whole party)
    const mine = boons.filter(b => b.given === 'party' || (Array.isArray(b.given) && b.given.includes(c.id)));
    put('boons', mine.map(b => ({ id: b.id, name: b.name, text: b.desc || '', dawnTemp: Number(b.dawnTemp) || 0 })));
    // Dawn effects: temp HP when Session Notes' clock passes dawn (never stacks: keeps the higher)
    const camp = campaignOf(sources.sn, pc);
    if (camp && camp.current != null) {
      const idx = dawnIndex(camp.current);
      c.boonDawn = c.boonDawn || {};
      for (const b of mine.filter(b => Number(b.dawnTemp) > 0)) {
        const last = c.boonDawn[b.id];
        if (last == null || idx < last) { c.boonDawn[b.id] = idx; stamp(c, 'boonDawn'); dirty = true; continue; }
        if (idx > last) {
          hpOp(c, { k: 'temp', n: Number(b.dawnTemp), by: `boon:${b.id}` });
          c.boonDawn[b.id] = idx; stamp(c, 'boonDawn'); dirty = true;
        }
      }
    }
    const held = heldBy.get(c.id) || [];
    if (held.length || (c.infusedHeld || []).length) put('infusedHeld', held);
    // Bestiary stat blocks: every beast a Wild Shaper could take, and fresh copies of the creatures you gave them
    if (bestiary.ok) {
      const cap = wildCap(c);
      const wild = Number.isFinite(cap) && cap > 0 ? bestiary.list.filter(m => isBeast(m) && crNum(m.cr) <= cap).map(snapOf) : [];
      if (wild.length || (c.wildBeasts || []).length) put('wildBeasts', wild);
      if ((c.creatures || []).length) {
        const next = c.creatures.map(x => { const m = bestiary.byId.get(x.monId); return m ? { ...x, snap: snapOf(m) } : x; });
        put('creatures', next);
      }
    }
    if (dirty) { await db.put(c); changed.push(c.name || 'a character'); }
  }
  return { changed };
}

// The party file other apps read: one line per character with the numbers they need
export async function writeParty(io) {
  const links = await getLinks();
  const chars = (await db.all()).map(c => {
    const { sn, mi } = resolvedLinks(c, links);
    return {
      id: c.id, fileId: io.sheetFileId(c.id) || '', name: c.name || '', player: c.player || '',
      level: R.totalLevel(c), classes: (c.classes || []).filter(k => k.name).map(k => `${k.name} ${k.level}`).join(' / '),
      race: c.race || '', maxHp: Number(c.hp?.max) || 0, hp: Number(c.hp?.cur) || 0, temp: Number(c.hp?.temp) || 0,
      ac: R.armorClass(c).withTemp, pp: R.passivePerception(c), ip: c.ip || 'ready', exhaustion: Number(c.exhaustion) || 0,
      snPcId: sn?.id || '', miPcId: mi?.id || '',
    };
  });
  await io.writeAppdata(PARTY_FILE, { app: 'charsheet-party', v: 1, updated: Date.now(), folderId: io.folderId || '', chars });
}
