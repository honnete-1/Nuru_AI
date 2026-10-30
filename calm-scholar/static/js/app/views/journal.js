/* Grades & Check-ins: feeling-first support around results, and optional check-ins. */
import { S, act, guarded, go, assignment, companionName, rerender } from '../core.js';
import { esc, icon, nuruSVG, fmtDate, toast, $, rich } from '../util.js';
import { setNuru, nuruSay } from '../scene.js';
import { confetti } from '../main.js';

const FEELINGS = [
  ['proud', 'Proud', 'I did well by my own standards'], ['relieved', 'Relieved', "It's done, and it's okay"],
  ['disappointed', 'Disappointed', 'Not what I hoped for'], ['worried', 'Worried', "I'm uneasy about what it means"],
  ['mixed', 'Mixed', 'Some of each'], ['other', 'In my own words', 'Describe it yourself'],
];
const FEEL_LABEL = Object.fromEntries(FEELINGS.map(f => [f[0], f[1]]).concat([['skip', 'Not shared'], ['', 'Not shared']]));
const MOODS = [['overwhelmed', 'Overloaded'], ['low', 'Low'], ['okay', 'Okay'], ['good', 'Good'], ['great', 'Great']];

const newFlow = (assignmentId) => {
  const a = assignmentId ? assignment(assignmentId) : null;
  return { step: 1, data: { title: a?.title || '', course: a?.course || '', assignment_id: a?.id || null, result_kind: 'percent', score: '', out_of: '', result_text: '', goal: '', feedback: '', save: true }, feeling: '', words: '', opening: null, id: null };
};

function tabs(active) {
  return `<div class="seg" role="group" aria-label="Journal section"><button data-go="#/journal" aria-pressed="${active === 'results'}">Grades</button><button data-go="#/journal/checkin" aria-pressed="${active === 'checkin'}">Check-ins</button></div>`;
}

function describe(d) {
  if (d.display) return d.display;
  if (d.result_kind === 'percent') return `${d.score}%`;
  if (d.result_kind === 'points') return `${d.score} / ${d.out_of}`;
  if (d.result_kind === 'text') return d.result_text;
  return 'no mark entered';
}

function viewOverview() {
  const st = S.state;
  return {
    title: 'Grades & Check-ins', sub: 'Private and optional. Nothing here is shown to anyone else or used to rank or reward you.', nuru: 'listening',
    tools: `<button class="btn btn-primary btn-sm" data-act="result-new">${icon('plus')}I got my results</button>`,
    body: `${tabs('results')}
      <p class="small muted" style="margin:14px 0">Write down any result: a percentage, points, a letter or word grade. Add your goal and the lecturer's feedback if you like. ${companionName()} will ask how you feel before saying anything about it. You can also talk without saving anything.</p>
      ${st.results.length ? `<ul class="list">${st.results.map(r => `<li><button class="item clickable result-entry" data-go="#/journal/r/${r.id}">
        <span class="score" style="min-width:74px">${esc(r.result || '·')}</span><span class="main"><span class="title">${esc(r.title)}</span><span class="meta">${esc(r.course || '')}${r.course ? ' · ' : ''}${fmtDate(r.created_at)} · felt: ${esc(FEEL_LABEL[r.feeling] || r.feeling_words || 'not shared')}</span></span></button></li>`).join('')}</ul>`
        : `<div class="empty">${nuruSVG('supporting', st.profile.companion_hue)}<h3>Nothing written here yet</h3><p>When a mark comes back, proud or painful or somewhere in between, this is a quiet place to make sense of it.</p><button class="btn btn-primary" data-act="result-new">Log a result</button></div>`}`,
  };
}

