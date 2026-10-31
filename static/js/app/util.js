/* Shared helpers. All dynamic text passes through esc() or textContent. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Safe, tiny formatter for model/user text: escape FIRST, then allow **bold**, "- " bullets and paragraphs. */
export function rich(text) {
  const blocks = String(text ?? '').replace(/\r/g, '').split(/\n{2,}/);
  return blocks.map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      return '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`).join('') + '</ul>';
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

const PATHS = {
  plus: 'M12 5v14M5 12h14', back: 'M15 18l-6-6 6-6', close: 'M6 6l12 12M18 6 6 18', edit: 'M4 20h4L19 9l-4-4L4 16Z',
  trash: 'M5 7h14M10 11v6M14 11v6M7 7l1 13h8l1-13M9 7V4h6v3', up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6',
  check: 'M5 12l5 5L20 7', send: 'M4 12 20 4l-6 16-3-7Z', spark: 'M12 3c0 5-4 9-9 9 5 0 9 4 9 9 0-5 4-9 9-9-5 0-9-4-9-9Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2', play: 'M8 5v14l11-7Z', pause: 'M8 5v14M16 5v14', reset: 'M4 4v6h6M5 15a7 7 0 1 0 1.5-7.5L4 10',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z', chat: 'M4 5h16v11H9l-5 4Z', upload: 'M12 16V4M7 9l5-5 5 5M4 20h16', flag: 'M5 21V4h11l-2 4 2 4H5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 7.5v.5', heart: 'M12 20 4.5 12.5a4.5 4.5 0 0 1 7.5-5 4.5 4.5 0 0 1 7.5 5Z', leaf: 'M5 19C3 9 11 4 20 4c0 9-6 16-15 15ZM5 19 14 10',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5', moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
};
export const icon = (n, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[n] || PATHS.spark}"/></svg>`;

let nuruCount = 0;
/** Clone the Nuru SVG template with unique gradient ids. */
export function nuruSVG(state = 'welcoming', hue = 'amber', cls = '', label = '') {
  const tpl = document.getElementById('tpl-nuru');
  if (!tpl) return '';
  const id = `n${++nuruCount}`;
  return tpl.innerHTML.replace(/nuruCoreTpl/g, 'nuruCore' + id)
    .replace('data-state="welcoming"', `data-state="${esc(state)}"`).replace('data-hue="amber"', `data-hue="${esc(hue)}"`)
    .replace('class="nuru"', `class="nuru ${esc(cls)}"`).replace(/role="img" aria-label="[^"]*"/, label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"');
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export const dateObj = s => new Date(`${String(s).slice(0, 10)}T12:00:00`);
export const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => dateObj(s).toLocaleDateString(undefined, opts);
export const daysBetween = (a, b) => Math.round((dateObj(b) - dateObj(a)) / 86400000);
export const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const mins = n => n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ' ' + (n % 60) + ' min' : ''}` : `${n} min`;
export const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;

export function dueText(due, today) {
  const d = daysBetween(today, due);
  if (d < 0) return { text: d === -1 ? 'Was due yesterday' : `Was due ${fmtDate(due, { day: 'numeric', month: 'short' })}`, tone: 'rose' };
  if (d === 0) return { text: 'Due today', tone: 'amber' };
  if (d === 1) return { text: 'Due tomorrow', tone: 'amber' };
  if (d < 7) return { text: `Due ${fmtDate(due, { weekday: 'long' })}`, tone: 'lav' };
  return { text: `Due ${fmtDate(due, { day: 'numeric', month: 'short' })}`, tone: '' };
}

let toastTimer;
export function toast(message, { error = false, html = false, ms = 4800 } = {}) {
  const el = document.getElementById('toast');
  if (!el) return;
  if (html) el.innerHTML = message; else el.textContent = message;
  el.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const prefersReducedMotion = () => {
  const m = document.documentElement.dataset.motion;
  if (m === 'reduce') return true;
  if (m === 'full') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export const STAGES = [
  ['discover', 'Discover', 'Understand the brief'], ['explore', 'Explore', 'Gather and learn'], ['practice', 'Practice', 'Try it out'],
  ['create', 'Create', 'Make the work'], ['reflect', 'Reflect', 'Check and improve'],
];

export const FALLBACK_REASONS = {
  timeout: 'the AI provider took too long to answer', rate_limited: 'the AI provider is rate-limiting requests right now',
  unavailable: 'the AI provider could not be reached', invalid: 'the AI provider returned a reply that failed validation',
};

/** Open the shared <dialog>. Returns the inner element. Focus returns to the opener on close. */
export function openDialog(title, html, { cls = '', dismissable = true } = {}) {
  const d = document.getElementById('dialog'), inner = document.getElementById('dialog-inner');
  const opener = document.activeElement;
  d.className = cls;
  inner.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${title}</h2>${dismissable ? `<button class="icon-btn" data-close-dialog aria-label="Close">${icon('close')}</button>` : ''}</div><div class="dialog-body">${html}</div>`;
  inner.querySelector('[data-close-dialog]')?.addEventListener('click', () => d.close());
  d.oncancel = e => { if (!dismissable) e.preventDefault(); };
  d.onclose = () => { inner.innerHTML = ''; if (opener && opener.focus && opener.isConnected) opener.focus(); };
  if (!d.open) d.showModal();
  const first = inner.querySelector('input,select,textarea,button:not([data-close-dialog])'); first?.focus();
  return inner;
}
export const closeDialog = () => { const d = document.getElementById('dialog'); if (d.open) d.close(); };
