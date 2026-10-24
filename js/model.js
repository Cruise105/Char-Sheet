// Character records: creation, field paths, edit stamps, and merging two copies of the same sheet.
//
// Every edit stamps its path with a time in c.edits. When two copies meet (this device and Drive),
// each path keeps whichever copy changed it last, so you and a player editing different parts
// of the same sheet never overwrite each other. A list (inventory rows, attacks) counts as one path.

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const ABIL = () => ({ base: 10, adj: [] });

export function newCharacter(name = '') {
  const now = Date.now();
  return {
    app: 'charsheet', v: 1, id: uid(), created: now, updated: now, edits: {},
    name, player: '', playerEmail: '', race: '', background: '', alignment: '', xp: '', nextLevel: '',
    classes: [{ name: '', sub: '', level: 1, hd: 8, hdUsed: 0 }],
    abil: { str: ABIL(), dex: ABIL(), con: ABIL(), int: ABIL(), wis: ABIL(), cha: ABIL() },
    saves: {}, skills: {}, jack: false, profOverride: '', inspiration: false,
    ac: { mode: 'armor', armorName: '', base: 10, maxDex: '', str: '', stealthDis: false, unarmoredAbil: '', shield: 0, misc: 0, temp: 0 },
    init: { misc: 0 },
    hp: { max: 0, cur: 0, temp: 0 },
    death: { s: 0, f: 0 }, exhaustion: 0, vision: '', speed: '30 ft',
    attacks: [], ammo: [],
    spell: { abil: '' }, abilityDc: { abil: '', label: '' },
    limited: [],
    bgFeature: { name: '', text: '' }, racial: [], classFeat: [], feats: [], extraFeat: [],
    profs: { light: false, medium: false, heavy: false, shields: false, simple: false, martial: false, weaponsOther: '', tools: '' },
    languages: '',
    consumables: [], attuned: [], attuneMax: 3,
    desc: { age: '', height: '', weight: '', eyes: '', skin: '', hair: '', appearance: '', portrait: '' },
    faction: { name: '', notes: '', symbol: '' },
    personality: '', ideals: '', bonds: '', flaws: '', enemies: '',
    inv: { armor: [], weapons: [], tools: [], treasure: [], components: [], general: [] },
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }, powerful: false,
    defenses: [],
    notes: '',
    theme: {
      preset: 'night', accent: '', head: 'alegreya', body: 'sans', frame: 'clean',
      bg: { img: '', fit: 'cover', blur: 0, dim: 35 }, panel: 88,
    },
  };
}

/* ---------- paths ---------- */
export function getPath(o, path) {
  return path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
}
export function setPath(o, path, val) {
  const ks = path.split('.');
  let x = o;
  for (let i = 0; i < ks.length - 1; i++) {
    const k = ks[i];
    if (x[k] == null || typeof x[k] !== 'object') x[k] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    x = x[k];
  }
  x[ks[ks.length - 1]] = val;
}

export function stamp(c, path) {
  const t = Date.now();
  c.edits = c.edits || {};
  // A list's path covers everything inside it; drop finer stamps it now covers
  for (const k of Object.keys(c.edits)) if (k.startsWith(path + '.')) delete c.edits[k];
  c.edits[path] = t;
  c.updated = t;
}

// Fill in anything an older or partial record is missing, without touching what's there
export function upgrade(c) {
  const base = newCharacter();
  (function fill(dst, src) {
    for (const k of Object.keys(src)) {
      if (dst[k] === undefined) dst[k] = structuredClone(src[k]);
      else if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k] && typeof dst[k] === 'object') fill(dst[k], src[k]);
    }
  })(c, base);
  return c;
}

/* ---------- merging two copies ---------- */
// Returns { merged, changed } where changed means the remote copy brought something new.
export function merge(local, remote) {
  if (!local) return { merged: upgrade(structuredClone(remote)), changed: true };
  const out = structuredClone(local);
  const le = local.edits || {}, re = remote.edits || {};
  let changed = false;
  const paths = Object.keys(re).sort((a, b) => a.length - b.length); // parents before children
  for (const p of paths) {
    const rt = re[p];
    // a newer stamp on a parent path in local beats this one
    const covered = Object.keys(le).some(k => (p === k || p.startsWith(k + '.')) && le[k] >= rt);
    if (covered) continue;
    setPath(out, p, structuredClone(getPath(remote, p)));
    for (const k of Object.keys(out.edits)) if (k.startsWith(p + '.')) delete out.edits[k];
    out.edits[p] = rt;
    changed = true;
  }
  out.updated = Math.max(local.updated || 0, remote.updated || 0);
  return { merged: upgrade(out), changed };
}

// A short fingerprint of a record, to tell whether it changed since the last upload
export function hashOf(data) {
  const s = JSON.stringify(data);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