function scaleFields(d) {
  if (d.result_kind === 'percent') return `<label>Percentage<input type="number" name="score" min="0" max="100" step="0.01" value="${esc(d.score)}" required></label>`;
  if (d.result_kind === 'points') return `<div class="field-grid"><label>Points<input type="number" name="score" min="0" step="0.01" value="${esc(d.score)}" required></label><label>Out of<input type="number" name="out_of" min="0.01" step="0.01" value="${esc(d.out_of)}" required></label></div>`;
  if (d.result_kind === 'text') return `<label>Grade as written<input name="result_text" maxlength="60" value="${esc(d.result_text)}" placeholder="e.g. B+, Merit, Pass, 2:1" required></label>`;
  return '<p class="small muted" style="margin:0">That’s fine. You can still talk about it.</p>';
}

function viewNew(params) {
  if (!S.rflow || (params[0] && S.rflow.data.assignment_id !== +params[0] && S.rflow.step === 1)) S.rflow = newFlow(params[0]);
  const F = S.rflow, d = F.data, p = S.state.profile;
  let body = '';
  if (F.step === 1) {
    body = `<form data-form="result-1" class="stack">
      <label>What was it for?<input name="title" maxlength="160" required value="${esc(d.title)}" placeholder="e.g. Essay 2, Midterm, Lab report"></label>
      <label>Course (optional)<input name="course" maxlength="80" value="${esc(d.course)}" list="course-list-r"></label><datalist id="course-list-r">${S.state.courses.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <div><span class="small" style="font-weight:600">How is it marked?</span><div class="seg" role="group" aria-label="Result scale" style="margin-top:6px">${[['percent', 'Percentage'], ['points', 'Points'], ['text', 'Letter or word'], ['none', "I'd rather not enter it"]].map(([k, l]) => `<button type="button" data-act="r-scale" data-kind="${k}" aria-pressed="${d.result_kind === k}">${l}</button>`).join('')}</div></div>
      <div id="scale-fields">${scaleFields(d)}</div>
      <label>Your goal, if you had one (optional)<input name="goal" maxlength="60" value="${esc(d.goal)}" placeholder="e.g. 65%, a pass, to improve on last time"></label>
      <label>Lecturer feedback (optional)<textarea name="feedback" maxlength="4000" placeholder="Paste or summarise any comments.">${esc(d.feedback)}</textarea></label>
      <fieldset class="stack" style="border:0;padding:0;margin:0;gap:8px"><legend class="small" style="font-weight:600;margin-bottom:6px">Keep this?</legend>
        <label class="checkline"><input type="radio" name="save" value="yes" ${d.save ? 'checked' : ''}><span>Save it privately in my grades<small>Only you see it. You can delete it anytime.</small></span></label>
        <label class="checkline"><input type="radio" name="save" value="no" ${!d.save ? 'checked' : ''}><span>Just talk. Don't store this result.<small>Nothing about the result is saved. It disappears when you leave.</small></span></label></fieldset>
      <div class="row"><button class="btn btn-primary">Next</button><button type="button" class="btn-text" data-go="#/journal">Cancel</button></div></form>`;
  } else if (F.step === 2) {
    body = `<div class="opening paper">${nuruSVG('listening', p.companion_hue)}<div><p>Before anything else: how do you feel about it?</p><span class="small muted">Any answer is fine, including none. This only shapes how ${companionName()} responds.</span></div></div>
      <form data-form="result-2" class="stack" style="margin-top:14px">
        <div class="feel-grid" role="group" aria-label="How you feel">${FEELINGS.map(([k, l, s]) => `<button type="button" class="feel" data-act="r-feel" data-feel="${k}" aria-pressed="${F.feeling === k}">${l}<small>${s}</small></button>`).join('')}</div>
        <label ${F.feeling === 'other' ? '' : 'hidden'} id="own-words">In your own words<input name="words" maxlength="200" value="${esc(F.words)}"></label>
        <div class="row"><button class="btn btn-primary" ${F.feeling ? '' : 'disabled'} id="feel-next">Continue</button><button type="button" class="btn-text" data-act="r-skip">I'd rather not say</button><button type="button" class="btn-text" data-act="r-back">Back</button></div></form>`;
  } else if (F.step === 3) {
    const o = F.opening;
    body = `<div class="opening paper">${nuruSVG(o.nuru, p.companion_hue)}<div><p>${esc(o.message)}</p>
      <div class="chips" role="group" aria-label="What would help">${o.options.map(x => `<button class="chip" data-act="r-option" data-opt="${x.key}">${esc(x.label)}</button>`).join('')}</div></div></div>
      <p class="tiny muted" style="margin-top:8px">These opening words come from the app, not from AI. ${F.id ? 'Saved privately in your journal.' : 'This result is not being stored.'}</p>
      <div id="r-extra" aria-live="polite"></div>`;
  }
  return { title: F.step === 3 ? 'Thank you for sharing' : 'A result came back', sub: esc(d.title || ''), back: '#/journal', nuru: F.step === 3 ? F.opening.nuru : 'listening', keepNuru: F.step === 3, body };
}

