/* First visit: name, companion, one course/goal, availability, privacy. Nothing sensitive is required. */
import { S, act } from './core.js';
import { esc, nuruSVG, openDialog, closeDialog, toast } from './util.js';
import { nuruSay, applyScene, sceneSVG } from './scene.js';

const draft = {};

function dots(n) { return `<div class="dots" aria-hidden="true">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div><span class="sr-only">Step ${n} of 5</span>`; }

function step(n) {
  const p = S.state.profile;
  const v = (k, d) => esc(draft[k] ?? d);
  const hue = draft.companion_hue || p.companion_hue;
  const nm = draft.companion_name || p.companion_name;
  const screens = {
    1: `<div class="ob-hero">${nuruSVG('welcoming', hue, '', 'Nuru, waving hello')}<div><h3 style="margin:0 0 4px">Hello, and welcome in.</h3><p class="muted" style="margin:0">I'm ${esc(nm)}, your AI study buddy. We can organize your work, understand something together, revise, or talk through how things are going. Setting up takes about a minute, and you can skip anything.</p></div></div>
        <label>What should I call you?<input name="name" maxlength="60" value="${v('name', p.name)}" autocomplete="given-name"></label>`,
    2: `<div class="ob-scene">${sceneSVG({ cls: 'compact' })}</div><h3 style="margin:4px 0">You and your study buddy</h3><p class="muted small" style="margin:0 0 10px">You'll sit side by side in Study Together. Choose how your seat looks and ${esc(nm)}'s light. You can change this later.</p>
        <div class="field-grid"><label>Skin tone<select name="avatar_skin">${[['s1', 'Light'], ['s2', 'Medium'], ['s3', 'Tan'], ['s4', 'Deep']].map(([k, l]) => `<option value="${k}" ${(draft.avatar_skin || p.avatar.skin) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Hair<select name="avatar_hair">${[['short', 'Short'], ['long', 'Long'], ['curly', 'Curly'], ['wrap', 'Head wrap']].map(([k, l]) => `<option value="${k}" ${(draft.avatar_hair || p.avatar.hair) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Jumper<select name="avatar_outfit">${[['lavender', 'Lavender'], ['sage', 'Sage'], ['amber', 'Amber'], ['plum', 'Plum']].map(([k, l]) => `<option value="${k}" ${(draft.avatar_outfit || p.avatar.outfit) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="hue-pick" role="group" aria-label="Lantern colour">${['amber', 'lavender', 'sage'].map(h => `<button type="button" data-hue="${h}" aria-pressed="${hue === h}">${nuruSVG('welcoming', h)}${h[0].toUpperCase() + h.slice(1)}</button>`).join('')}</div>
        <label style="margin-top:14px">Companion's name<input name="companion_name" maxlength="30" value="${v('companion_name', p.companion_name)}"></label>
        <label style="margin-top:10px">When something goes well, I'd like…<select name="celebration">${[['quiet', 'Quiet acknowledgement'], ['gentle', 'A gentle glow'], ['sparkle', 'A little paper confetti']].map(([k, l]) => `<option value="${k}" ${(draft.celebration || p.celebration) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`,
    3: `<div class="ob-hero">${nuruSVG('explaining', hue)}<div><h3 style="margin:0 0 4px">One course, one goal (optional)</h3><p class="muted" style="margin:0">Something you're studying now, and what you'd like from it. Skip if you'd rather not.</p></div></div>
        <label>Course<input name="course" maxlength="80" value="${v('course', '')}" placeholder="e.g. Research Methods"></label>
        <label style="margin-top:10px">A learning goal<input name="goal" maxlength="240" value="${v('goal', '')}" placeholder="e.g. understand statistics well enough to explain my results"></label>
        <label class="checkline" style="margin-top:10px"><input type="checkbox" name="remember_goal" ${draft.remember_goal ? 'checked' : ''}><span>Let ${esc(nm)} remember this goal<small>Saved as a learning-memory item you can view, edit or forget in Settings.</small></span></label>`,
    4: `<div class="ob-hero">${nuruSVG('thinking', hue)}<div><h3 style="margin:0 0 4px">Your usual time</h3><p class="muted" style="margin:0">Plans fit inside this, with breaks. Change it whenever life changes.</p></div></div>
        <div class="field-grid"><label>Minutes per day<input type="number" name="daily_minutes" min="15" max="360" value="${v('daily_minutes', p.daily_minutes)}"></label>
        <label>Start from (hour)<input type="number" name="start_hour" min="5" max="22" value="${v('start_hour', p.start_hour)}"></label>
        <label>Stop by (hour)<input type="number" name="end_hour" min="6" max="23" value="${v('end_hour', p.end_hour)}"></label></div>
        <label style="margin-top:10px">Pace<select name="energy">${[['gentle', 'Gentle'], ['balanced', 'Balanced'], ['focused', 'Focused']].map(([k, l]) => `<option value="${k}" ${(draft.energy || p.energy) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <p class="tiny muted">Time zone: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)} (from your device)</p>`,
    5: `<div class="ob-hero">${nuruSVG('supporting', hue)}<div><h3 style="margin:0 0 4px">Your privacy choices</h3><p class="muted" style="margin:0">Each one is off unless you say otherwise, except memory, which only ever holds items you approve.</p></div></div>
        <div class="stack" style="gap:8px">
        <label class="checkline"><input type="checkbox" name="remember_chat" ${draft.remember_chat ? 'checked' : ''}><span>Save conversations between visits<small>Off means chats vanish when you close the tab.</small></span></label>
        <label class="checkline"><input type="checkbox" name="share_workload" ${draft.share_workload ? 'checked' : ''}><span>Share my assignment list with the AI in general chat<small>Titles, due dates and estimates only. Never grades or check-ins.</small></span></label>
        <label class="checkline"><input type="checkbox" name="use_memory" ${draft.use_memory ?? true ? 'checked' : ''}><span>Allow learning memory<small>Only things you approve, always visible in Settings.</small></span></label></div>
        <p class="tiny muted" style="margin-top:10px">${S.state.ai.mode === 'live' ? 'Live AI is on. Before each request, you can see what will be sent to the provider.' : 'This installation is in demo mode, so replies are scripted and labelled.'} ${esc(nm)} is an AI study companion, not a counsellor or emergency service.</p>`,
  };
  const inner = openDialog(n === 1 ? 'Welcome to Calm Scholar' : ['', '', 'Your seat and study buddy', 'Something you are learning', 'Time', 'Privacy'][n], `<form id="ob-form" class="stack">${dots(n)}${screens[n]}
    <div class="spread" style="margin-top:8px"><button type="button" class="btn-text" id="ob-skip">${n === 5 ? '' : 'Skip setup for now'}</button>
    <div class="row">${n > 1 ? '<button type="button" class="btn btn-ghost" id="ob-back">Back</button>' : ''}<button class="btn btn-primary">${n === 5 ? 'Start studying with Nuru' : 'Next'}</button></div></div></form>`, { cls: 'onboard', dismissable: false });
  const form = inner.querySelector('#ob-form');
  const capture = () => { const fd = new FormData(form); form.querySelectorAll('input[type=checkbox]').forEach(c => { draft[c.name] = c.checked; }); fd.forEach((val, k) => { if (form.elements[k]?.type !== 'checkbox') draft[k] = val; }); };
  inner.querySelectorAll('.hue-pick button').forEach(b => b.addEventListener('click', () => { capture(); draft.companion_hue = b.dataset.hue; step(2); }));
  inner.querySelector('#ob-back')?.addEventListener('click', () => { capture(); step(n - 1); });
  inner.querySelector('#ob-skip')?.addEventListener('click', () => finish(true));
  form.addEventListener('submit', e => { e.preventDefault(); capture(); n < 5 ? step(n + 1) : finish(false); });
}

async function finish(skipped) {
  const p = S.state.profile;
  const payload = skipped ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : {
    name: draft.name || p.name, companion_name: draft.companion_name || 'Nuru', companion_hue: draft.companion_hue || p.companion_hue, celebration: draft.celebration || p.celebration,
    course: draft.course || '', goal: draft.goal || '', remember_goal: !!draft.remember_goal,
    daily_minutes: +draft.daily_minutes || p.daily_minutes, start_hour: +draft.start_hour || p.start_hour, end_hour: +draft.end_hour || p.end_hour, energy: draft.energy || p.energy,
    remember_chat: !!draft.remember_chat, share_workload: !!draft.share_workload, use_memory: draft.use_memory ?? true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    avatar: { skin: draft.avatar_skin || p.avatar.skin, hair: draft.avatar_hair || p.avatar.hair, outfit: draft.avatar_outfit || p.avatar.outfit },
  };
  try {
    await act('onboard', payload);
    closeDialog(); applyScene();
    const nm = S.state.profile.companion_name;
    nuruSay(skipped ? `That's fine, we can set things up later. I'm ${nm}, your AI study buddy. Pick whatever would help today.` : `Welcome, ${S.state.profile.name}. Pick whatever would help today, and we'll start together.`, 'welcoming', { ms: 12000 });
  } catch (e) { toast(e.message, { error: true }); }
}

export const startOnboarding = () => step(1);
