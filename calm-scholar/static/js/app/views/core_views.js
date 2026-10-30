/* My Progress, Our study space, and Settings. */
import { S, act, guarded, companionName } from '../core.js';
import { esc, icon, mins, plural, fmtDate, nuruSVG, toast, $ } from '../util.js';
import { playSound, stopSound, sound, applyScene, sceneSVG } from '../scene.js';
import { navigate } from '../main.js';

export const KS_ART = {
  reading_lamp: '<path d="M14 50h28l-4-6H18Z" fill="#3e3a52"/><path d="M28 44l-4-24 18-12" fill="none" stroke="#3e3a52" stroke-width="3"/><path d="M38 6l18 6-10 18-20-8Z" fill="#3e3a52"/><circle cx="40" cy="26" r="10" fill="#ffd98e" opacity=".5"/>',
  succulent: '<path d="M18 40h24l-3 14H21Z" fill="#c6714f"/><path d="M30 40q-12-4-12-18q10 2 12 18Zm0 0q12-4 14-20q-12 4-14 20Zm0 0q0-14 2-22q6 10-2 22Z" fill="#7f9e78"/>',
  trailing_fern: '<path d="M20 8h24l-4 12H24Z" fill="#c6714f"/><path d="M32 18q-20 8-22 34M32 18q4 20 0 36M32 18q20 8 22 34" fill="none" stroke="#5f7f5b" stroke-width="2.5"/><g fill="#7f9e78"><ellipse cx="14" cy="34" rx="6" ry="3"/><ellipse cx="50" cy="34" rx="6" ry="3"/><ellipse cx="32" cy="44" rx="3" ry="6"/></g>',
  tea_set: '<path d="M8 50q-4-22 16-22t16 22Z" fill="#A8BFA3"/><path d="M10 38q-8-2-8-10" stroke="#7f9e78" stroke-width="4" fill="none"/><path d="M44 40h12q0 10-6 10t-6-10Z" fill="#fffaf0" stroke="#c7b59a"/>',
  paper_garland: '<path d="M2 10q28 20 56 0" fill="none" stroke="#6d4a33" stroke-width="1.5"/><path d="M10 16l5 9 5-8-5-4Z" fill="#E7B56B"/><path d="M26 21l5 9 5-8-5-4Z" fill="#B8A4D4"/><path d="M42 16l5 9 5-8-5-4Z" fill="#A8BFA3"/>',
  brass_clock: '<circle cx="30" cy="28" r="18" fill="#f8ecd2" stroke="#b98b3e" stroke-width="4"/><path d="M30 28V16M30 28l8 5" stroke="#6d4a33" stroke-width="2.5" stroke-linecap="round"/>',
  desk_globe: '<circle cx="30" cy="26" r="18" fill="#9cc0cf" stroke="#6d4a33" stroke-width="1.5"/><path d="M18 20q8-6 14 2t10-2M22 36q6 2 12-4" fill="none" stroke="#6f8f68" stroke-width="4" stroke-linecap="round"/><path d="M18 54h24M30 54v-10" stroke="#6d4a33" stroke-width="4" stroke-linecap="round"/>',
  star_chart: '<rect x="8" y="6" width="44" height="46" fill="#2f2b4a" stroke="#b98b3e" stroke-width="3"/><g fill="#ffe4a3"><circle cx="18" cy="18" r="2"/><circle cx="32" cy="24" r="2"/><circle cx="42" cy="16" r="2"/><circle cx="26" cy="40" r="2"/></g><path d="M18 18l14 6 10-8M32 24l-6 16" stroke="#ffe4a3" stroke-width="1" fill="none" opacity=".6"/>',
  index_cards: '<rect x="4" y="22" width="40" height="26" rx="3" fill="#E7B56B" transform="rotate(-6 24 35)"/><rect x="10" y="16" width="40" height="26" rx="3" fill="#B8A4D4" transform="rotate(4 30 29)"/><rect x="8" y="14" width="40" height="26" rx="3" fill="#FAF7F0" stroke="#c7b59a"/><path d="M14 22h28M14 28h22M14 34h18" stroke="#57438A" stroke-width="1.6" opacity=".6"/>',
};
const KIND_LABEL = { starter: 'Here from the start', participation: 'For something you did', time: 'Time studied (self-reported)', understanding: 'Checked understanding' };

