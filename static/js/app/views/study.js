/* Study Together: the student and Nuru side by side, the work in the middle.
   One layout for every kind of work: an assignment step, notes, understanding a topic, or revision.
   The notebook is central; the companion panel sits beside it and can collapse during focused work. */
import { S, act, guarded, go, assignment, course, companionName, rerender, saveDrafts } from '../core.js';
import { esc, icon, mins, plural, dueText, fmtDate, STAGES, toast, $, nuruSVG } from '../util.js';
import { sceneSVG, applyScene, setNuru, nuruSay } from '../scene.js';
import { getMaterialPassages } from '../api.js';
import { chatPanel, mountChat, contextFor, feedbackBlock, learnBody, sendChat } from './companion.js';
import { focusCard, openFocusSetup, sizeFor, refresh as refreshFocus } from '../focus.js';

const stageName = k => (STAGES.find(s => s[0] === k) || STAGES[1])[1];
let collapsed = (() => { try { return localStorage.getItem('cs-companion') === 'collapsed'; } catch { return false; } })();
let sheetOpen = false;
const QUESTIONS_FOR = { 10: 2, 20: 3, 30: 4, 45: 6 };

/** Remember where we stopped (server-side, so Today can offer "Continue" on any device). */
function remember(payload) {
  const r = S.state.resume || {};
  const same = r.kind === payload.kind && String(r.id ?? '') === String(payload.id ?? '') && String(r.step_id ?? '') === String(payload.step_id ?? '') && (r.title === payload.topic || !payload.topic);
  if (same) return;
  S.state.resume = { kind: payload.kind, id: payload.id, step_id: payload.step_id || null, title: payload.topic || r.title };
  act('resume_save', payload, { render: false }).then(res => { if (res.state) S.state.resume = res.state.resume; }).catch(() => {});
}

function layout({ task, notebook, ctxParams, nuru = 'listening', switchLabel = 'Switch task' }) {
  const c = contextFor(ctxParams);
  const name = companionName();
  return `<div class="study ${collapsed ? 'is-collapsed' : ''} ${sheetOpen ? 'sheet-open' : ''}">
    <div class="study-scene" aria-hidden="false">${sceneSVG({ nuru, label: `You and ${S.state.profile.companion_name} studying side by side at a shared desk` })}
      <p class="scene-caption"><span class="lamp-dot"></span>${task ? `Working on <b>${task}</b>` : `${name} is sitting with you. Choose what to work on.`}</p></div>
    <div class="session-bar" role="group" aria-label="Session">
      <button class="btn btn-ghost btn-sm" data-go="#/study">${icon('reset')}${switchLabel}</button>
      <button class="btn btn-ghost btn-sm" data-act="help-here" aria-controls="companion">${icon('chat')}Help me here</button>
      <button class="btn-text" data-go="#/home">Back to Today</button>
    </div>
    <div class="study-grid">
      <section class="notebook paper" aria-labelledby="nb-title">${notebook}</section>
      <aside class="companion" id="companion" aria-label="${name}, your AI study buddy">
        <div class="companion-head">
          <span class="companion-nuru">${nuruSVG(nuru, S.state.profile.companion_hue, '', '')}</span>
          <div class="companion-title"><b>${name}</b><span class="tiny muted">AI study buddy</span></div>
          <button class="btn btn-lamp btn-sm help-here" data-act="help-here">${icon('spark')}Help me here</button>
          <button class="icon-btn collapse-btn" data-act="companion-collapse" aria-expanded="${!collapsed}" aria-label="${collapsed ? `Show ${name}` : `Hide ${name} while I focus`}">${icon(collapsed ? 'chat' : 'close')}</button>
        </div>
        <p class="companion-say" role="status" aria-live="polite" hidden></p>
        <div class="companion-body">${chatPanel(c, ctxParams, { compact: true })}</div>
      </aside>
    </div>
    <button class="help-fab" data-act="help-here" aria-controls="companion" aria-expanded="${sheetOpen}">${nuruSVG(nuru, S.state.profile.companion_hue)}<span>Help me here</span></button>
  </div>`;
}

