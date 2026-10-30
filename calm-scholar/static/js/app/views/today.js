/* Today: a welcome, one clear question, and what's relevant right now. Never invents records. */
import { S, act, guarded, assignment, companionName } from '../core.js';
import { esc, icon, hm, mins, plural, dueText, fmtDate, STAGES, $ } from '../util.js';
import { sceneSVG, applyScene, nuruSay } from '../scene.js';


const stageName = k => (STAGES.find(s => s[0] === k) || STAGES[1])[1];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function helpGroups() {
  const n = companionName();
  const btn = (attrs, ic, label, sub) => `<button class="help-action" ${attrs}>${icon(ic)}<span><b>${label}</b><small>${sub}</small></span></button>`;
  return `<div class="help-groups">
    <section class="help-group" aria-labelledby="hg-org"><h3 id="hg-org"><i class="dot amber"></i>Organize</h3>
      ${btn('data-go="#/study"', 'check', 'Work on an assignment', 'Pick a step and do it together')}
      ${btn('data-go="#/plan/week"', 'clock', 'Plan my study time', 'A plan that fits your week')}</section>
    <section class="help-group" aria-labelledby="hg-learn"><h3 id="hg-learn"><i class="dot lav"></i>Learn &amp; revise</h3>
      ${btn('data-go="#/study/understand"', 'spark', 'Help me understand something', 'Explanations and examples')}
      ${btn('data-go="#/study/revise"', 'book', 'Revise with me', 'Try a question first, then feedback')}</section>
    <section class="help-group" aria-labelledby="hg-sup"><h3 id="hg-sup"><i class="dot sage"></i>Talk it through</h3>
      ${btn('data-act="result-new"', 'flag', 'I got my results', `${n} asks how you feel first`)}
      ${btn('data-go="#/companion/support"', 'heart', 'I need to talk', 'Talk, pause, or pick a next step')}</section>
  </div>`;
}

function nextStepCard() {
  const st = S.state, na = st.next_action;
  let body;
  if (na.kind === 'session' || na.kind === 'step') {
    const a = assignment(na.assignment_id), due = a ? dueText(a.due, st.today) : null;
    const stepId = na.kind === 'step' ? na.id : null;
    body = `<p class="kicker">${na.kind === 'session' ? `Planned for ${hm(na.start_minute)}` : `Next step · ${stageName(na.stage)}`}</p>
      <h3>${esc(na.title)}</h3><p class="meta">${a ? esc(a.title) + ' · ' : ''}${mins(na.minutes)}${due ? ` · <span class="tag ${due.tone}">${due.text}</span>` : ''}</p>
      <div class="row"><button class="btn btn-lamp btn-sm" data-go="#/study/a/${na.assignment_id}${stepId ? '/s/' + stepId : ''}">Study this together</button>
        <button class="btn btn-ghost btn-sm" data-act="${na.kind === 'session' ? 'session-toggle' : 'step-toggle'}" data-id="${na.id}">${icon('check')}Mark done</button></div>`;
  } else if (na.kind === 'assignment') {
    body = `<p class="kicker">A good first move</p><h3>Break “${esc(na.title)}” into steps</h3><p class="meta">Small steps are easier to start. You can edit every suggestion.</p>
      <div class="row"><button class="btn btn-lamp btn-sm" data-go="#/plan/a/${na.assignment_id}">View assignment steps</button></div>`;
  } else if (na.kind === 'review') {
    body = `<p class="kicker">Ready to revisit</p><h3>${esc(na.title)}</h3><p class="meta">A few questions, a few minutes.</p>
      <div class="row"><button class="btn btn-lamp btn-sm" data-act="revise-topic-go" data-topic="${esc(na.title)}">Revise this</button></div>`;
  } else {
    body = `<p class="kicker">Nothing scheduled</p><h3>No next step yet</h3><p class="meta">Add an assignment and we'll break it into steps together.</p>
      <div class="row"><button class="btn btn-lamp btn-sm" data-act="new-assignment">${icon('plus')}Add an assignment</button></div>`;
  }
  return `<article class="card next" aria-labelledby="t-next"><h2 id="t-next" class="card-h">Today's next step</h2>${body}</article>`;
}

function continueCard() {
  const r = S.state.resume;
  const label = r ? { assignment: 'Assignment', material: 'Notes', revise: 'Revision', understand: 'Understanding' }[r.kind] : '';
  return `<article class="card" aria-labelledby="t-cont"><h2 id="t-cont" class="card-h">Continue where we stopped</h2>
    ${r ? `<p class="kicker">${label}</p><h3>${esc(r.step || r.title)}</h3>${r.step ? `<p class="meta">${esc(r.title)}</p>` : ''}<div class="row"><button class="btn btn-soft btn-sm" data-act="continue">Continue</button></div>`
      : `<p class="small muted">Nothing in progress. When you work on something in Study Together, it will be waiting here.</p>`}</article>`;
}

function deadlinesCard() {
  const st = S.state, open = st.assignments.filter(a => !a.completed).slice(0, 4);
  return `<article class="card" aria-labelledby="t-due"><div class="spread"><h2 id="t-due" class="card-h">Upcoming deadlines</h2><button class="btn-text" data-nav="plan">All assignments</button></div>
    ${open.length ? `<ul class="list compact">${open.map(a => { const d = dueText(a.due, st.today); const done = a.steps.filter(s => s.completed).length;
      return `<li><button class="item clickable" data-go="#/study/a/${a.id}"><span class="main"><span class="title">${esc(a.title)}</span><span class="meta">${esc(a.course)}${a.steps.length ? ` · ${done}/${a.steps.length} steps` : ''}</span></span><span class="tag ${d.tone}">${d.text}</span></button></li>`; }).join('')}</ul>`
      : `<p class="small muted">No deadlines recorded. <button class="btn-text" data-act="new-assignment">Add an assignment</button></p>`}</article>`;
}