function viewProgress() {
  const st = S.state, pr = st.progress, unlocked = new Set(st.room.unlocked), placed = new Set(st.room.placed);
  const stat = (n, label, note) => `<div class="stat"><b>${n}</b><span>${label}</span>${note ? `<small>${note}</small>` : ''}</div>`;
  const cards = Object.entries(st.catalog).map(([k, c]) => {
    const have = unlocked.has(k), starterFixed = k === 'reading_lamp';
    return `<article class="paper keepsake ${have ? '' : 'locked'}">
      <div class="art"><svg viewBox="0 0 60 60" aria-hidden="true">${KS_ART[k] || ''}</svg></div>
      <h3>${esc(c.name)}</h3>
      <span class="tag ${c.kind === 'understanding' ? 'sage' : c.kind === 'time' ? 'amber' : 'lav'}">${KIND_LABEL[c.kind]}</span>
      <p class="small muted" style="margin:0">${have ? esc(c.why) : 'Arrives when ' + esc(c.why.replace(/^You /, 'you ').replace(/\.$/, '').replace(/\(.*\)/, '').trim()) + '.'}</p>
      ${have && !starterFixed ? `<button class="btn btn-sm ${placed.has(k) ? 'btn-ghost' : 'btn-soft'}" data-act="place" data-key="${k}" aria-pressed="${placed.has(k)}">${placed.has(k) ? 'Take off our desk' : 'Put on our desk'}</button>` : ''}
    </article>`;
  }).join('');
  const concepts = st.concepts.slice(0, 12);
  return {
    title: 'My Progress', sub: 'What you have done, kept honest. Nothing here is lost if you take a break.', nuru: 'celebrating', wide: true,
    body: `<section aria-labelledby="pr-org"><h2 id="pr-org" class="section-h">Organize</h2><div class="stats">
        ${stat(pr.steps_done, plural(pr.steps_done, 'step').replace(/^\d+ /, '') + ' completed')}${stat(pr.assignments_done, 'assignments finished')}
        ${stat(mins(st.focus_total), 'focus time', 'self-reported, not a measure of learning')}</div></section>
      <section aria-labelledby="pr-learn"><h2 id="pr-learn" class="section-h">Learn &amp; revise</h2><div class="stats">
        ${stat(pr.practice_attempts, 'practice answers', 'you tried a question')}
        ${stat(pr.checked_on_track, 'checked as on track', 'evaluated by live AI or an exact-answer check')}
        ${stat(pr.self_checks, 'self-checks', 'your own rating, not a checked answer')}
        ${stat(pr.revisions_finished, 'revision sessions finished')}</div>
        ${concepts.length ? `<ul class="list compact" style="margin-top:12px">${concepts.map(c => `<li class="item"><div class="main"><div class="title">${esc(c.name)}</div><div class="meta">${plural(c.attempts, 'attempt')}${c.next_review ? ` · review ${c.due ? 'now' : fmtDate(c.next_review)}` : ''}</div></div><span class="status-pill ${c.status}">${{ attempted: 'Attempted', practiced: 'Practised', checked: 'Checked' }[c.status] || c.status}</span></li>`).join('')}</ul>
        <p class="tiny muted">Attempted: you answered once. Practised: several attempts or a self-check. Checked: an answer was evaluated as on track. These are records, not mastery scores.</p>` : '<p class="small muted">Topics you practise will appear here.</p>'}</section>
      <section aria-labelledby="pr-desk"><h2 id="pr-desk" class="section-h">Our desk</h2>
        <p class="small muted">Small things for the desk you share with ${companionName()}, each tied to something you actually did. Grades, check-ins and how much you chat never affect them, and nothing fades if you're away.</p>
        <div class="desk-preview">${sceneSVG()}</div>
        <div class="keepsake-grid">${cards}</div>
        <p class="small"><button class="btn-text" data-nav="space">Change your seat, ${companionName()}'s colour and the view</button></p></section>`,
    mount: () => applyScene(),
  };
}

const seg = (name, value, options, act = 'room-set') => `<div class="seg" role="group" aria-label="${esc(name)}">${options.map(([v, l]) => `<button data-act="${act}" data-field="${name}" data-value="${v}" aria-pressed="${value === v}">${l}</button>`).join('')}</div>`;

