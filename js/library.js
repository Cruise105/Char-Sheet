// The table library: SRD 5.1 entries built in, plus everything the DM types in.
// A typed entry with the same id as an SRD entry replaces it (that's how SRD entries get Table Rules notes).
import { db } from './db.js';
import { uid } from './model.js';

export const TYPES = [
  ['race', 'Races', 'Race'], ['class', 'Classes', 'Class'], ['subclass', 'Subclasses', 'Subclass'],
  ['background', 'Backgrounds', 'Background'], ['feat', 'Feats', 'Feat'], ['spell', 'Spells', 'Spell'], ['language', 'Languages', 'Language'],
];
export const typeName = t => (TYPES.find(x => x[0] === t) || [])[2] || t;

let srd = new Map();
// custom: { entries: {id: entry}, deleted: {id: time}, updated }
// settings: the table-wide switches the DM controls (synced to players with the library)
const DEFAULT_SETTINGS = { spellMode: 'points', initiative: 'active', leveling: 'xp', updated: 0 };
let custom = { entries: {}, deleted: {}, updated: 0, settings: { ...DEFAULT_SETTINGS } };
let merged = new Map();
const listeners = new Set();

export async function loadLibrary() {
  try {
    const r = await fetch('data/srd.json');
    const data = await r.json();
    srd = new Map(data.entries.map(e => [e.id, { ...e, builtIn: true }]));
  } catch { srd = new Map(); }
  const saved = await db.getMeta('library');
  if (saved) custom = { entries: {}, deleted: {}, updated: 0, ...saved, settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) } };
  rebuild();
}
function rebuild() {
  merged = new Map(srd);
  for (const [id, e] of Object.entries(custom.entries)) merged.set(id, { ...e, builtIn: false, overridesSrd: srd.has(id) });
  for (const l of listeners) l();
}
export const onLibraryChange = fn => listeners.add(fn);

export const get = id => merged.get(id) || null;
export function all(type) {
  return [...merged.values()].filter(e => !type || e.type === type).sort((a, b) => a.name.localeCompare(b.name));
}
// Races show subraces as "Hill Dwarf"; the picker label includes the parent so players can find them
export function label(e) {
  if (!e) return '';
  return e.name;
}
export function findByName(type, name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  return all(type).find(e => e.name.toLowerCase() === n) || null;
}
export const subclassesOf = classId => all('subclass').filter(s => s.parent === classId);
export const subracesOf = raceId => all('race').filter(r => r.parent === raceId);

/* ---------- editing (DM) ---------- */
async function persist() {
  custom.updated = Date.now();
  await db.setMeta('library', custom);
  rebuild();
}
export async function put(entry) {
  const e = { ...entry };
  delete e.builtIn; delete e.overridesSrd;
  if (!e.id) e.id = `lib:${e.type}:${uid()}`;
  e.updated = Date.now();
  custom.entries[e.id] = e;
  delete custom.deleted[e.id];
  await persist();
  return e.id;
}
export async function remove(id) {
  delete custom.entries[id];
  custom.deleted[id] = Date.now();
  await persist();
}
export function blank(type) {
  const base = { id: '', type, name: '', src: '', note: '', desc: '' };
  const armor = { light: false, medium: false, heavy: false, shields: false }, weapons = { simple: false, martial: false };
  switch (type) {
    case 'race': return { ...base, parent: '', speed: 30, size: 'Medium', vision: '', abil: [], abilNote: '', languages: '', langNote: '', skills: [], armor, weapons, weaponsOther: '', tools: '', resist: [], traits: [] };
    case 'class': return { ...base, hd: 8, saves: [], armor, weapons, weaponsOther: '', tools: '', skillChoice: '', spellAbil: '', caster: '', asi: [4, 8, 12, 16, 19], subclassLevel: 3, features: [] };
    case 'subclass': return { ...base, parent: '', flavor: '', caster: '', spellAbil: '', features: [] };
    case 'background': return { ...base, skills: [], tools: '', languages: '', feature: { name: '', text: '' }, feat: '', equipment: '' };
    case 'feat': return { ...base, prereq: '' };
    case 'language': return { ...base, kind: 'Standard', script: '', speakers: '' };
    case 'spell': return { ...base, level: 1, school: '', time: '1 action', range: '', components: 'V, S', material: '', duration: 'Instantaneous', conc: false, ritual: false, higher: '', classes: [], subclasses: [] };
  }
  return base;
}

/* ---------- sync support ---------- */
export const exportCustom = () => ({ app: 'charsheet-library', v: 1, ...structuredClone(custom) });
// Merge another copy (from Drive). Newer edits and deletions win, per entry.
export async function mergeCustom(remote) {
  if (remote?.app !== 'charsheet-library') return false;
  let changed = false;
  const ids = new Set([...Object.keys(remote.entries || {}), ...Object.keys(remote.deleted || {})]);
  for (const id of ids) {
    const re = remote.entries?.[id], rd = remote.deleted?.[id] || 0;
    const le = custom.entries[id], ld = custom.deleted[id] || 0;
    const rt = Math.max(re?.updated || 0, rd), lt = Math.max(le?.updated || 0, ld);
    if (rt <= lt) continue;
    if (re && (re.updated || 0) >= rd) { custom.entries[id] = re; delete custom.deleted[id]; }
    else { delete custom.entries[id]; custom.deleted[id] = rd; }
    changed = true;
  }
  if ((remote.settings?.updated || 0) > (custom.settings?.updated || 0)) { custom.settings = { ...DEFAULT_SETTINGS, ...remote.settings }; changed = true; }
  if (changed) { custom.updated = Math.max(custom.updated, remote.updated || 0); await db.setMeta('library', custom); rebuild(); }
  return changed;
}
// A player's copy is read-only: take the DM's file as it is
export async function replaceCustom(remote) {
  if (remote?.app !== 'charsheet-library') return false;
  custom = { entries: remote.entries || {}, deleted: remote.deleted || {}, updated: remote.updated || 0, settings: { ...DEFAULT_SETTINGS, ...(remote.settings || {}) } };
  await db.setMeta('library', custom);
  rebuild();
  return true;
}
export const tableSettings = () => ({ ...DEFAULT_SETTINGS, ...(custom.settings || {}) });
export async function setTableSetting(key, val) {
  custom.settings = { ...tableSettings(), [key]: val, updated: Date.now() };
  await persist();
}
export const customCount = () => Object.keys(custom.entries).length;