function mountLayout(root, ctxParams, focusChat = false) {
  applyScene();
  refreshFocus();
  mountChat(root, contextFor(ctxParams), { focusInput: focusChat });
}

/* ---------- picker: what are we working on? ---------- */
function viewPicker() {
  const st = S.state, r = st.resume;
  const open = st.assignments.filter(a => !a.completed);
  const ready = st.materials.filter(m => m.status === 'ready');
  const notebook = `<h2 id="nb-title" class="nb-h">What shall we work on?</h2>
    ${r ? `<div class="pick-continue"><span class="kicker">Continue where we stopped</span><b>${esc(r.step || r.title)}</b>${r.step ? `<span class="muted small">${esc(r.title)}</span>` : ''}<button class="btn btn-lamp btn-sm" data-act="continue">Continue</button></div>` : ''}
    <div class="pick-group"><h3>An assignment</h3>
      ${open.length ? `<ul class="list">${open.slice(0, 6).map(a => { const d = dueText(a.due, st.today); const next = a.steps.find(s => !s.completed);
        return `<li><button class="item clickable" data-go="#/study/a/${a.id}${next ? '/s/' + next.id : ''}"><span class="main"><span class="title">${esc(a.title)}</span><span class="meta">${next ? 'Next: ' + esc(next.title) : a.steps.length ? 'All steps done' : 'No steps yet'}</span></span><span class="tag ${d.tone}">${d.text}</span></button></li>`; }).join('')}</ul>`
        : `<div class="empty small"><p>No open assignments yet.</p><button class="btn btn-soft btn-sm" data-act="new-assignment">${icon('plus')}Add an assignment</button></div>`}</div>
    <div class="pick-group two">
      <div><h3>Understand something</h3><form data-form="pick-understand" class="row"><label class="sr-only" for="pick-topic">Topic</label><input id="pick-topic" name="topic" maxlength="200" required placeholder="e.g. standard deviation"><button class="btn btn-soft btn-sm">Explain it</button></form></div>
      <div><h3>Revise with ${companionName()}</h3><p class="small muted">Recall first, then feedback, then a related question.</p><button class="btn btn-soft btn-sm" data-go="#/study/revise">${icon('spark')}Start revising</button></div>
    </div>
    <div class="pick-group"><h3>My notes</h3>
      ${ready.length ? `<div class="chips">${ready.slice(0, 8).map(m => `<button class="chip" data-go="#/study/m/${m.id}">${icon('book')}${esc(m.title)}</button>`).join('')}</div>` : `<p class="small muted">No notes yet. <button class="btn-text" data-go="#/library">Add notes</button></p>`}</div>
    <details class="disclose pick-group"><summary>Focus on my own goal</summary><div style="margin-top:10px">${openFocusSetup()}</div></details>
    <div data-focus-slot></div>`;
  return { title: 'Study Together', sub: 'Pick something; we will work on it side by side.', wide: true, bodyClass: 'study-body', nuru: 'welcoming',
    body: layout({ task: '', notebook, ctxParams: [], nuru: 'welcoming' }), mount: root => mountLayout(root, []) };
}