function consentForm(opt) {
  const F = S.rflow, d = F.data, live = S.state.ai.mode === 'live';
  const hasMark = d.result_kind !== 'none', hasFb = !!d.feedback.trim();
  return `<form data-form="r-consent" data-opt="${opt}" class="paper pad stack" style="margin-top:14px">
    <h3 style="margin:0">${live ? `Before we talk: here's what would be sent to the AI provider` : 'Before we talk'}</h3>
    ${live ? '' : '<p class="small muted" style="margin:0">Demo mode: replies are scripted and nothing leaves this installation. These choices still apply.</p>'}
    <label class="checkline"><input type="checkbox" checked disabled><span>The title and how you said you feel<small>${esc(d.title)} · ${esc(FEEL_LABEL[F.feeling] || F.words || 'not shared')}</small></span></label>
    ${hasMark ? `<label class="checkline"><input type="checkbox" name="score" ${opt === 'plan' ? 'checked' : ''}><span>Your mark and goal<small>${esc(describe(d))}${d.goal ? ' · goal: ' + esc(d.goal) : ''}. Leave this unticked to talk without the number.</small></span></label>` : ''}
    ${hasFb ? `<label class="checkline"><input type="checkbox" name="feedback" ${opt !== 'talk' ? 'checked' : ''}><span>Lecturer feedback<small>${esc(d.feedback.slice(0, 120))}${d.feedback.length > 120 ? '…' : ''}</small></span></label>` : ''}
    <div class="row"><button class="btn btn-primary">Start talking</button><button type="button" class="btn-text" data-act="r-back-opening">Back</button></div></form>`;
}

function viewEntry(id) {
  const r = S.state.results.find(x => String(x.id) === String(id));
  if (!r) return { title: 'Not found', back: '#/journal', body: '<div class="empty"><p>This entry was deleted.</p></div>' };
  return {
    title: esc(r.title), sub: `${esc(r.course || '')} · ${fmtDate(r.created_at, { day: 'numeric', month: 'long', year: 'numeric' })}`, back: '#/journal', nuru: 'listening',
    body: `<div class="paper pad stack">
      <div class="spread"><span class="result-entry"><span class="score">${esc(r.result)}</span></span><span class="tag lav">Felt: ${esc(FEEL_LABEL[r.feeling] || r.feeling_words || 'not shared')}</span></div>
      ${r.goal ? `<p class="small" style="margin:0">Goal: ${esc(r.goal)}</p>` : ''}
      ${r.feedback ? `<div><h4>Lecturer feedback</h4><p style="white-space:pre-wrap;margin:0">${esc(r.feedback)}</p></div>` : ''}
      ${r.helped ? `<div><h4>What helped</h4><p style="margin:0">${esc(r.helped)}</p></div>` : ''}
      ${r.next_focus ? `<div><h4>Next focus</h4><p style="margin:0">${esc(r.next_focus)}</p></div>` : ''}</div>
      <div class="section-title"><h2>Come back to it</h2></div>
      <div class="row"><button class="btn btn-ghost" data-act="r-reopen" data-id="${r.id}">Talk about it with ${companionName()}</button><button class="btn btn-ghost" data-act="r-reopen" data-id="${r.id}" data-opt="feedback">Go through the feedback</button>
      <button class="btn-text" style="color:var(--rose)" data-act="r-delete" data-id="${r.id}">Delete this entry</button></div>`,
  };
}

function viewCheckin() {
  const st = S.state;
  S.mood = S.mood || '';
  return {
    title: 'Grades & Check-ins', sub: 'Check-ins are optional and never affect your plan, rewards or anything else unless you choose.', nuru: 'listening',
    body: `${tabs('checkin')}
      <form data-form="checkin" class="paper pad stack" style="margin-top:14px">
        <div><span class="small" style="font-weight:600">How's today feeling?</span><div class="chips" role="group" aria-label="Mood" style="margin-top:8px">${MOODS.map(([k, l]) => `<button type="button" class="chip" data-act="mood" data-mood="${k}" aria-pressed="${S.mood === k}">${l}</button>`).join('')}</div></div>
        <div><span class="small" style="font-weight:600">Energy for study</span><div class="seg" role="group" style="margin-top:8px">${['gentle', 'balanced', 'focused'].map(v => `<label class="toggle-mini"><input type="radio" name="energy" value="${v}" ${st.profile.energy === v ? 'checked' : ''}>${v[0].toUpperCase() + v.slice(1)}</label>`).join('')}</div></div>
        <label class="checkline"><input type="checkbox" name="apply_pace"><span>Also use this energy as my planning pace<small>Leave unticked to keep your plan as it is.</small></span></label>
        <label>A private note (optional)<textarea name="note" maxlength="1000" placeholder="Only you can see this. It is never sent to the AI."></textarea></label>
        <div class="row"><button class="btn btn-primary">Save check-in</button></div></form>
      ${st.checkins.length ? `<div class="section-title"><h2>Earlier</h2><button class="btn-text" data-act="wipe" data-what="delete_checkins">Delete all</button></div>
      <ul class="list">${st.checkins.map(c => `<li class="item"><div class="main"><div class="title">${esc((MOODS.find(m => m[0] === c.mood) || [0, c.mood])[1])} · ${esc(c.energy)}</div><div class="meta">${fmtDate(c.created_at)}${c.note ? ' · ' + esc(c.note.slice(0, 120)) : ''}</div></div></li>`).join('')}</ul>` : ''}`,
  };
}

function goTalk(opt, share) {
  const F = S.rflow, d = F.data;
  const intent = opt === 'feedback' ? 'result_feedback' : opt === 'plan' ? 'result_plan' : opt === 'question' ? 'result_question' : 'result_talk';
  const sends = ['the result title and how you feel'];
  if (share.score) sends.push('your mark and goal');
  if (share.feedback) sends.push('lecturer feedback');
  const ctx = F.id ? { type: 'result', id: F.id, share } : { type: 'result_temp', share, result: { ...d, feeling: F.feeling === 'other' ? 'other' : F.feeling, feeling_words: F.words } };
  if (!F.id) delete ctx.result.save;
  const prefill = { result_feedback: 'Could we look through the feedback together?', result_plan: 'Could we work out one small next step from this?', result_question: 'Could you help me prepare one question to ask my lecturer about this feedback?', result_talk: '' }[intent];
  S.resultCtx = { id: F.id, saved: !!F.id, title: d.title, context: ctx, sends, prefill };
  S.chats.delete(`r:${F.id || 'temp'}`);
  location.hash = `#/companion/r/${intent}`;
}