function viewSpace() {
  const r = S.state.room, p = S.state.profile, av = p.avatar;
  return {
    title: 'Our study space', sub: 'Your seat, your study buddy and the room around you. Purely for comfort.', nuru: 'welcoming', wide: true,
    body: `<div class="space-preview">${sceneSVG()}</div>
      <div class="space-grid">
      <div class="paper pad"><h3>Your seat</h3>
        <p class="small strong">Skin tone</p>${seg('skin', av.skin, [['s1', 'Light'], ['s2', 'Medium'], ['s3', 'Tan'], ['s4', 'Deep']], 'avatar-set')}
        <p class="small strong">Hair</p>${seg('hair', av.hair, [['short', 'Short'], ['long', 'Long'], ['curly', 'Curly'], ['wrap', 'Head wrap']], 'avatar-set')}
        <p class="small strong">Jumper</p>${seg('outfit', av.outfit, [['lavender', 'Lavender'], ['sage', 'Sage'], ['amber', 'Amber'], ['plum', 'Plum']], 'avatar-set')}</div>
      <div class="paper pad"><h3>${companionName()}'s light</h3><div class="hue-pick" role="group" aria-label="Lantern colour">${['amber', 'lavender', 'sage'].map(h => `<button type="button" data-act="hue-now" data-hue="${h}" aria-pressed="${p.companion_hue === h}">${nuruSVG('welcoming', h)}${h[0].toUpperCase() + h.slice(1)}</button>`).join('')}</div></div>
      <div class="paper pad"><h3>Time of day</h3>${seg('theme', r.theme, [['auto', 'Follow my clock'], ['day', 'Day'], ['evening', 'Evening']])}</div>
      <div class="paper pad"><h3>Outside the window</h3>${seg('scenery', r.scenery, [['garden', 'Campus garden'], ['city', 'Rooftops'], ['rain', 'Rain']])}</div>
      <div class="paper pad"><h3>Desk lamp</h3>${seg('lamp', r.lamp, [['warm', 'Warm'], ['soft', 'Soft'], ['off', 'Off']])}</div>
      <div class="paper pad"><h3>Ambient sound</h3><p class="small muted">Optional, generated in your browser, and never plays on its own.</p>
        ${seg('sound', r.sound, [['off', 'None'], ['rain', 'Rain'], ['hearth', 'Fireplace']])}
        <div class="row" style="margin-top:12px"><button class="btn btn-sm btn-soft" data-act="sound-play" ${r.sound === 'off' ? 'disabled' : ''}>${sound.playing ? icon('pause') + 'Stop' : icon('play') + 'Play'}</button>
        <label class="inline small">Volume<input type="range" min="0" max="100" value="50" id="vol"></label></div></div>
      <div class="paper pad"><h3>Motion</h3><p class="small muted">Animations of you, ${companionName()} and celebrations.</p>${`<div class="seg" role="group" aria-label="Motion">${[['system', 'Follow my device'], ['reduce', 'Reduced'], ['full', 'Full']].map(([v, l]) => `<button data-act="motion-set" data-value="${v}" aria-pressed="${p.motion === v}">${l}</button>`).join('')}</div>`}</div>
      </div>`,
    mount: () => applyScene(),
  };
}

