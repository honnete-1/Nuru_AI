/* Calm Scholar app entry: routing, rendering, event delegation. No build step, no CDN. */
import { S, setState, onChange, setHooks, act, guarded } from './core.js';
import { getState } from './api.js';
import { $, $$, esc, icon, toast, nuruSVG, prefersReducedMotion } from './util.js';
import { applyScene, nuruSay, setNuru, stopSound, playSound, sound, effectiveTheme } from './scene.js';
import * as today from './views/today.js';
import * as study from './views/study.js';
import * as core from './views/core_views.js';
import * as plan from './views/plan.js';
import * as library from './views/library.js';
import * as companion from './views/companion.js';
import * as journal from './views/journal.js';
import * as challenge from './views/challenge.js';
import { startOnboarding } from './onboarding.js';
import * as focus from './focus.js';

const VIEWS = {}, ACTIONS = {}, FORMS = {};
[today, study, core, plan, library, companion, journal, challenge, focus].forEach(m => m.register(VIEWS, ACTIONS, FORMS));

// Which top-level navigation item each route belongs to.
const NAV_OF = { home: 'home', study: 'study', revise: 'study', plan: 'plan', library: 'library', companion: 'companion', journal: 'journal', progress: 'progress' };

export function navigate(route) {
  const target = '#/' + route;
  if (location.hash === target) render(); else location.hash = target;
}

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = VIEWS[parts[0]] ? parts[0] : 'home';
  return { name, params: parts.slice(1) };
}

let lastRouteKey = '';
function render({ keepScroll = false } = {}) {
  if (!S.state) return;
  const route = parseRoute();
  let view = VIEWS[route.name](route.params);
  if (view.redirect) { location.replace(view.redirect); return; }
  const key = route.name + '/' + route.params.join('/');
  const changed = key !== lastRouteKey;
  lastRouteKey = key;
  S.route = route;
  const panel = $('#panel');
  const prevScroll = keepScroll && !changed ? window.scrollY : 0;
  const prevNb = keepScroll && !changed ? panel.querySelector('.notebook')?.scrollTop : 0;
  // Keep the student's place: if a field inside the panel had focus, restore it after re-rendering.
  const active = document.activeElement;
  const keepFocus = !changed && active && panel.contains(active) && (active.id || active.name) ? { id: active.id, name: active.name, start: active.selectionStart, end: active.selectionEnd } : null;
  document.body.classList.toggle('wide-view', !!view.wide);
  panel.innerHTML = `
    <div class="panel-head">
      ${view.back ? `<button class="icon-btn back" data-go="${esc(view.back)}" aria-label="Back">${icon('back')}</button>` : ''}
      <div><h1 id="panel-title">${view.title}</h1>${view.sub ? `<div class="sub">${view.sub}</div>` : ''}</div>
      <div class="tools">${view.tools || ''}</div>
    </div>
    <div class="panel-body ${view.bodyClass || ''}"><div class="${changed ? 'view-enter' : ''}">${view.body}</div></div>`;
  panel.setAttribute('aria-labelledby', 'panel-title');
  document.title = `${view.title.replace(/<[^>]+>/g, '')} · Calm Scholar`;
  view.mount?.(panel);
  applyScene();
  focus.refresh();
  if (prevScroll) window.scrollTo(0, prevScroll);
  if (prevNb) { const nb = panel.querySelector('.notebook'); if (nb) nb.scrollTop = prevNb; }
  if (keepFocus) {
    const el = keepFocus.id ? document.getElementById(keepFocus.id) : panel.querySelector(`[name="${CSS.escape(keepFocus.name)}"]`);
    if (el) { el.focus({ preventScroll: true }); try { if (keepFocus.start != null) el.setSelectionRange(keepFocus.start, keepFocus.end); } catch { /* not a text field */ } }
  }
  const nav = NAV_OF[route.name] || '';
  $$('#mainnav [data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === nav ? 'page' : 'false'));
  $('#nav-more')?.classList.toggle('current', ['companion', 'journal', 'progress'].includes(nav));
  if (changed && !view.keepNuru) setNuru(view.nuru || 'welcoming');
  if (changed) { window.scrollTo({ top: 0, behavior: 'auto' }); if (document.activeElement === document.body || !panel.contains(document.activeElement)) panel.focus({ preventScroll: true }); }
}

function banners() {
  const st = S.state, out = [];
  if (st.profile.is_demo) out.push(`<div class="banner">${icon('info')}<span><b>Sample space.</b> Fictional data, separate from real accounts. Replies are scripted demo responses. Please don't enter personal information.</span></div>`);
  else if (st.ai.mode === 'demo') out.push(`<div class="banner">${icon('info')}<span><b>Demo mode: scripted responses.</b> Assignments, planning, notes, focus and grades are fully real. Live AI starts once the person running this installation adds an API key.</span></div>`);
  if (!navigator.onLine) out.push(`<div class="banner offline">You're offline. Changes can't be saved until you're connected again. Anything you type is kept.</div>`);
  $('#banners').innerHTML = out.join('');
  const badge = $('#ai-badge');
  badge.className = 'ai-badge ' + st.ai.mode;
  badge.textContent = st.ai.mode === 'live' ? 'Live AI' : 'Demo mode';
  badge.title = st.ai.mode === 'live' ? `Replies come from the configured provider (${st.ai.model}). Failures are labelled as fallbacks.` : 'No AI provider key is configured (or this is a sample space). Replies are scripted and labelled.';
  $('#user-btn').textContent = (st.profile.name || 'S').charAt(0).toUpperCase();
}

function celebrateKeepsakes(list) {
  const style = S.state.profile.celebration;
  list.forEach((k, i) => setTimeout(() => {
    toast(`<span class="keepsake-toast row">${nuruSVG('celebrating', S.state.profile.companion_hue)}<span><b>New for our desk: ${esc(k.name)}.</b> ${esc(k.why)} <a href="#/progress">See it</a></span></span>`, { html: true, ms: 7000 });
  }, i * 2400));
  if (style !== 'quiet') nuruSay(`Something new for our desk: ${list[0].name}.`, 'celebrating', { ms: 6000 });
  if (style === 'sparkle') confetti();
}

export function confetti() {
  if (prefersReducedMotion() || S.state.profile.celebration === 'quiet') return;
  const box = document.createElement('div'); box.className = 'confetti'; box.setAttribute('aria-hidden', 'true');
  const colours = ['#E7B56B', '#B8A4D4', '#A8BFA3', '#FAF7F0', '#57438A'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i');
    p.style.left = 30 + Math.random() * 40 + '%'; p.style.background = colours[i % colours.length];
    p.style.animationDelay = Math.random() * 0.6 + 's'; p.style.width = p.style.height = 7 + Math.random() * 8 + 'px';
    box.appendChild(p);
  }
  document.body.appendChild(box); setTimeout(() => box.remove(), 3400);
}

/* ---------- global delegation ---------- */
document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); closeMenus(); navigate(nav.dataset.nav); return; }
  const go = e.target.closest('[data-go]');
  if (go) { e.preventDefault(); closeMenus(); location.hash = go.dataset.go; return; }
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) { e.preventDefault(); await ACTIONS[a.dataset.act](a, e); }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f || !FORMS[f.dataset.form]) return;
  e.preventDefault();
  const btn = f.querySelector('[type=submit],button:not([type=button])');
  await guarded(btn, () => FORMS[f.dataset.form](f, Object.fromEntries(new FormData(f)), e));
});

