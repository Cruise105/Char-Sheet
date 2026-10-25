// Artificer infusions: putting a known infusion into an item, and who holds it.
//
// An infusion the character knows is a Class option marked "Infusion". Replicate Magic Item plans are options too,
// each linked to an item from the magic item app (its text is copied onto the option when the DM links it).
// The artificer's sheet keeps c.infused = [{ id, optId, name, target, holder, at, desc, attune, item, weight }].
// holder is '' for the artificer; anyone else gets the item on their sheet through the DM's device (c.infusedHeld).
// Infused items never go to the magic item app: they only exist while the infusion lasts.
import * as L from './library.js';
import * as T from './tables.js';
import { uid } from './model.js';

export const known = c => (c.options || []).map(p => L.get(p.id)).filter(o => o?.infusion);
export function limit(c) {
  const n = parseInt(T.colValue(c, 'Infused Items'), 10);
  return Number.isFinite(n) ? n : null;
}
export const party = c => (L.tableSettings().party || []).filter(p => p.id !== c.id);
export const holderName = (c, id) => (!id || id === c.id ? 'You' : party(c).find(p => p.id === id)?.name || 'Someone in the party');

// What shows for an infused item, wherever it is
export function view(inf, by = '') {
  const it = inf.item;
  return {
    key: inf.key || inf.id,
    name: it ? it.name : `${inf.target || 'Item'} (${inf.name})`,
    infusion: inf.name, target: inf.target || '', by,
    type: it ? `${it.type ? `${it.type} · ` : ''}infused` : 'Infused item',
    attune: inf.attune || '', desc: it ? it.desc : inf.desc, extra: it && inf.desc && inf.desc !== it.desc ? inf.desc : '',
    weight: Number(inf.weight) || 0,
  };
}
// Infused items this sheet holds: its own (held by the artificer) and ones other artificers gave it
export function heldHere(c) {
  const mine = (c.infused || []).filter(i => !i.holder || i.holder === c.id).map(i => view(i));
  const others = (c.infusedHeld || []).map(i => view(i, i.by));
  return [...mine, ...others].map(v => ({ ...v, attuned: !!c.infAttuned?.[v.key] }));
}

// Put an infusion into an item. Returns { ok, ended, reason }
export function infuse(c, optId, target, holder) {
  const o = L.get(optId);
  if (!o?.infusion) return { ok: false, reason: 'That infusion is not in the Library.' };
  if ((c.infused || []).some(i => i.optId === optId)) return { ok: false, reason: `${o.name} is already in an item. End it first.` };
  const rec = {
    id: uid(), optId, name: o.name, target: (target || '').trim(), holder: holder && holder !== c.id ? holder : '', at: Date.now(),
    desc: T.fillAll(c, o.desc || ''), attune: o.itemSnap?.attune || (o.infAttune ? 'Requires attunement' : ''),
    item: o.itemSnap ? { ...o.itemSnap } : null, weight: Number(o.itemSnap?.weight) || 0,
  };
  const list = [...(c.infused || []), rec];
  let ended = null;
  const max = limit(c);
  if (max != null && list.length > max) {
    // over the limit: the oldest infusion ends
    list.sort((a, b) => a.at - b.at);
    ended = list.shift();
  }
  c.infused = list;
  return { ok: true, ended, rec };
}
