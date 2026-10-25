// Creatures: Wild Shape beasts, other forms (Polymorph…) and companions (Homunculus Servant, Eldritch Cannon, familiars…).
//
// Stat blocks come from the DM's Bestiary. The DM's device copies them onto the sheet when it syncs:
//   c.wildBeasts  every beast a Wild Shaper could ever take (filtered here by their current level)
//   c.creatures   [{ id, kind: 'companion' | 'form', monId, name, snap, ov: { hp, ac } }]  added by the DM
// A companion's own HP and whether it's out: c.compHp[id] = { cur, temp, out }.
// Being in a form is part of the HP log (see model.js), so the Bestiary and every device agree on it.
import * as T from './tables.js';
import * as R from './rules.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = t => esc(t || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
export const crNum = cr => { const t = String(cr ?? '').trim(); if (t.includes('/')) { const [a, b] = t.split('/').map(Number); return b ? a / b : NaN; } return t === '' || t === '—' ? NaN : Number(t); };
const ABL = [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']];

/* ---------- numbers ---------- */
export function maxHpOf(c, x) {
  const f = T.evalFormula(c, x.ov?.hp);
  return f != null ? Math.max(1, f) : Math.max(1, Number(x.snap?.hp) || 1);
}
export function acOf(c, x) {
  const f = T.evalFormula(c, x.ov?.ac);
  return f != null ? String(f) : String(x.snap?.ac ?? '—');
}
export const acNum = s => parseInt(String(s), 10) || null;
export function compState(c, x) {
  const s = c.compHp?.[x.id] || {};
  const max = maxHpOf(c, x);
  return { max, cur: s.cur == null ? max : Math.max(0, Math.min(max, Number(s.cur) || 0)), temp: Math.max(0, Number(s.temp) || 0), out: !!s.out };
}

/* ---------- Wild Shape ---------- */
// What this character can turn into right now: CR and movement limits from their class table
export function wildRules(c) {
  const capText = T.colValue(c, 'Wild Shape Max CR');
  const cap = crNum(capText);
  const lim = T.colValue(c, 'Wild Shape Limitations');
  return { has: Number.isFinite(cap) && cap > 0, cap, capText, noFly: /fly/i.test(lim), noSwim: /swim/i.test(lim), lim };
}
export function wildChoices(c) {
  const w = wildRules(c);
  if (!w.has) return [];
  return (c.wildBeasts || []).filter(m => {
    if (!(crNum(m.cr) <= w.cap)) return false;
    const sp = String(m.speed || '');
    if (w.noFly && /\bfly\b/i.test(sp)) return false;
    if (w.noSwim && /\bswim\b/i.test(sp)) return false;
    return true;
  });
}
export const wildUses = c => (c.limited || []).findIndex(f => /wild\s*shape/i.test(f.name || ''));

/* ---------- a stat block ---------- */
export function statBlock(c, m, ov = {}) {
  if (!m) return '<p class="empty">No stat block.</p>';
  const fill = t => fmt(T.fillAll(c, t));
  const line = (k, v) => (v ? `<p><b>${k}</b> ${esc(T.fillAll(c, String(v)))}</p>` : '');
  const hpF = T.evalFormula(c, ov.hp), acF = T.evalFormula(c, ov.ac);
  const list = (title, items) => (items?.length ? `${title ? `<h5>${title}</h5>` : ''}${items.map(a => `<div class="sbitem"><b><i>${esc(a.name)}.</i></b> ${fill(a.desc || a.text || '')}</div>`).join('')}` : '');
  return `<div class="statblock">
    <p class="sbtype">${esc([m.size, [m.type, m.subtype ? `(${m.subtype})` : ''].filter(Boolean).join(' '), m.alignment].filter(Boolean).join(' '))}</p>
    <div class="sbcore">
      <p><b>Armor Class</b> ${esc(acF != null ? acF : m.ac ?? '—')}</p>
      <p><b>Hit Points</b> ${esc(hpF != null ? hpF : m.hp ?? '—')}${hpF == null && m.hpFormula ? ` (${esc(m.hpFormula)})` : ''}</p>
      <p><b>Speed</b> ${esc(m.speed || '—')}</p>
    </div>
    <div class="sbabil">${ABL.map(([k, n]) => { const v = Number(m[k]); return `<div><small>${n}</small><b>${Number.isFinite(v) ? v : '—'}</b><span>${Number.isFinite(v) ? R.sign(R.mod(v)) : ''}</span></div>`; }).join('')}</div>
    <div class="sbcore">
      ${line('Saving Throws', m.saves)}${line('Skills', m.skills)}${line('Damage Vulnerabilities', m.vulnerabilities)}${line('Damage Resistances', m.resistances)}
      ${line('Damage Immunities', m.immunities)}${line('Condition Immunities', m.conditionImmunities)}${line('Senses', m.senses)}${line('Languages', m.languages)}
      ${m.cr != null && m.cr !== '' ? `<p><b>Challenge</b> ${esc(m.cr)}</p>` : ''}
    </div>
    ${list('', m.traits)}${list('Actions', m.actions)}${list('Bonus Actions', m.bonusActions)}${list('Reactions', m.reactions)}
  </div>`;
}

/* ---------- the page ---------- */
const st = { q: '', open: '' };
export const setQuery = q => { st.q = q; };

function formBanner(c) {
  const f = c.hp?.form;
  if (f) return `<div class="formbar"><span class="lbl">In a form</span><b>${esc(f.name)}</b>
    <span class="fhp">HP <b>${f.cur}</b>/${f.max}${f.ac != null ? ` · AC ${esc(f.ac)}` : ''}</span>
    <button class="btn small" type="button" data-act="crevert">Revert</button></div>`;
  const e = c.hp?.formEnded;
  if (e && !e.chose && Date.now() - e.t < 6 * 3600e3) return `<div class="formbar ended">Dropped out of ${esc(e.name)} form at 0 HP${e.over ? `. ${e.over} damage carried over to you.` : '.'}</div>`;
  return '';
}
export const formBannerHtml = formBanner;

export function pageCreatures(c, { isPlayer, panel }) {
  const w = wildRules(c);
  const parts = [];
  const fb = formBanner(c);
  const active = c.hp?.form;
  if (fb) parts.push(`<section class="panel formpanel">${fb}${active ? (() => {
    const m = (c.wildBeasts || []).find(b => b.id === active.cid) || (c.creatures || []).find(x => x.id === active.cid || x.monId === active.cid)?.snap;
    const x = (c.creatures || []).find(y => y.id === active.cid);
    return m ? `<details class="sbwrap" open><summary>${esc(active.name)} stat block</summary>${statBlock(c, m, x?.ov)}</details>` : '';
  })() : ''}</section>`);

  // Wild Shape
  if (w.has || (c.wildBeasts || []).length) {
    const ui = wildUses(c), uses = ui >= 0 ? c.limited[ui] : null;
    const favs = new Set(c.wildFav || []);
    const all = wildChoices(c);
    const q = st.q.trim().toLowerCase();
    const shown = all.filter(m => !q || m.name.toLowerCase().includes(q)).sort((a, b) => (favs.has(b.id) - favs.has(a.id)) || crNum(b.cr) - crNum(a.cr) || a.name.localeCompare(b.name));
    parts.push(panel('Wild Shape', `
      <p class="hint">${w.has ? `Beasts up to CR ${esc(w.capText)}${w.noFly && w.noSwim ? ', no flying or swimming speed' : w.noFly ? ', no flying speed' : ''}.` : 'Not available at your level yet.'}
        ${uses ? ` Uses left: <b>${esc(uses.left)}</b> of ${esc(uses.total)}.` : ''}</p>
      ${w.has ? `<input class="f" type="search" data-wsq value="${esc(st.q)}" placeholder="Search ${all.length} beasts" aria-label="Search beasts" autocomplete="off">` : ''}
      <div class="crlist" id="wsList">${w.has ? wildRows(c, shown, favs) : ''}</div>
      ${w.has && !all.length ? `<p class="empty">No beasts yet. ${isPlayer() ? "They arrive when your DM's device syncs." : 'They come from your Bestiary the next time this device syncs.'}</p>` : ''}`, 'crpanel'));
  }

  // Companions and other forms the DM gave this character
  const list = c.creatures || [];
  const comps = list.filter(x => x.kind !== 'form'), forms = list.filter(x => x.kind === 'form');
  if (comps.length || !isPlayer()) parts.push(panel('Companions', (comps.map(x => companionCard(c, x, isPlayer())).join('') || '<p class="empty">Homunculus Servant, Eldritch Cannon, Steel Defender, familiars, a ranger\'s beast…</p>')
    + (isPlayer() ? '' : '<button class="linkbtn" type="button" data-act="cadd" data-kind="companion">Add a companion from the Bestiary</button>'), 'crpanel'));
  if (forms.length || !isPlayer()) parts.push(panel('Other forms', (forms.map(x => formCard(c, x, isPlayer())).join('') || '<p class="empty">Polymorph, Shapechange, a lycanthrope form…</p>')
    + (isPlayer() ? '' : '<button class="linkbtn" type="button" data-act="cadd" data-kind="form">Add a form from the Bestiary</button>'), 'crpanel'));

  if (!parts.length) parts.push(panel('Creatures', `<p class="empty">Nothing here yet. Wild Shape beasts appear when your class gets Wild Shape; companions and other forms come from your DM.</p>`));
  return `<div class="crpage">${parts.join('')}</div>`;
}

export function wildRows(c, shown, favs) {
  return shown.map(m => `
    <details class="crrow" ${st.open === m.id ? 'open' : ''} data-crid="${esc(m.id)}">
      <summary><button type="button" class="star ${favs.has(m.id) ? 'on' : ''}" data-act="wsfav" data-id="${esc(m.id)}" aria-label="${favs.has(m.id) ? 'Remove from favorites' : 'Favorite'}" aria-pressed="${favs.has(m.id)}">★</button>
        <span class="crname">${esc(m.name)}</span><small>CR ${esc(m.cr)} · ${esc(m.hp)} HP · AC ${esc(acNum(m.ac) ?? m.ac)}</small>
        <button class="btn small primary" type="button" data-act="wsform" data-id="${esc(m.id)}" ${c.hp?.form ? 'disabled' : ''}>Transform</button></summary>
      ${statBlock(c, m)}
    </details>`).join('') || '<p class="empty">No beasts match.</p>';
}

function companionCard(c, x, player) {
  const s = compState(c, x), i = (c.creatures || []).indexOf(x);
  const pct = s.max ? Math.round((s.cur / s.max) * 100) : 0;
  return `<article class="crcard ${s.out ? 'out' : ''}">
    <header><h4>${esc(x.ov?.name || x.name)}</h4><span class="crstate">${s.out ? 'Summoned' : 'Not summoned'}</span>
      <button class="btn small ${s.out ? '' : 'primary'}" type="button" data-act="csum" data-id="${esc(x.id)}">${s.out ? 'Dismiss' : 'Summon'}</button></header>
    <div class="crhp"><span class="lbl">HP</span><b>${s.cur}</b>/${s.max}${s.temp ? ` <i>+${s.temp} temp</i>` : ''} <span class="lbl">AC</span><b>${esc(acOf(c, x))}</b></div>
    <div class="hpbar" aria-hidden="true"><i style="width:${pct}%"></i></div>
    <div class="hpquick"><input class="f n" data-camt="${esc(x.id)}" inputmode="numeric" placeholder="Amount" aria-label="Amount" autocomplete="off">
      <button class="btn small" type="button" data-act="chp" data-id="${esc(x.id)}" data-how="dmg">Damage</button>
      <button class="btn small" type="button" data-act="chp" data-id="${esc(x.id)}" data-how="heal">Heal</button>
      <button class="btn small" type="button" data-act="chp" data-id="${esc(x.id)}" data-how="temp">Temp HP</button>
      <button class="btn small" type="button" data-act="chp" data-id="${esc(x.id)}" data-how="full">Full HP</button></div>
    ${player ? '' : dmBox(c, x, i)}
    <details class="sbwrap"><summary>Stat block${x.snap?.name && x.snap.name !== (x.ov?.name || x.name) ? ` (${esc(x.snap.name)})` : ''}</summary>${statBlock(c, x.snap, x.ov)}</details>
  </article>`;
}
function formCard(c, x, player) {
  const i = (c.creatures || []).indexOf(x);
  return `<article class="crcard">
    <header><h4>${esc(x.ov?.name || x.name)}</h4><span class="crstate">${maxHpOf(c, x)} HP · AC ${esc(acOf(c, x))}</span>
      <button class="btn small primary" type="button" data-act="cform" data-id="${esc(x.id)}" ${c.hp?.form ? 'disabled' : ''}>Transform</button></header>
    ${player ? '' : dmBox(c, x, i)}
    <details class="sbwrap"><summary>Stat block</summary>${statBlock(c, x.snap, x.ov)}</details>
  </article>`;
}
// The DM's numbers that scale with the character
function dmBox(c, x, i) {
  const hpF = T.evalFormula(c, x.ov?.hp), acF = T.evalFormula(c, x.ov?.ac);
  return `<details class="crdm"><summary>Adjust (only you see this)</summary>
    <div class="crdmgrid">
      <label class="hf"><span class="lbl">Name on this sheet</span><input class="f" data-k="creatures.${i}.ov.name" value="${esc(x.ov?.name || '')}" placeholder="${esc(x.name)}" autocomplete="off" data-rerender></label>
      <label class="hf"><span class="lbl">Max HP formula</span><input class="f" data-k="creatures.${i}.ov.hp" value="${esc(x.ov?.hp || '')}" placeholder="1 + {int} + {Artificer level}" autocomplete="off" data-rerender>
        <span class="hint">${x.ov?.hp ? (hpF != null ? `Works out to ${hpF}.` : "Can't work that out. Use numbers, + − × and {tokens}.") : `Blank: the Bestiary's ${esc(x.snap?.hp ?? '—')}.`}</span></label>
      <label class="hf"><span class="lbl">AC formula</span><input class="f" data-k="creatures.${i}.ov.ac" value="${esc(x.ov?.ac || '')}" placeholder="13 + {prof}" autocomplete="off" data-rerender>
        <span class="hint">${x.ov?.ac ? (acF != null ? `Works out to ${acF}.` : "Can't work that out.") : `Blank: the Bestiary's ${esc(x.snap?.ac ?? '—')}.`}</span></label>
    </div>
    <p class="hint">Tokens: {str} … {cha}, {prof}, {level}, {Artificer level} (any class), {spell attack}, {spell save DC}, and class table columns. They work in the Bestiary's action text too.</p>
    <button class="linkbtn danger" type="button" data-act="cdel" data-id="${esc(x.id)}">Remove from this sheet</button>
  </details>`;
}
