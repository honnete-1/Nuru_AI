/* Focus sessions inside Study Together. Elapsed time comes from wall-clock timestamps, so it stays
   correct in background tabs and across navigation or reloads. A client token makes saving idempotent.
   The session never blocks the page: the student can ask Nuru for help or switch views while it runs. */
import { S, act, guarded, assignment, go } from './core.js';
import { esc, icon, uid, toast, plural, $, $$ } from './util.js';
import { setNuru, nuruSay, setActivity } from './scene.js';

const KEY = 'cs-focus';
let F = null, tick = null;
const baseTitle = document.title;

const elapsedMs = () => F ? F.before + (F.running ? Date.now() - F.startedAt : 0) : 0;
const persist = () => { try { F ? localStorage.setItem(KEY, JSON.stringify(F)) : localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };
const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export const current = () => F;

/** A session length that fits the step: 10, 15, 25 or 45 minutes. */
export function sizeFor(stepMinutes) {
  const m = Math.max(10, Math.min(45, stepMinutes || 25));
  return [10, 15, 25, 45].reduce((best, x) => Math.abs(x - m) < Math.abs(best - m) ? x : best, 25);
}

export function returnHash(f = F) {
  if (!f) return '#/study';
  if (f.assignment_id) return `#/study/a/${f.assignment_id}${f.step_id ? '/s/' + f.step_id : ''}`;
  return '#/study';
}

export function openFocusSetup() {
  const steps = S.state.assignments.filter(a => !a.completed).flatMap(a => a.steps.filter(s => !s.completed).map(s => ({ a, s }))).slice(0, 25);
  return `<form data-form="focus-setup" class="stack">
    <label>What will you work on?<select name="pick"><option value="">My own goal (write it below)</option>${steps.map(({ a, s }) => `<option value="${a.id}|${s.id}|${esc(s.title)}">${esc(s.title)} · ${esc(a.title)}</option>`).join('')}</select></label>
    <label>Goal in your words<input name="goal" maxlength="200" placeholder="e.g. Outline the discussion section"></label>
    <fieldset class="bare"><legend class="small strong">Length</legend><div class="chips">${[15, 25, 45, 60].map(m => `<label class="chip"><input type="radio" name="minutes" value="${m}" ${m === 25 ? 'checked' : ''}> ${m} min</label>`).join('')}</div></fieldset>
    <div class="row"><button class="btn btn-lamp">${icon('play')}Start focus</button><span class="tiny muted">Pause, resume or finish whenever you like.</span></div></form>`;
}

export function startFocus({ goal, assignment_id = null, step_id = null, minutes = 25 }) {
  if (F && !F.saved && !confirm('A focus session is already running. Start a new one instead?')) return;
  F = { token: uid(), goal: (goal || 'Focused study').slice(0, 200), assignment_id: assignment_id || null, step_id: step_id || null,
    duration: Math.max(1, Math.min(180, minutes || 25)) * 60000, before: 0, startedAt: Date.now(), running: true, saved: false, logId: null };
  persist();
  nuruSay(`I'll study quietly beside you. ${minutes} minutes on “${F.goal}”.`, 'studying', { ms: 5000 });
  const target = returnHash();
  if (!location.hash.startsWith(target)) go(target); else refresh();
  startTick();
}

export function resumeIfRunning() {
  try { const raw = localStorage.getItem(KEY); F = raw ? JSON.parse(raw) : null; } catch { F = null; }
  if (F) startTick();
  refresh();
}

function startTick() { clearInterval(tick); tick = setInterval(update, 500); update(); }

function close() {
  clearInterval(tick); tick = null; F = null; persist();
  document.title = baseTitle; setNuru('welcoming'); setActivity('idle');
  refresh();
}

/** The card shown inside Study Together. */
export function focusCard() {
  if (!F) return '';
  const a = F.assignment_id ? assignment(F.assignment_id) : null;
  const step = a && F.step_id ? a.steps.find(s => s.id === F.step_id) : null;
  if (F.saved) {
    return `<section class="focus-card saved" data-focus-card aria-labelledby="fc-title">
      <h3 id="fc-title">Saved: ${plural(Math.max(1, Math.round(F.savedMinutes)), 'minute')} on “${esc(F.goal)}”</h3>
      <p class="small muted">Recorded as time studied. It's self-reported and isn't a measure of learning.</p>
      ${step && !step.completed ? `<div class="row"><button class="btn btn-sage btn-sm" data-act="focus-done-step">${icon('check')}Mark “${esc(step.title)}” done</button></div>` : ''}
      <form data-form="focus-reflect" class="stack" style="gap:10px;margin-top:10px">
        <label>What became a little clearer? (optional)<textarea name="clearer" maxlength="1000" rows="2"></textarea></label>
        <label>Where should we pick up next time? (optional)<input name="next_step" maxlength="200"></label>
        <div class="row"><button class="btn btn-primary btn-sm">Save reflection</button><button type="button" class="btn-text" data-act="focus-close">Skip</button></div>
      </form></section>`;
  }
  return `<section class="focus-card" data-focus-card aria-labelledby="fc-title">
    <div class="fc-time"><span class="fc-clock" data-focus-time role="timer" aria-live="off">00:00</span><small data-focus-label>remaining</small></div>
    <div class="fc-main"><h3 id="fc-title"><span class="tiny muted">Focusing on</span><br>${esc(F.goal)}</h3>
      <div class="progress-line" aria-hidden="true"><span data-focus-bar style="width:0%"></span></div></div>
    <div class="row fc-actions">
      <button class="btn btn-ghost btn-sm" data-act="focus-pause">${F.running ? icon('pause') + 'Pause' : icon('play') + 'Resume'}</button>
      <button class="btn btn-lamp btn-sm" data-act="focus-finish">${icon('check')}Finish &amp; save</button>
      <button class="btn-text" data-act="focus-leave">Stop without saving</button>
    </div></section>`;
}

function pill() {
  if (!F || F.saved) return '';
  return `<div class="focus-pill" role="group" aria-label="Focus session">
    <span class="lamp-dot"></span><span><span class="sr-only">Focus time </span><b data-focus-time>00:00</b></span>
    <button class="icon-btn" data-act="focus-pause" aria-label="${F.running ? 'Pause focus' : 'Resume focus'}">${icon(F.running ? 'pause' : 'play')}</button>
    <button class="btn-text" data-go="${returnHash()}">Back to it</button></div>`;
}

/** Re-draw focus UI in place (pill in the top bar, card in Study Together). */
export function refresh() {
  const slot = $('#focus-pill-slot'); if (slot) slot.innerHTML = pill();
  $$('[data-focus-slot]').forEach(el => { el.innerHTML = focusCard(); });
  setActivity(F && F.running && !F.saved ? 'writing' : 'idle');
  update();
}

function update() {
  if (!F || F.saved) return;
  const el = elapsedMs(), left = F.duration - el;
  $$('[data-focus-time]').forEach(t => { t.textContent = left > 0 ? fmt(left) : fmt(el); });
  $$('[data-focus-label]').forEach(t => { t.textContent = left > 0 ? (F.running ? 'remaining' : 'paused') : 'time is up · finish when ready'; });
  $$('[data-focus-bar]').forEach(b => { b.style.width = Math.min(100, el / F.duration * 100) + '%'; });
  document.title = `${left > 0 ? fmt(left) : 'Done'} · Focus · Calm Scholar`;
  if (left <= 0 && !F.notified) { F.notified = true; persist(); nuruSay('That’s the time you set. Finish when you’re ready, or keep going.', 'celebrating', { ms: 6000 }); }
}

async function save(btn) {
  const minutes = Math.max(1, Math.min(180, Math.round(elapsedMs() / 60000)));
  if (elapsedMs() < 30000 && !confirm('Less than a minute so far. Save it anyway?')) return;
  const r = await guarded(btn, () => act('focus_log', { minutes, goal: F.goal, assignment_id: F.assignment_id, step_id: F.step_id, client_token: F.token }, { render: false }));
  if (!r) return; // the error is shown; the session stays open so nothing is lost
  F.running = false; F.saved = true; F.savedMinutes = minutes; F.logId = r.focus_id; persist();
  clearInterval(tick); document.title = baseTitle;
  if (!location.hash.startsWith(returnHash())) go(returnHash());
  (await import('./core.js')).rerender();
}

export function register(V, A, F_) {
  Object.assign(A, {
    'focus-start': b => startFocus({ goal: b.dataset.goal, assignment_id: b.dataset.assignment ? +b.dataset.assignment : null, step_id: b.dataset.step ? +b.dataset.step : null, minutes: +b.dataset.minutes || 25 }),
    'focus-pause': () => { if (!F) return; if (F.running) { F.before = elapsedMs(); F.running = false; } else { F.startedAt = Date.now(); F.running = true; } persist(); refresh(); },
    'focus-finish': b => save(b),
    'focus-leave': () => { if (elapsedMs() < 60000 || confirm('Stop without saving this time?')) close(); },
    'focus-close': () => close(),
    'focus-done-step': b => guarded(b, async () => { await act('step_toggle', { id: F.step_id }, { message: 'Step marked done.' }); }),
  });
  F_['focus-setup'] = async (f, d) => {
    let goal = (d.goal || '').trim(), aid = null, sid = null;
    if (d.pick) { const [a, s, ...title] = d.pick.split('|'); aid = +a; sid = +s; if (!goal) goal = title.join('|'); }
    if (!goal) { toast('Add a goal, even a small one.', { error: true }); return; }
    startFocus({ goal, assignment_id: aid, step_id: sid, minutes: +d.minutes || 25 });
  };
  F_['focus-reflect'] = async (f, d) => {
    if (d.clearer || d.next_step) await act('focus_reflect', { id: F.logId, clearer: d.clearer, next_step: d.next_step }, { message: 'Reflection kept.', render: false });
    close();
  };
}
