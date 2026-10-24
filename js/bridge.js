// The DM's device links the apps together.
//
// It reads Session Notes and the magic item app from your Google Drive (their private sync files),
// copies what each player should see onto their sheet, and writes a small party file
// (charsheet-party.json) that Session Notes and the Bestiary read for HP, AC and the sheet files.
import { db } from './db.js';
import * as L from './library.js';
import * as R from './rules.js';
import { stamp, hpOp } from './model.js';

const SN_FILE = 'session-notes-sync.json';
const MI_FILE = 'omnithel-items.json';
export const PARTY_FILE = 'charsheet-party.json';
const DAY = 1440, DAWN = 6 * 60;

// What the last read found, for the Linked apps settings
export const sources = { sn: null, mi: null, seed: null, read: 0, error: '' };

// The magic item app's item list lives in its own data.js on the same site
async function loadSeed() {
  if (sources.seed) return sources.seed;
  try {
    const r = await fetch('../magic-items/data.js', { cache: 'no-cache' });
    if (!r.ok) return null;
    const t = await r.text();
    const json = t.slice(t.indexOf('=') + 1).trim().replace(/;\s*$/, '');
    const seed = JSON.parse(json);
    sources.seed = new Map(seed.items.map(i => [i.id, i]));
    return sources.seed;
  } catch { return null; }
}

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
  const list = (st.inv || []).filter(x => x.holder === holder.id).map(x => {
    const i = get(x.itemId); if (!i) return null;
    const a = i.attune || {};
    // value deliberately left out: players shouldn't know what items are worth
    return {
      cid: x.cid, name: i.name, type: [i.type, i.rarity].filter(Boolean).join(', '),
      attune: a.mode === 'required' ? `Requires attunement${a.by ? ` ${a.by}` : ''}` : a.mode === 'optional' ? 'Attunement optional' : '',
      attuned: !!x.attuned, desc: i.desc || '', weight: weightLb(i.weight),
    };
  }).filter(Boolean);
  return { items: list, limit: Number(holder.limit) || 3 };
}

// Dawn counter from Session Notes' clock (minutes; dawn is 6:00)
const dawnIndex = mins => Math.floor((Number(mins) - DAWN) / DAY);
function campaignOf(sn, pc) {
  const list = (sn?.campaigns || []).filter(c => !c.deleted);
  return list.find(c => c.id === pc?.campaignId) || list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0] || null;
}

/* ---------- the pass ---------- */
// io: { readAppdata(name), writeAppdata(name, data), sheetFileId(charId), folderId }
export async function runBridge(io) {
  sources.error = '';
  try {
    const [sn, mi] = await Promise.all([io.readAppdata(SN_FILE), io.readAppdata(MI_FILE)]);
    sources.sn = sn?.app === 'session-notes' ? sn : null;
    sources.mi = mi?.app === 'omnithel-items' ? mi : null;
  } catch (e) {
    if (e.auth || e.scope) throw e;
    sources.error = e.message; return { changed: [] };
  }
  const seed = sources.mi ? await loadSeed() : null;
  sources.read = Date.now();
  const links = await getLinks();
  const boons = L.all('boon');
  const changed = [];
  for (const c of await db.all()) {
    let dirty = false;
    const put = (path, val) => {
      if (JSON.stringify(c[path] ?? null) === JSON.stringify(val ?? null)) return;
      c[path] = val; stamp(c, path); dirty = true;
    };
    const { sn: pc, mi: holder } = resolvedLinks(c, links);
    if (sources.sn) put('sn', snView(sources.sn, pc));
    if (sources.mi) {
      const v = miView(sources.mi, seed, holder);
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