/* ---------- assignment workbench ---------- */
function viewAssignment(id, stepId) {
  const a = assignment(id);
  if (!a) return { title: 'Study Together', wide: true, body: `<div class="empty"><p>This assignment isn't available any more.</p><button class="btn btn-primary" data-go="#/study">Choose something else</button></div>` };
  const st = S.state, d = dueText(a.due, st.today);
  const step = stepId ? a.steps.find(s => String(s.id) === String(stepId)) : null;
  const done = a.steps.filter(s => s.completed).length;
  const nextOpen = a.steps.find(s => !s.completed && s.id !== step?.id);
  const ctxParams = step ? ['a', a.id, 's', step.id] : ['a', a.id];
  const notesKey = 'wnotes:' + a.id;
  const notes = S.drafts.has(notesKey) ? S.drafts.get(notesKey) : a.working_notes;
  const list = a.steps.length ? `<ol class="checklist">${a.steps.map(s => `<li class="${s.completed ? 'done' : ''} ${step?.id === s.id ? 'current' : ''}">
      <button class="check ${s.completed ? 'on' : ''}" data-act="step-toggle" data-id="${s.id}" aria-pressed="${s.completed}" aria-label="${s.completed ? 'Mark not done' : 'Mark done'}: ${esc(s.title)}">${s.completed ? icon('check') : ''}</button>
      <span class="main"><span class="title">${esc(s.title)}</span><span class="meta">${stageName(s.stage)} · ${mins(s.minutes)}</span></span>
      ${step?.id === s.id ? '<span class="tag amber">Working on this</span>' : s.completed ? '' : `<button class="btn btn-sm btn-soft" data-go="#/study/a/${a.id}/s/${s.id}">Work on this</button>`}</li>`).join('')}</ol>`
    : `<div class="empty small"><p>No steps yet. Smaller steps are easier to start.</p><div class="row" style="justify-content:center"><button class="btn btn-lamp btn-sm" data-act="breakdown" data-id="${a.id}">${icon('spark')}Suggest steps</button><button class="btn btn-ghost btn-sm" data-go="#/plan/a/${a.id}">Add my own</button></div></div>`;
  const current = step ? `<div class="current-step">
      <span class="kicker">${step.completed ? 'Done' : 'Now'}</span><h3>${esc(step.title)}</h3>
      <div class="row">
        ${step.completed ? (nextOpen ? `<button class="btn btn-lamp btn-sm" data-go="#/study/a/${a.id}/s/${nextOpen.id}">Next step: ${esc(nextOpen.title)}</button>` : '<span class="small">Every step is done. Well carried.</span>')
          : `<button class="btn btn-lamp btn-sm" data-act="focus-start" data-goal="${esc(step.title)}" data-assignment="${a.id}" data-step="${step.id}" data-minutes="${sizeFor(step.minutes)}">${icon('play')}Start a ${sizeFor(step.minutes)}-minute focus</button>
             <button class="btn btn-ghost btn-sm" data-act="step-toggle" data-id="${step.id}">${icon('check')}Mark done</button>`}
        <button class="btn btn-ghost btn-sm" data-act="help-here">${icon('chat')}Ask ${companionName()} about this step</button>
      </div></div>` : (a.steps.length ? `<p class="small muted">Choose one step to work on. ${companionName()} will help with that step without losing your place.</p>` : '');
  const notebook = `<div class="nb-top"><span class="tag">${esc(a.course)}</span><span class="tag ${d.tone}">${d.text}</span>${a.priority === 'high' ? '<span class="tag rose">High priority</span>' : ''}
      <button class="btn-text" data-go="#/plan/a/${a.id}">Edit assignment</button></div>
    <h2 id="nb-title" class="nb-h">${esc(a.title)}</h2>
    ${a.description ? `<details class="disclose brief"><summary>The brief</summary><p>${esc(a.description)}</p></details>` : ''}
    ${current}
    <div data-focus-slot></div>
    <div class="nb-section"><div class="spread"><h3>Checklist</h3><span class="tiny muted">${a.steps.length ? `${done} of ${a.steps.length} done` : ''}</span></div>
      ${a.steps.length ? `<div class="progress-line" aria-hidden="true"><span style="width:${Math.round(done / a.steps.length * 100)}%"></span></div>` : ''}${list}</div>
    <div class="nb-section"><div class="spread"><h3><label for="wnotes">My working notes</label></h3><span class="tiny muted" id="wnotes-status" aria-live="polite">${a.working_notes ? 'Saved' : 'Saved automatically'}</span></div>
      <textarea id="wnotes" class="ruled" maxlength="20000" rows="7" placeholder="Jot ideas, quotes to check, questions for your lecturer… This is your page; ${companionName()} only sees it if you paste it into a message.">${esc(notes)}</textarea></div>`;
  return { title: 'Study Together', sub: esc(a.title), wide: true, bodyClass: 'study-body', nuru: 'studying',
    body: layout({ task: esc(step ? step.title : a.title), notebook, ctxParams, nuru: 'studying' }),
    mount: root => {
      mountLayout(root, ctxParams);
      remember({ kind: 'assignment', id: a.id, step_id: step && !step.completed ? step.id : null });
      const ta = $('#wnotes', root), status = $('#wnotes-status', root);
      let timer;
      ta.addEventListener('input', () => {
        S.drafts.set(notesKey, ta.value); saveDrafts(); status.textContent = 'Saving…'; clearTimeout(timer);
        timer = setTimeout(async () => {
          try { await act('working_notes', { id: a.id, notes: ta.value }, { render: false }); a.working_notes = ta.value; if (S.drafts.get(notesKey) === ta.value) { S.drafts.delete(notesKey); saveDrafts(); } status.textContent = 'Saved'; }
          catch (e) { status.textContent = 'Not saved yet. Your text is kept here; keep typing to retry.'; }
        }, 1200);
      });
    } };
}