export function register(V, A, F_) {
  V.journal = params => params[0] === 'new' ? viewNew(params.slice(1)) : params[0] === 'checkin' ? viewCheckin() : params[0] === 'r' ? viewEntry(params[1]) : viewOverview();
  Object.assign(A, {
    'result-new': () => { S.rflow = newFlow(); go('#/journal/new'); },
    'r-scale': b => { const f = b.closest('form'); S.rflow.data = { ...S.rflow.data, ...Object.fromEntries(new FormData(f)), save: f.save.value !== 'no', result_kind: b.dataset.kind }; rerender(); },
    'r-feel': b => { S.rflow.feeling = b.dataset.feel; document.querySelectorAll('[data-act="r-feel"]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('#own-words').hidden = b.dataset.feel !== 'other'; $('#feel-next').disabled = false; if (b.dataset.feel === 'other') $('#own-words input').focus(); },
    'r-skip': b => guarded(b, () => openResult('skip', '')),
    'r-back': () => { S.rflow.step = 1; rerender(); },
    'r-back-opening': () => { $('#r-extra').innerHTML = ''; },
    'r-option': b => {
      const opt = b.dataset.opt, F = S.rflow, extra = $('#r-extra');
      document.querySelectorAll('[data-act="r-option"]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      if (F.id) act('result_update', { id: F.id, support: opt }, { render: false }).catch(() => {});
      if (['talk', 'feedback', 'question', 'plan'].includes(opt)) { extra.innerHTML = consentForm(opt); extra.querySelector('button').focus(); return; }
      if (opt === 'pause') { setNuru('supporting'); extra.innerHTML = `<div class="notice lav" style="margin-top:14px">${icon('heart')}<p>That's completely okay. ${F.id ? "It's saved in your journal for whenever you want to come back to it." : 'Nothing was stored.'} Maybe step away for a bit, get some fresh air, or check in with someone you trust.</p></div><div class="row" style="margin-top:10px"><button class="btn btn-ghost" data-nav="home">Back to Today</button></div>`; return; }
      if (opt === 'celebrate') { setNuru('celebrating'); confetti(); extra.innerHTML = `<div class="notice sage" style="margin-top:14px"><p>Here's to that. Take a moment with it; there's no rush to turn it into the next goal.</p></div>${strategyForm()}`; nuruSay('A good moment. Enjoy it.', 'celebrating', { ms: 6000 }); return; }
      if (opt === 'quiet') { setNuru('welcoming'); extra.innerHTML = `<div class="notice" style="margin-top:14px"><p>Noted, quietly. That's yours.</p></div>`; return; }
      if (opt === 'strategy') { extra.innerHTML = strategyForm(); extra.querySelector('textarea').focus(); return; }
      if (opt === 'break') { setNuru('studying'); extra.innerHTML = `<div class="notice sage" style="margin-top:14px"><p>A break is a good choice. Stand up, stretch, have a drink of water, maybe tell someone how it went. Nuru will be here when you come back.</p></div>`; return; }
      if (opt === 'next_goal') { extra.innerHTML = `<form data-form="r-next" class="paper pad stack" style="margin-top:14px"><label>Is there anything you'd like to focus on next? (No pressure for a higher mark.)<input name="next_focus" maxlength="240" placeholder="e.g. start the next essay earlier, ask about referencing"></label><div class="row"><button class="btn btn-primary btn-sm">Keep this</button></div></form>`; }
    },
    'r-reopen': b => {
      const r = S.state.results.find(x => x.id === +b.dataset.id);
      S.rflow = { step: 3, id: r.id, feeling: r.feeling, words: r.feeling_words, opening: null, data: { title: r.title, course: r.course, result_kind: r.result_kind, score: '', out_of: '', result_text: r.result, goal: r.goal, feedback: r.feedback, assignment_id: r.assignment_id } };
      S.rflow.data.display = r.result; // the saved record is read from the server by id
      const opt = b.dataset.opt || 'talk';
      S.rflow.opening = { nuru: 'listening', message: 'Welcome back to this one. What would help today?', options: [{ key: 'talk', label: 'Talk about it' }, { key: 'feedback', label: 'Look at the feedback' }, { key: 'question', label: 'Prepare a question for my lecturer' }, { key: 'plan', label: 'Plan one next step' }, { key: 'strategy', label: 'Record what helped' }] };
      go('#/journal/new'); setTimeout(() => document.querySelector(`[data-act="r-option"][data-opt="${opt}"]`)?.click(), 120);
    },
    'r-delete': b => { if (confirm('Delete this journal entry? This removes the result and feedback.')) guarded(b, async () => { await act('result_delete', { id: +b.dataset.id }, { render: false, message: 'Deleted from your journal.' }); go('#/journal'); }); },
    mood: b => { S.mood = S.mood === b.dataset.mood ? '' : b.dataset.mood; document.querySelectorAll('[data-act="mood"]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mood === S.mood))); },
  });
  Object.assign(F_, {
    'result-1': async (f, d) => {
      S.rflow.data = { ...S.rflow.data, ...d, save: d.save !== 'no' };
      if (S.rflow.data.result_kind === 'points' && +d.score > +d.out_of) { toast('Points can’t be more than the total.', { error: true }); return; }
      S.rflow.step = 2; rerender();
    },
    'result-2': async (f, d) => { if (!S.rflow.feeling) return; await openResult(S.rflow.feeling, d.words || ''); },
    'r-consent': async (f, d) => goTalk(f.dataset.opt, { score: !!d.score, feedback: !!d.feedback }),
    'r-strategy': async (f, d) => {
      const F = S.rflow;
      if (F.id) await act('result_update', { id: F.id, helped: d.helped }, { render: false });
      if (d.remember && S.state.profile.use_memory && d.helped.trim()) await act('memory_save', { kind: 'preference', text: ('What helps me: ' + d.helped.trim()).slice(0, 240) }, { render: false });
      f.outerHTML = `<div class="notice sage" style="margin-top:12px"><p>${F.id ? 'Saved with this result.' : 'Thanks for noting it.'}${d.remember ? ' Also added to your learning memory.' : ''} Worth remembering next time.</p></div>`;
    },
    'r-next': async (f, d) => { const F = S.rflow; if (F.id) await act('result_update', { id: F.id, next_focus: d.next_focus }, { render: false }); f.outerHTML = `<div class="notice" style="margin-top:12px"><p>${F.id ? 'Kept with this entry.' : 'Noted, though not stored, as you asked.'} You can turn it into a step in Assignments & Study Plan whenever you're ready.</p></div>`; },
    checkin: async (f, d) => {
      await act('checkin', { mood: S.mood || 'okay', energy: d.energy, note: d.note, apply_pace: !!d.apply_pace }, { message: 'Check-in saved. Thank you for pausing.' });
      S.mood = '';
    },
  });
}

function strategyForm() {
  const mem = S.state.profile.use_memory;
  return `<form data-form="r-strategy" class="paper pad stack" style="margin-top:14px"><label>What do you think helped most this time?<textarea name="helped" maxlength="2000" placeholder="e.g. starting early, the practice quiz, asking a classmate"></textarea></label>
    ${mem ? '<label class="checkline"><input type="checkbox" name="remember"><span>Also remember this as something that helps me<small>Adds one learning-memory item you can edit or forget in Settings.</small></span></label>' : ''}
    <div class="row"><button class="btn btn-primary btn-sm">Keep it</button></div></form>`;
}

async function openResult(feeling, words) {
  const F = S.rflow, d = F.data;
  F.feeling = feeling; F.words = words;
  const payload = { title: d.title, course: d.course, assignment_id: d.assignment_id, result_kind: d.result_kind, score: d.score, out_of: d.out_of, result_text: d.result_text, goal: d.goal, feedback: d.feedback, feeling, feeling_words: words, save: !!d.save };
  const r = await act('result_open', payload, { render: false });
  F.opening = r.opening; F.id = r.saved ? r.result_id : null; F.step = 3;
  const { setState } = await import('../core.js'); if (r.state) setState(r.state);
  else rerender();
}
