// Text you type (library entries, notes, boons) shown on the page, with a little formatting:
//   ***words***  bold italic      **words**  bold      *words*  italic
//   a line that starts with spaces or tabs is indented (4 spaces or 1 tab per step)
//   a blank line starts a new paragraph
// One copy for every place in the app, so the library, the sheet and the creature cards all agree.
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Marks only count when they hug the words (no space just inside them), so "2 * 3 * 4" stays as it is
function inline(s) {
  return s
    .replace(/\*\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, '<b>$1</b>')
    .replace(/\*(?=\S)([^*\n]+?)(?<=\S)\*/g, '<i>$1</i>');
}
// How far a line is indented: each tab, or each 4 spaces, is one step
function indentOf(line) {
  const m = /^[ \t]+/.exec(line);
  if (!m) return { lvl: 0, rest: line };
  let cols = 0;
  for (const ch of m[0]) cols += ch === '\t' ? 4 : 1;
  return { lvl: Math.max(1, Math.round(cols / 4)), rest: line.slice(m[0].length) };
}

export function fmt(t) {
  const text = String(t || '').replace(/\r\n?/g, '\n');
  return text.split(/\n{2,}/).map(par => {
    const lines = par.split('\n').map(l => ({ ...indentOf(l) }));
    if (!lines.some(l => l.lvl)) return `<p>${lines.map(l => inline(esc(l.rest))).join('<br>')}</p>`;
    return `<div class="tx">${lines.map(l => `<div class="txl"${l.lvl ? ` style="padding-left:${l.lvl * 1.5}em"` : ''}>${inline(esc(l.rest)) || '&nbsp;'}</div>`).join('')}</div>`;
  }).join('');
}

// Tab in a text box indents the line instead of leaving the box; Shift+Tab takes one step back out.
// Works on a selection of several lines too. (On a phone or tablet keyboard, type 4 spaces instead.)
export function tabIndent(e) {
  const ta = e.target;
  if (e.key !== 'Tab' || ta?.tagName !== 'TEXTAREA' || e.ctrlKey || e.altKey || e.metaKey) return;
  e.preventDefault();
  const v = ta.value, s = ta.selectionStart, end = ta.selectionEnd;
  const from = v.lastIndexOf('\n', s - 1) + 1;
  const toNl = v.indexOf('\n', Math.max(end - (end > s && v[end - 1] === '\n' ? 1 : 0), s));
  const to = toNl === -1 ? v.length : toNl;
  const block = v.slice(from, to).split('\n');
  let first = 0, total = 0;
  const out = block.map((l, i) => {
    if (!e.shiftKey) { if (i === 0) first = 4; total += 4; return '    ' + l; }
    const m = /^( {1,4}|\t)/.exec(l); const n = m ? m[0].length : 0;
    if (i === 0) first = -n; total -= n; return l.slice(n);
  });
  ta.value = v.slice(0, from) + out.join('\n') + v.slice(to);
  if (s === end) { const p = Math.max(from, s + first); ta.setSelectionRange(p, p); }
  else ta.setSelectionRange(Math.max(from, s + first), end + total);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}