/* ---------- notes reader ---------- */
function viewMaterial(id, passageId) {
  const m = S.state.materials.find(x => String(x.id) === String(id));
  if (!m) return { title: 'Study Together', wide: true, body: `<div class="empty"><p>These notes were deleted.</p><button class="btn btn-primary" data-go="#/study">Choose something else</button></div>` };
  const ctxParams = passageId ? ['p', passageId] : ['m', m.id];
  const notebook = `<div class="nb-top"><span class="tag">${m.kind.toUpperCase()}</span>${m.course_id && course(m.course_id) ? `<span class="tag lav">${esc(course(m.course_id).name)}</span>` : ''}
      <button class="btn-text" data-act="revise-these" data-id="${m.id}">Revise these notes</button></div>
    <h2 id="nb-title" class="nb-h">${esc(m.title)}</h2>
    ${m.status !== 'ready' ? `<div class="notice">${icon('info')}<p>${esc(m.status_detail)}</p></div>` : `<p class="small muted">Select a passage and ${companionName()} can explain it, with a citation back to this exact text.</p>
    <div id="passages" class="passages"><div class="typing"><i></i><i></i><i></i></div></div>`}`;
  return { title: 'Study Together', sub: esc(m.title), wide: true, bodyClass: 'study-body', nuru: 'explaining',
    body: layout({ task: esc(m.title), notebook, ctxParams, nuru: 'explaining' }),
    mount: async root => {
      mountLayout(root, ctxParams);
      remember({ kind: 'material', id: m.id });
      if (m.status !== 'ready') return;
      try {
        const r = await getMaterialPassages(m.id);
        r.passages.forEach(p => S.passages.set(String(p.id), { ...p, material: m.title }));
        const box = $('#passages', root); if (!box) return;
        box.innerHTML = r.passages.map(p => `<div class="passage-pick ${String(p.id) === String(passageId) ? 'selected' : ''}"><p>${p.page ? `<b>Page ${p.page}</b> · ` : ''}${esc(p.text)}</p>
          ${String(p.id) === String(passageId) ? `<span class="tag sage">Selected · shared with ${companionName()} when you ask</span>` : `<button class="btn btn-sm btn-soft" data-go="#/study/m/${m.id}/p/${p.id}">Select this passage</button>`}</div>`).join('')
          + (r.total > r.passages.length ? `<p class="tiny muted">Showing ${r.passages.length} of ${r.total} passages.</p>` : '');
        if (passageId) { const ctx = contextFor(ctxParams); const chip = root.querySelector('.context-chip b'); if (chip) chip.textContent = ctx.label; }
      } catch (e) { const box = $('#passages', root); if (box) box.innerHTML = `<p class="small">${esc(e.message)}</p>`; }
    } };
}