const userBtn = $('#user-btn'), menu = $('#user-menu'), moreBtn = $('#nav-more'), more = $('#more-sheet');
function closeMenus() {
  menu.hidden = true; userBtn.setAttribute('aria-expanded', 'false');
  more.hidden = true; moreBtn.setAttribute('aria-expanded', 'false');
}
userBtn.addEventListener('click', e => { e.stopPropagation(); const open = menu.hidden; closeMenus(); menu.hidden = !open; userBtn.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('[role=menuitem]')?.focus(); });
moreBtn.addEventListener('click', e => { e.stopPropagation(); const open = more.hidden; closeMenus(); more.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); if (open) more.querySelector('button')?.focus(); });
document.addEventListener('click', e => { if (!e.target.closest('.user-menu') && !e.target.closest('#more-sheet') && !e.target.closest('#nav-more')) closeMenus(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!menu.hidden) { closeMenus(); userBtn.focus(); } else if (!more.hidden) { closeMenus(); moreBtn.focus(); }
});

window.addEventListener('hashchange', () => render());
window.addEventListener('online', banners); window.addEventListener('offline', banners);

onChange(() => { applyScene(); banners(); render({ keepScroll: true }); });
setHooks({ keepsakes: celebrateKeepsakes, rerender: () => render({ keepScroll: true }) });

Object.assign(ACTIONS, {
  'toggle-theme': btn => guarded(btn, () => act('room_save', { theme: effectiveTheme(S.state.room.theme) === 'evening' ? 'day' : 'evening' })),
  'toggle-sound': () => { if (sound.playing) { stopSound(); return; } playSound(S.state.room.sound === 'off' ? 'rain' : S.state.room.sound); },
});

async function boot() {
  try {
    const st = await getState();
    if (st.profile.remember_chat && st.messages.length) S.chats.set('general', st.messages.map(m => ({ role: m.role, content: m.content, meta: { mode: m.mode || 'saved' } })));
    setState(st, { silent: true });
  } catch (e) {
    $('#panel').innerHTML = `<div class="panel-body"><div class="empty" style="margin-top:40px"><h3>We couldn't open Calm Scholar just now</h3><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div></div>`;
    return;
  }
  applyScene(); banners(); render();
  focus.resumeIfRunning();
  if (!S.state.profile.onboarded) startOnboarding();
}
boot();