function viewSettings() {
  const st = S.state, p = st.profile;
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [p.timezone]);
  const kinds = { goal: 'Learning goal', preference: 'How I like explanations', revisit: 'Concept to revisit', course: 'Course note' };
  return {
    title: 'Settings & privacy', sub: 'Your space, your rules.', nuru: 'listening',
    body: `<form data-form="settings" class="stack">
      <section class="paper settings-group"><h3>You and your companion</h3><div class="field-grid">
        <label>Your name<input name="name" maxlength="60" value="${esc(p.name)}" required></label>
        <label>Companion's name<input name="companion_name" maxlength="30" value="${esc(p.companion_name)}"></label></div>
        <div style="margin-top:12px"><span class="small" style="font-weight:600">Lantern colour</span><div class="hue-pick" role="group" aria-label="Lantern colour" style="margin-top:6px">
          ${['amber', 'lavender', 'sage'].map(h => `<button type="button" data-act="pick-hue" data-hue="${h}" aria-pressed="${p.companion_hue === h}">${nuruSVG('welcoming', h)}${h[0].toUpperCase() + h.slice(1)}</button>`).join('')}</div><input type="hidden" name="companion_hue" value="${p.companion_hue}"></div>
        <label style="margin-top:12px">Celebrations<select name="celebration"><option value="quiet" ${p.celebration === 'quiet' ? 'selected' : ''}>Quiet acknowledgement only</option><option value="gentle" ${p.celebration === 'gentle' ? 'selected' : ''}>Gentle (Nuru brightens)</option><option value="sparkle" ${p.celebration === 'sparkle' ? 'selected' : ''}>A little paper confetti</option></select></label>
      </section>
      <section class="paper settings-group"><h3>Time and pace</h3><div class="field-grid">
        <label>Minutes available per day<input type="number" name="daily_minutes" min="15" max="360" value="${p.daily_minutes}"></label>
        <label>Usually start at (hour)<input type="number" name="start_hour" min="5" max="22" value="${p.start_hour}"></label>
        <label>Stop by (hour)<input type="number" name="end_hour" min="6" max="23" value="${p.end_hour}"></label>
        <label>Pace<select name="energy"><option value="gentle" ${p.energy === 'gentle' ? 'selected' : ''}>Gentle (up to 60 min/day)</option><option value="balanced" ${p.energy === 'balanced' ? 'selected' : ''}>Balanced (up to 4 h)</option><option value="focused" ${p.energy === 'focused' ? 'selected' : ''}>Focused (up to 6 h)</option></select></label>
        <label>Time zone<select name="timezone">${zones.map(z => `<option ${z === p.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label></div>
      </section>
      <section class="paper settings-group"><h3>Privacy choices</h3><div class="stack">
        <label class="checkline"><input type="checkbox" name="remember_chat" ${p.remember_chat ? 'checked' : ''}><span>Save conversation history between visits<small>Off: conversations last only while this tab is open and nothing is stored. Turning this off deletes saved history straight away.</small></span></label>
        <label class="checkline"><input type="checkbox" name="share_workload" ${p.share_workload ? 'checked' : ''}><span>Share my workload with the AI in general chat<small>Sends assignment titles, due dates and estimates (never grades or check-in notes) so replies can fit your week.</small></span></label>
        <label class="checkline"><input type="checkbox" name="use_memory" ${p.use_memory ? 'checked' : ''}><span>Use learning memory<small>Only items you approve are remembered, and they're listed below. Turning this off forgets every item.</small></span></label>
        <label class="checkline"><input type="checkbox" name="reminders" ${p.reminders ? 'checked' : ''}><span>Show deadline reminders on Today</span></label></div>
      </section>
      <div class="row"><button class="btn btn-primary">Save settings</button></div>
    </form>
    <section class="paper settings-group" style="margin-top:14px" aria-labelledby="mem-title"><h3 id="mem-title">What ${companionName()} remembers</h3>
      ${p.use_memory ? `${st.memory.length ? `<div class="stack" style="gap:8px">${st.memory.map(m => `<div class="memory-row"><span class="tag lav">${kinds[m.kind]}</span><span class="text">${esc(m.text)}</span><button class="icon-btn" data-act="memory-edit" data-id="${m.id}" aria-label="Edit memory">${icon('edit')}</button><button class="icon-btn" data-act="memory-delete" data-id="${m.id}" aria-label="Forget this">${icon('trash')}</button></div>`).join('')}</div>` : `<p class="small muted">Nothing yet. ${companionName()} may suggest something to remember, and it's only saved if you approve it.</p>`}
      <form data-form="memory-add" class="row" style="margin-top:12px"><select name="kind" style="width:auto">${Object.entries(kinds).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><input name="text" maxlength="240" placeholder="e.g. I like examples from everyday life" style="flex:1;min-width:180px" required><button class="btn btn-soft btn-sm">Remember</button></form>
      ${st.memory.length ? '<button class="btn-text" data-act="memory-clear">Forget everything</button>' : ''}` : '<p class="small muted">Learning memory is off.</p>'}
    </section>
    <section class="paper settings-group"><h3>Your data</h3>
      <p class="small muted">Your records are stored in this installation's SQLite database, scoped to your account. The person who runs the installation can technically access that database, so this isn't clinical confidentiality. When live AI is on, the content listed before each request goes to the configured AI provider, which may keep API data under its own policies. Calm Scholar asks it not to store responses, but that one setting doesn't guarantee zero retention.</p>
      <div class="row"><a class="btn btn-ghost btn-sm" href="/api/export/">${icon('download')}Export everything (JSON)</a>
      <button class="btn btn-ghost btn-sm" data-act="wipe" data-what="clear_chat">Clear saved chat</button>
      <button class="btn btn-ghost btn-sm" data-act="wipe" data-what="delete_checkins">Delete check-ins</button>
      <button class="btn btn-ghost btn-sm" data-act="wipe" data-what="results_clear">Delete saved grades</button></div>
    </section>
    <section class="paper settings-group danger-zone"><h3>Delete account</h3><p class="small muted">Removes your account, records and uploaded files from this installation. This can't be undone.</p>
      <form data-form="delete-account" class="row"><input name="confirmation" placeholder="Type DELETE" aria-label="Type DELETE to confirm" style="max-width:200px" autocomplete="off"><button class="btn btn-danger btn-sm">Delete my account</button></form></section>
    <section class="paper settings-group"><h3>About support</h3><p class="small muted">${companionName()} is an AI study buddy, not a therapist, counsellor or emergency service. If you are in immediate danger, contact local emergency services or someone you trust nearby. ${st.support_contact ? 'Support contact added by your installation: ' + esc(st.support_contact) : 'This installation has not added a verified local support contact yet.'}</p></section>`,
  };
}

export function register(V, A, F) {
  Object.assign(V, { progress: viewProgress, keepsakes: () => ({ redirect: '#/progress' }), space: viewSpace, ambience: () => ({ redirect: '#/space' }), settings: viewSettings });
  Object.assign(A, {
    place: b => guarded(b, () => { const k = b.dataset.key, placed = new Set(S.state.room.placed); placed.has(k) ? placed.delete(k) : placed.add(k); return act('room_save', { placed: [...placed] }); }),
    'room-set': b => guarded(b, () => act('room_save', { [b.dataset.field]: b.dataset.value }).then(() => { if (b.dataset.field === 'sound') stopSound(); applyScene(); })),
    'avatar-set': b => guarded(b, () => act('avatar_save', { avatar: { [b.dataset.field]: b.dataset.value } })),
    'hue-now': b => guarded(b, () => act('profile', { companion_hue: b.dataset.hue })),
    'sound-play': () => { if (sound.playing) stopSound(); else playSound(S.state.room.sound, ($('#vol')?.value || 50) / 100); navigate('space'); },
    'motion-set': b => guarded(b, () => act('profile', { motion: b.dataset.value })),
    'pick-hue': b => { document.querySelectorAll('[data-act="pick-hue"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); b.closest('form').querySelector('[name=companion_hue]').value = b.dataset.hue; },
    'memory-delete': b => guarded(b, () => act('memory_delete', { id: +b.dataset.id }, { message: 'Forgotten. It will not be used again.' })),
    'memory-clear': b => { if (confirm('Forget every learning memory item?')) guarded(b, () => act('memory_clear', {}, { message: 'All learning memory forgotten.' })); },
    'memory-edit': b => {
      const m = S.state.memory.find(x => x.id === +b.dataset.id); const t = prompt('Edit what should be remembered:', m.text);
      if (t !== null && t.trim()) guarded(b, () => act('memory_save', { id: m.id, kind: m.kind, text: t.trim() }, { message: 'Updated.' }));
    },
    wipe: b => { const labels = { clear_chat: 'saved chat history', delete_checkins: 'all check-ins', results_clear: 'every saved grade entry' };
      if (confirm(`Delete ${labels[b.dataset.what]}? This can't be undone.`)) guarded(b, async () => { await act(b.dataset.what, {}, { message: 'Deleted.' }); if (b.dataset.what === 'clear_chat') S.chats.clear(); }); },
  });
  Object.assign(F, {
    settings: async (f, d) => {
      const payload = { name: d.name, companion_name: d.companion_name, companion_hue: d.companion_hue, celebration: d.celebration,
        daily_minutes: +d.daily_minutes, start_hour: +d.start_hour, end_hour: +d.end_hour, energy: d.energy, timezone: d.timezone,
        remember_chat: !!d.remember_chat, share_workload: !!d.share_workload, use_memory: !!d.use_memory, reminders: !!d.reminders };
      if (S.state.profile.use_memory && !payload.use_memory && S.state.memory.length && !confirm('Turning off learning memory forgets every saved item. Continue?')) return;
      await act('profile', payload, { message: 'Settings saved.' });
      if (!payload.remember_chat) S.chats.delete('general');
    },
    'memory-add': (f, d) => act('memory_save', { kind: d.kind, text: d.text }, { message: 'Remembered. You can edit or forget it here anytime.' }),
    'delete-account': async (f, d) => {
      if (d.confirmation !== 'DELETE') { toast('Type DELETE to confirm.', { error: true }); return; }
      await act('delete_account', { confirmation: 'DELETE' }); location.href = '/';
    },
  });
}