/* ---------- understand something (explanation first) ---------- */
function viewUnderstand(params) {
  const notebook = `<h2 id="nb-title" class="nb-h">Help me understand${S.learn.topic && S.learn.step > 1 ? `: ${esc(S.learn.topic)}` : ' something'}</h2>${learnBody(params)}`;
  return { title: 'Study Together', sub: 'Understand something together', wide: true, bodyClass: 'study-body', nuru: 'explaining', keepNuru: S.learn.step > 1,
    body: layout({ task: S.learn.topic ? esc(S.learn.topic) : '', notebook, ctxParams: [], nuru: 'explaining' }),
    mount: root => { mountLayout(root, []); if (S.learn.step > 1) { const nb = root.querySelector('.notebook'); nb.scrollTop = nb.scrollHeight; } } };
}

/* ---------- Revise with Nuru (recall first) ---------- */
function reviseSetup() {
  const st = S.state, pre = S.reviseSetup || {};
  const ready = st.materials.filter(m => m.status === 'ready');
  const due = st.concepts.filter(c => c.due);
  const open = st.revisions.find(r => !r.finished);
  return `<h2 id="nb-title" class="nb-h">Revise with ${companionName()}</h2>
    <ol class="journey" aria-label="How revision works"><li>You try a question first</li><li>Feedback, hints or an example</li><li>A related question</li><li>A summary and a later review</li></ol>
    ${open ? `<div class="pick-continue"><span class="kicker">Unfinished revision</span><b>${esc(open.topic)}</b><button class="btn btn-soft btn-sm" data-act="revise-continue" data-id="${open.id}">Continue</button></div>` : ''}
    <form data-form="revise-start" class="stack">
      <div class="field-grid"><label>Course (optional)<select name="course_id"><option value="">Any course</option>${st.courses.map(c => `<option value="${c.id}" ${String(pre.course_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label>Topic<input name="topic" maxlength="120" required list="concept-list" value="${esc(pre.topic || '')}" placeholder="e.g. limiting factors"></label></div>
      <datalist id="concept-list">${st.concepts.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
      ${due.length ? `<div><span class="small strong">Ready to revisit</span><div class="chips" style="margin-top:6px">${due.map(c => `<button type="button" class="chip" data-act="revise-topic" data-topic="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div></div>` : ''}
      <fieldset class="bare"><legend class="small strong">Notes to use (optional)</legend>
        ${ready.length ? `<div class="chips">${ready.map(m => `<label class="chip"><input type="checkbox" name="material" value="${m.id}" ${(pre.material_ids || []).includes(m.id) ? 'checked' : ''}> ${esc(m.title)}</label>`).join('')}</div>` : `<p class="small muted" style="margin:0">No notes yet, so questions will be general. You can add notes in My Notes &amp; Courses.</p>`}</fieldset>
      <div class="field-grid"><fieldset class="bare"><legend class="small strong">Time I have</legend><div class="chips">${[10, 20, 30, 45].map(m => `<label class="chip"><input type="radio" name="minutes" value="${m}" ${m === 20 ? 'checked' : ''}> ${m} min</label>`).join('')}</div></fieldset>
        <label>Assessment date (optional)<input type="date" name="assessment_date" min="${st.today}"><span class="hint">Reviews are scheduled before it. No readiness predictions.</span></label></div>
      <div class="row"><button class="btn btn-lamp">${icon('spark')}Start with a question</button></div>
    </form>`;
}

function reviseSession() {
  const R = S.revise, total = QUESTIONS_FOR[R.minutes] || 3;
  const past = R.attempts.map((x, i) => `<details class="disclose past"><summary>Question ${i + 1}: ${esc(x.question.slice(0, 80))}${x.question.length > 80 ? '…' : ''}</summary><p class="small"><b>Your answer:</b> ${esc(x.answer)}</p>${feedbackBlock(x.feedback)}</details>`).join('');
  let stage = '';
  if (R.phase === 'loading') stage = `<div class="typing" aria-label="${companionName()} is preparing a question"><i></i><i></i><i></i></div>`;
  else if (R.phase === 'question') {
    stage = `<form data-form="revise-answer" class="stack"><div><span class="jtab">Question ${R.attempts.length + 1} of about ${total}</span> ${R.qMode ? modeTag(R.qMode) : ''}<p class="question-text">${esc(R.question)}</p></div>
      <label>Your answer, before any explanation<textarea name="answer" maxlength="3000" required placeholder="Say what you remember and why. Unsure is fine.">${esc(S.drafts.get('rev-answer:' + R.id) || '')}</textarea></label>
      <div class="row"><button class="btn btn-primary">Check my answer</button><button type="button" class="btn-text" data-act="revise-hint">I'm stuck: a hint, not the answer</button><button type="button" class="btn-text" data-act="revise-next">A different question</button></div></form>`;
  } else if (R.phase === 'answered') {
    const last = R.attempts.at(-1);
    stage = `${feedbackBlock(last.feedback)}
      <div class="row" style="margin-top:10px"><button class="btn btn-lamp btn-sm" data-act="revise-next">Try a related question</button>
        <button class="btn btn-ghost btn-sm" data-act="revise-ask" data-intent="tutor_worked" data-text="Show me a worked example about ${esc(R.topic)}">Show a worked example</button>
        <button class="btn btn-ghost btn-sm" data-act="revise-ask" data-intent="tutor_explain" data-text="Explain ${esc(R.topic)} another way">Explain it</button>
        <button class="btn-text" data-act="revise-finish">Finish and summarise</button></div>`;
  } else if (R.phase === 'finish') {
    stage = `<form data-form="revise-finish" class="stack"><h3>Before we wrap up: how confident do you feel?</h3><p class="small muted" style="margin:0">Self-reported, so you can plan reviews. It isn't a score.</p>
      <div class="chips" role="radiogroup" aria-label="Confidence">${[['low', 'Not yet confident'], ['some', 'Somewhat'], ['good', 'Fairly confident']].map(([k, l]) => `<label class="chip"><input type="radio" name="confidence" value="${k}" ${k === 'some' ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="row"><button class="btn btn-primary">See my summary</button><button type="button" class="btn-text" data-act="revise-back">Keep practising</button></div></form>`;
  } else if (R.phase === 'summary') {
    const s = R.summary;
    stage = `<div class="summary"><h3>What we practised: ${esc(s.topic)}</h3>
      <ul class="facts"><li><b>${s.questions}</b> ${s.questions === 1 ? 'question' : 'questions'} attempted</li>
        <li><b>${s.checked_on_track}</b> answer${s.checked_on_track === 1 ? '' : 's'} checked by AI as on track${S.state.ai.mode === 'live' ? '' : ' (demo mode cannot check answers)'}</li>
        <li><b>${s.self_checks}</b> self-check${s.self_checks === 1 ? '' : 's'} (your own rating)</li>
        ${s.flagged ? `<li><b>${s.flagged}</b> feedback flagged as possibly wrong, not counted</li>` : ''}
        <li>Your confidence: <b>${{ low: 'not yet confident', some: 'somewhat', good: 'fairly confident' }[s.confidence] || 'not shared'}</b> (self-reported)</li></ul>
      ${s.next_review ? `<p>Let's revisit this on <b>${fmtDate(s.next_review, { weekday: 'long', day: 'numeric', month: 'long' })}</b>${s.assessment_date ? `, before your assessment on ${fmtDate(s.assessment_date, { day: 'numeric', month: 'long' })}` : ''}.</p>` : ''}
      <p class="tiny muted">These are practice records, not a mastery score or a prediction of any exam result.</p>
      <div class="row"><button class="btn btn-lamp btn-sm" data-act="revise-new">Revise another topic</button><button class="btn btn-ghost btn-sm" data-go="#/home">Back to Today</button></div></div>`;
  }
  return `<div class="nb-top"><span class="tag lav">Revision</span><span class="tag">${R.minutes} min</span>${R.assessment ? `<span class="tag amber">Assessment ${fmtDate(R.assessment, { day: 'numeric', month: 'short' })}</span>` : ''}</div>
    <h2 id="nb-title" class="nb-h">${esc(R.topic)}</h2>${past}${stage}`;
}

const modeTag = m => m === 'live' ? '<span class="tag sage">Live AI question</span>' : m === 'fallback' ? '<span class="tag rose">Fallback: scripted question</span>' : '<span class="tag amber">Demo: scripted question</span>';

function viewRevise() {
  const R = S.revise;
  const ctxParams = R ? ['rev', R.id] : [];
  return { title: 'Study Together', sub: `Revise with ${companionName()}`, wide: true, bodyClass: 'study-body', nuru: R ? 'listening' : 'welcoming', keepNuru: !!R,
    body: layout({ task: R ? esc(R.topic) : '', notebook: R ? reviseSession() : reviseSetup(), ctxParams, nuru: 'listening' }),
    mount: root => {
      mountLayout(root, ctxParams);
      const ta = root.querySelector('form[data-form="revise-answer"] textarea');
      if (ta) { ta.addEventListener('input', () => { S.drafts.set('rev-answer:' + R.id, ta.value); saveDrafts(); }); ta.focus({ preventScroll: true }); }
    } };
}

async function nextQuestion() {
  const R = S.revise;
  R.phase = 'loading'; R.answered = false; rerender(); setNuru('thinking');
  try {
    const { chat } = await act('revision_question', { id: R.id, previous_question: R.attempts.map(a => a.question).concat(R.question ? [R.question] : []).join(' | ').slice(-600) }, { render: false, timeout: 45000 });
    R.question = chat.practice_question; R.qMode = chat.mode; R.phase = 'question'; setNuru('listening');
  } catch (e) { toast(e.message, { error: true }); R.phase = R.question ? 'question' : 'question'; R.question = R.question || `In your own words, explain "${R.topic}".`; R.qMode = 'demo'; }
  rerender();
}

function openSheet() {
  const study = document.querySelector('.study'); if (!study) return;
  if (collapsed) { collapsed = false; try { localStorage.setItem('cs-companion', 'open'); } catch { /* ignore */ } study.classList.remove('is-collapsed'); }
  if (matchMedia('(max-width: 900px)').matches) { sheetOpen = true; study.classList.add('sheet-open'); document.querySelector('.help-fab')?.setAttribute('aria-expanded', 'true'); }
  const btn = document.querySelector('.collapse-btn'); if (btn) btn.setAttribute('aria-expanded', 'true');
  document.querySelector('#chat-input')?.focus();
}

export function register(V, A, F) {
  V.study = params => {
    if (params[0] === 'a') return viewAssignment(params[1], params[2] === 's' ? params[3] : null);
    if (params[0] === 'm') return viewMaterial(params[1], params[2] === 'p' ? params[3] : null);
    if (params[0] === 'understand') return viewUnderstand(params.slice(1));
    if (params[0] === 'revise') return viewRevise();
    return viewPicker();
  };
  V.revise = () => ({ redirect: '#/study/revise' });
  V.desk = () => ({ redirect: '#/study' });
  Object.assign(A, {
    'help-here': () => openSheet(),
    'companion-collapse': () => {
      const study = document.querySelector('.study');
      if (sheetOpen) { sheetOpen = false; study?.classList.remove('sheet-open'); document.querySelector('.help-fab')?.focus(); return; }
      collapsed = !collapsed; try { localStorage.setItem('cs-companion', collapsed ? 'collapsed' : 'open'); } catch { /* ignore */ }
      rerender();
    },
    continue: () => {
      const r = S.state.resume; if (!r) return;
      if (r.kind === 'assignment') go(`#/study/a/${r.id}${r.step_id ? '/s/' + r.step_id : ''}`);
      else if (r.kind === 'material') go(`#/study/m/${r.id}`);
      else if (r.kind === 'understand') { if (S.learn.topic !== r.title) S.learn = { topic: r.title, step: 1, turns: [], practice: '', feedback: null, useNotes: true }; go('#/study/understand'); }
      else if (r.kind === 'revise') A['revise-continue']({ dataset: { id: r.id } });
    },
    'revise-topic': b => { const f = b.closest('form'); f.topic.value = b.dataset.topic; f.topic.focus(); },
    'revise-these': b => { const m = S.state.materials.find(x => x.id === +b.dataset.id); S.revise = null; S.reviseSetup = { material_ids: [m.id], course_id: m.course_id, topic: '' }; go('#/study/revise'); },
    'revise-continue': b => {
      const r = S.state.revisions.find(x => x.id === +b.dataset.id); if (!r) return;
      S.revise = { id: r.id, topic: r.topic, minutes: r.minutes, materialIds: r.material_ids, assessment: r.assessment_date, attempts: [], question: '', phase: 'loading' };
      go('#/study/revise'); nextQuestion();
    },
    'revise-next': () => nextQuestion(),
    'revise-hint': () => { openSheet(); const f = document.querySelector('form[data-form="chat"]'); if (f) sendChat(f.dataset.thread, f.dataset.params, `I'm stuck on: "${S.revise.question}". Could I have a hint, without the answer?`, true, 'tutor_hint'); },
    'revise-ask': b => { openSheet(); const f = document.querySelector('form[data-form="chat"]'); if (f) sendChat(f.dataset.thread, f.dataset.params, b.dataset.text, true, b.dataset.intent); },
    'revise-finish': () => { S.revise.phase = 'finish'; rerender(); },
    'revise-back': () => { S.revise.phase = S.revise.attempts.length ? 'answered' : 'question'; rerender(); },
    'revise-new': () => { S.revise = null; S.reviseSetup = null; go('#/study/revise'); },
  });
  Object.assign(F, {
    'pick-understand': async (f, d) => { S.learn = { topic: d.topic.trim(), step: 1, turns: [], practice: '', feedback: null, useNotes: true }; go('#/study/understand'); },
    'revise-start': async (f, d) => {
      const fd = new FormData(f);
      const material_ids = fd.getAll('material').map(Number);
      const r = await act('revision_start', { topic: d.topic, course_id: d.course_id ? +d.course_id : null, material_ids, minutes: +d.minutes || 20, assessment_date: d.assessment_date || '' }, { render: false });
      S.revise = { id: r.revision_id, topic: d.topic.trim(), minutes: +d.minutes || 20, materialIds: material_ids, assessment: d.assessment_date || null, attempts: [], question: '', phase: 'loading' };
      if (r.state) S.state = r.state;
      S.reviseSetup = null;
      await nextQuestion();
    },
    'revise-answer': async (f, d) => {
      const R = S.revise; setNuru('thinking');
      const { chat } = await act('revision_answer', { id: R.id, question: R.question, answer: d.answer }, { render: false, timeout: 45000 });
      if (chat.mode === 'safety') { R.attempts.push({ question: R.question, answer: d.answer, feedback: chat }); R.phase = 'answered'; rerender(); return; }
      R.attempts.push({ question: R.question, answer: d.answer, feedback: chat });
      S.drafts.delete('rev-answer:' + R.id); saveDrafts();
      R.phase = 'answered'; R.answered = true; setNuru(chat.nuru || 'explaining');
      if (chat.verdict === 'on_track') nuruSay('That reasoning holds together.', 'celebrating', { ms: 4000 });
      rerender();
    },
    'revise-finish': async (f, d) => {
      const R = S.revise;
      const r = await act('revision_finish', { id: R.id, confidence: d.confidence || '' }, { render: false });
      R.summary = r.summary; R.phase = 'summary';
      if (r.state) S.state = r.state;
      rerender();
    },
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen) { sheetOpen = false; document.querySelector('.study')?.classList.remove('sheet-open'); document.querySelector('.help-fab')?.focus(); } });
}