function reviseCard() {
  const due = S.state.concepts.filter(c => c.due).slice(0, 5);
  return `<article class="card" aria-labelledby="t-rev"><h2 id="t-rev" class="card-h">Ready to revisit</h2>
    ${due.length ? `<div class="chips">${due.map(c => `<button class="chip" data-act="revise-topic-go" data-topic="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>`
      : `<p class="small muted">No topics are due. Topics you practise appear here when it's a good time to review them.</p><button class="btn btn-soft btn-sm" data-go="#/study/revise">Revise something now</button>`}</article>`;
}

function todayPlan() {
  const st = S.state, todays = st.sessions.filter(s => s.date === st.today);
  if (!todays.length) return '';
  return `<div class="section-title"><h2>Today's study plan</h2><button class="btn-text" data-go="#/plan/week">Adjust plan</button></div>
    <ul class="list">${todays.map(s => `<li class="item ${s.completed ? 'done' : ''}"><span class="time">${hm(s.start_minute)}</span>
    <button class="check ${s.completed ? 'on' : ''}" data-act="session-toggle" data-id="${s.id}" aria-pressed="${s.completed}" aria-label="${s.completed ? 'Mark not done' : 'Mark done'}: ${esc(s.title)}">${s.completed ? icon('check') : ''}</button>
    <div class="main"><div class="title">${esc(s.title)}</div><div class="meta">${mins(s.minutes)} · ${esc(assignment(s.assignment_id)?.title || '')}</div></div>
    <button class="btn btn-sm btn-soft" data-go="#/study/a/${s.assignment_id}${s.subtask_id ? '/s/' + s.subtask_id : ''}">Study</button></li>`).join('')}</ul>`;
}

function quickBlock() {
  return `<section class="paper quick" aria-labelledby="quick-title">
    <h2 id="quick-title" class="card-h">I have a little time</h2>
    <p class="small muted" style="margin:0 0 12px">Tell me how long you have and I'll pick one real step from your list, sized to fit.</p>
    <div class="chips" role="group" aria-label="How many minutes do you have?">${[10, 20, 30, 45].map(m => `<button class="chip" data-act="quick" data-minutes="${m}">${m} minutes</button>`).join('')}</div>
    <div id="quick-out" aria-live="polite"></div></section>`;
}

function viewHome() {
  const st = S.state, p = st.profile, first = !st.assignments.length && !st.materials.length && !st.results.length;
  return {
    title: 'Today', sub: fmtDate(st.today, { weekday: 'long', day: 'numeric', month: 'long' }), wide: true, nuru: 'welcoming',
    body: `<section class="today-hero" aria-labelledby="today-q">
        <div class="today-scene">${sceneSVG({ cls: 'compact' })}</div>
        <div class="today-copy">
          <p class="hello">${greeting()}, <em>${esc(p.name)}</em>.</p>
          ${first ? `<p class="intro">I'm ${companionName()}, your AI study buddy. We can organize your work, understand something together, revise, or talk through how things are going.</p>` : ''}
          <h2 id="today-q">What would help you today?</h2>
        </div>
        ${helpGroups()}
      </section>
      <div class="today-grid">${nextStepCard()}${continueCard()}${deadlinesCard()}${reviseCard()}</div>
      ${todayPlan()}
      ${quickBlock()}
      <p class="small muted today-foot">Optional: <button class="btn-text" data-go="#/journal/checkin">a quick check-in</button> · <button class="btn-text" data-nav="progress">see your progress</button></p>`,
    mount: () => applyScene(),
  };
}

export function register(V, A) {
  V.home = viewHome;
  Object.assign(A, {
    'revise-topic-go': b => { S.revise = null; S.reviseSetup = { topic: b.dataset.topic }; location.hash = '#/study/revise'; },
    'session-toggle': b => guarded(b, async () => { const r = await act('session_toggle', { id: +b.dataset.id }); if (!r.new_keepsakes) nuruSay('Noted. Every session counts, whatever it looked like.', 'celebrating', { ms: 5000 }); }),
    'step-toggle': b => guarded(b, async () => { const r = await act('step_toggle', { id: +b.dataset.id }); if (!r.new_keepsakes && b.getAttribute('aria-pressed') !== 'true') nuruSay('One step done. That counts.', 'celebrating', { ms: 5000 }); }),
    quick: b => guarded(b, async () => {
      document.querySelectorAll('[data-act="quick"]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const { quick: q } = await act('quick_start', { minutes: +b.dataset.minutes }, { render: false });
      const out = $('#quick-out');
      if (q.kind === 'empty') { out.innerHTML = `<p class="small" style="margin-top:12px">Nothing is waiting on your list. You could add an assignment, or revise one topic.</p>`; return; }
      out.innerHTML = `<ol class="quick-plan">${q.plan.map(s => `<li><b>${s.minutes}′</b><span>${esc(s.text)}</span></li>`).join('')}</ol>
        <p class="tiny muted" style="margin:8px 0">From <b>${esc(q.assignment)}</b>${q.due_in >= 0 ? `, due in ${plural(q.due_in, 'day')}` : ', past its deadline'}.</p>
        <button class="btn btn-lamp" data-act="focus-start" data-goal="${esc(q.goal)}" data-assignment="${q.assignment_id}" ${q.step_id ? `data-step="${q.step_id}"` : ''} data-minutes="${q.minutes}">${icon('play')}Start these ${q.minutes} minutes together</button>`;
    }),
  });
}
