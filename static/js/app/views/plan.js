/* Assignments & Study Plan: assignments, their steps, and the weekly planner (deterministic). */
import { S, act, guarded, go, assignment, companionName } from '../core.js';
import { esc, icon, hm, mins, plural, dueText, fmtDate, STAGES, toast, openDialog, closeDialog, $, daysBetween } from '../util.js';
import { nuruSay, setNuru } from '../scene.js';
import { challengeLauncher } from './challenge.js';

let proposal = null;
const modeNote = (mode, reason) => mode === 'live' ? 'Suggested by live AI. Edit anything.' : mode === 'fallback' ? `Live AI was unavailable (${esc(reason || 'error')}), so these are scripted starter steps, clearly not AI. Edit anything.` : 'Demo mode: scripted starter steps, not AI. Edit anything.';

function assignmentForm(a = {}) {
  const st = S.state;
  return `<form data-form="assignment" class="stack">${a.id ? `<input type="hidden" name="id" value="${a.id}">` : ''}
    <label>Title<input name="title" maxlength="160" required value="${esc(a.title || '')}" placeholder="e.g. Lab report: enzyme activity"></label>
    <div class="field-grid"><label>Course<input name="course" maxlength="80" list="course-list" value="${esc(a.course || st.courses[0]?.name || '')}" placeholder="My course"></label>
      <datalist id="course-list">${st.courses.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <label>Due date<input type="date" name="due" required value="${esc(a.due || '')}"></label></div>
    <div class="field-grid"><label>Rough estimate (minutes)<input type="number" name="minutes" min="15" max="1440" value="${a.minutes || 120}"><span class="hint">A guess is fine; you can change it later.</span></label>
      <label>Priority<select name="priority"><option value="normal">Normal</option><option value="high" ${a.priority === 'high' ? 'selected' : ''}>High</option></select></label></div>
    <label>Brief (optional)<textarea name="description" maxlength="4000" placeholder="Paste the assignment brief or describe it in a sentence. It helps with useful steps.">${esc(a.description || '')}</textarea></label>
    <div class="row"><button class="btn btn-primary">${a.id ? 'Save changes' : 'Add assignment'}</button><button type="button" class="btn btn-ghost" data-close>Cancel</button></div></form>`;
}

export function openAssignmentDialog(a) {
  const inner = openDialog(a?.id ? 'Edit assignment' : 'New assignment', assignmentForm(a || {}));
  inner.querySelector('[data-close]').addEventListener('click', closeDialog);
}

function stageStrip(a) {
  return `<div class="stages" aria-label="Steps by stage">${STAGES.map(([k, l], i) => {
    const steps = a.steps.filter(s => s.stage === k), done = steps.length && steps.every(s => s.completed);
    return `<div class="stage ${done ? 'done' : steps.length ? 'has' : ''}"><span class="n">${i + 1}</span>${l}<span class="sr-only">: ${steps.length ? `${steps.filter(s => s.completed).length} of ${steps.length} done` : 'no steps'}</span></div>`;
  }).join('')}</div>`;
}

function stepRow(a, s, i, n) {
  return `<li class="item step-row ${s.completed ? 'done' : ''}" id="step-${s.id}">
    <button class="check ${s.completed ? 'on' : ''}" data-act="step-toggle" data-id="${s.id}" aria-pressed="${s.completed}" aria-label="${s.completed ? 'Mark not done' : 'Mark done'}: ${esc(s.title)}">${s.completed ? icon('check') : ''}</button>
    <div class="main"><div class="title">${esc(s.title)}</div><div class="meta">${mins(s.minutes)}</div></div>
    <div class="step-tools">
      <button class="icon-btn" data-act="focus-start" data-goal="${esc(s.title)}" data-assignment="${a.id}" data-minutes="${Math.min(60, Math.max(10, s.minutes))}" aria-label="Focus on this step">${icon('play')}</button>
      <button class="icon-btn" data-act="step-edit" data-id="${s.id}" aria-label="Edit step">${icon('edit')}</button>
      <button class="icon-btn" data-act="step-move" data-id="${s.id}" data-dir="up" aria-label="Move step up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button>
      <button class="icon-btn" data-act="step-move" data-id="${s.id}" data-dir="down" aria-label="Move step down" ${i === n - 1 ? 'disabled' : ''}>${icon('down')}</button>
      <button class="icon-btn" data-act="step-delete" data-id="${s.id}" aria-label="Delete step">${icon('trash')}</button>
    </div></li>`;
}

const stageSelect = (v = 'explore', name = 'stage') => `<select name="${name}">${STAGES.map(([k, l, d]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l} · ${d}</option>`).join('')}</select>`;

function viewAssignment(id) {
  const a = assignment(id);
  if (!a) return { title: 'Not found', back: '#/plan', body: `<div class="empty"><p>This assignment isn't here any more.</p></div>` };
  const st = S.state, d = dueText(a.due, st.today);
  const order = a.steps; // already in order
  const grouped = STAGES.map(([k, l, desc]) => {
    const steps = order.filter(s => s.stage === k);
    return steps.length ? `<div class="stage-group"><h4>${l} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500">${desc}</span></h4><ul class="list">${steps.map(s => stepRow(a, s, order.indexOf(s), order.length)).join('')}</ul></div>` : '';
  }).join('');
  const done = a.steps.filter(s => s.completed).length;
  return {
    title: esc(a.title), sub: `Assignment steps · ${esc(a.course)} · <span class="tag ${d.tone}">${d.text}</span> ${a.priority === 'high' ? '<span class="tag rose">High priority</span>' : ''}`, back: '#/plan', nuru: 'listening',
    tools: `<button class="icon-btn" data-act="assignment-edit" data-id="${a.id}" aria-label="Edit assignment">${icon('edit')}</button>`,
    body: `${a.description ? `<details class="disclose paper pad" style="margin-bottom:12px"><summary>The brief</summary><p style="white-space:pre-wrap;margin:8px 0 0">${esc(a.description)}</p></details>` : ''}
      ${stageStrip(a)}
      ${a.steps.length ? `<div class="spread small muted"><span>${done} of ${a.steps.length} steps · ${mins(a.steps.reduce((n, s) => n + s.minutes, 0))} planned of ~${mins(a.minutes)}</span></div>${grouped}`
        : `<div class="empty" style="margin-top:12px"><h3>Let's make this smaller</h3><p>${companionName()} can suggest a few steps across Discover → Explore → Practice → Create → Reflect. You can edit, reorder or delete any of them.</p>
           <div class="row" style="justify-content:center"><button class="btn btn-lamp" data-act="breakdown" data-id="${a.id}">${icon('spark')}Suggest steps</button><button class="btn btn-ghost" data-act="focus-add-step">Add my own</button></div></div>`}
      <form data-form="step-add" class="step-edit" style="margin-top:16px" id="add-step"><input type="hidden" name="assignment_id" value="${a.id}">
        <label>New step<input name="title" maxlength="180" required placeholder="A small, concrete action"></label><label>Minutes<input type="number" name="minutes" min="1" max="1440" value="25"></label>
        <label>Stage${stageSelect('practice')}</label><button class="btn btn-soft">Add</button></form>
      <div class="section-title"><h2>Work on it</h2></div>
      <div class="row"><button class="btn btn-lamp" data-go="#/study/a/${a.id}${a.steps.find(s => !s.completed) ? '/s/' + a.steps.find(s => !s.completed).id : ''}">Study this together</button>
        <button class="btn btn-ghost" data-go="#/plan/week">${icon('clock')}Fit it into my week</button>
        <button class="btn btn-ghost" data-go="#/journal/new/${a.id}">I got my result for this</button></div>
      <div style="margin-top:14px">${challengeLauncher(a.title, a.id)}</div>
      <div class="section-title"><h2>Finished?</h2></div>
      <div class="row"><button class="btn ${a.completed ? 'btn-ghost' : 'btn-sage'}" data-act="assignment-toggle" data-id="${a.id}">${a.completed ? 'Reopen assignment' : icon('check') + 'Mark the whole assignment complete'}</button>
      <button class="btn-text" style="color:var(--rose)" data-act="assignment-delete" data-id="${a.id}">Delete assignment</button></div>`,
  };
}

function viewList() {
  const st = S.state;
  const open = st.assignments.filter(a => !a.completed), done = st.assignments.filter(a => a.completed);
  const row = a => { const d = dueText(a.due, st.today); const n = a.steps.length, c = a.steps.filter(s => s.completed).length;
    return `<li><button class="item clickable" data-go="#/plan/a/${a.id}" style="flex-direction:column;align-items:stretch;gap:8px">
      <span class="spread"><span class="title">${esc(a.title)}</span>${a.completed ? '<span class="tag sage">Complete</span>' : `<span class="tag ${d.tone}">${d.text}</span>`}</span>
      <span class="meta">${esc(a.course)} · ${n ? `${c}/${n} steps` : 'no steps yet'} · ~${mins(a.minutes)}</span>
      ${n ? `<span class="stages" style="margin:0" aria-hidden="true">${STAGES.map(([k]) => { const s = a.steps.filter(x => x.stage === k); return `<span class="stage ${s.length && s.every(x => x.completed) ? 'done' : s.length ? 'has' : ''}" style="padding:3px"></span>`; }).join('')}</span>` : ''}</button></li>`; };
  return {
    title: 'Assignments & Study Plan', sub: 'Deadlines, steps and a plan that fits your week.', nuru: 'listening',
    tools: `<button class="btn btn-primary btn-sm" data-act="new-assignment">${icon('plus')}New</button>`,
    body: `<div class="seg" role="group" aria-label="Assignments or study plan"><button aria-pressed="true">Assignments</button><button data-go="#/plan/week" aria-pressed="false">This week's study plan</button></div>
      <div class="section-title"><h2>In progress</h2><span class="tiny muted">${plural(open.length, 'assignment')}</span></div>
      ${open.length ? `<ul class="list">${open.map(row).join('')}</ul>` : `<div class="empty"><h3>No assignments yet</h3><p>Add the next piece of coursework. Even a rough deadline is enough to start.</p><button class="btn btn-primary" data-act="new-assignment">Add an assignment</button></div>`}
      ${done.length ? `<details class="disclose" style="margin-top:20px"><summary>Completed (${done.length})</summary><ul class="list" style="margin-top:8px">${done.map(row).join('')}</ul></details>` : ''}`,
  };
}

function sessionsByDay(sessions) {
  const days = {};
  sessions.forEach(s => (days[s.date] ||= []).push(s));
  return Object.entries(days).sort(([a], [b]) => a.localeCompare(b));
}

function alertBlock(al) {
  const opts = (al.options || []).map(o => ({
    reduce_scope: `<button class="btn btn-sm btn-ghost" data-go="#/plan/a/${al.assignment_id}">Reduce the scope of a step</button>`,
    adjust_availability: `<button class="btn btn-sm btn-ghost" data-nav="settings">Adjust my time or pace</button>`,
    draft_request: `<button class="btn btn-sm btn-ghost" data-go="#/companion/a/${al.assignment_id}/draft/${al.minutes_short || 0}">Draft a message to my lecturer</button>`,
  }[o])).join('');
  return `<div class="alert ${al.kind}"><p>${esc(al.message)}</p>${opts ? `<div class="row">${opts}</div>` : ''}</div>`;
}

function viewWeek() {
  const st = S.state, p = st.profile;
  const upcoming = st.sessions.filter(s => s.date >= st.today);
  const missed = st.sessions.filter(s => s.date < st.today && !s.completed);
  const preview = proposal ? `<section class="paper pad" style="margin-top:14px;border:1.5px solid var(--lav)" aria-labelledby="pv-title">
      <h3 id="pv-title" style="margin-bottom:6px">Preview: nothing has changed yet</h3>
      <div class="diff"><span class="tag lav">${plural(proposal.sessions.length, 'new session')}</span><span class="tag amber">Replaces ${plural(proposal.replaces, 'unfinished upcoming session')}</span><span class="tag sage">Keeps ${plural(proposal.keeps_completed, 'completed session')}</span><span class="tag">Up to ${mins(proposal.capacity)} a day incl. 5-min breaks</span></div>
      ${proposal.alerts.length ? `<div class="stack" style="margin-top:12px;gap:8px">${proposal.alerts.map(alertBlock).join('')}</div>` : '<p class="small" style="margin:10px 0 0">Everything fits before its deadline.</p>'}
      ${sessionsByDay(proposal.sessions).map(([day, list]) => `<div class="day-block"><h4>${fmtDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}</h4><ul class="list">${list.map(s => `<li class="item"><span class="time">${hm(s.start_minute)}</span><div class="main"><div class="title">${esc(s.title)}</div><div class="meta">${mins(s.minutes)} · ${esc(assignment(s.assignment_id)?.title || '')}</div></div></li>`).join('')}</ul></div>`).join('')}
      <div class="row" style="margin-top:16px"><button class="btn btn-primary" data-act="plan-confirm" ${proposal.sessions.length || proposal.replaces ? '' : 'disabled'}>Use this plan</button><button class="btn btn-ghost" data-act="plan-cancel">Keep my current plan</button></div></section>` : '';
  return {
    title: "This week's study plan", sub: `Planned in ${esc(p.timezone)} · ${p.start_hour}:00–${p.end_hour}:00 · ${mins(p.daily_minutes)}/day`, back: '#/plan', nuru: 'thinking',
    body: `<div class="seg" role="group" aria-label="Assignments or study plan"><button data-go="#/plan" aria-pressed="false">Assignments</button><button aria-pressed="true">This week's study plan</button></div>
      <div class="paper pad" style="margin-top:14px"><div class="spread"><div><h3 style="margin:0">Pace</h3><p class="small muted" style="margin:0">Change it whenever your week changes. It isn't a judgement.</p></div>
      <div class="seg" role="group" aria-label="Pace">${['gentle', 'balanced', 'focused'].map(v => `<button data-act="pace" data-value="${v}" aria-pressed="${p.energy === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>
      <div class="row" style="margin-top:14px"><button class="btn btn-lamp" data-act="plan-preview">${icon('spark')}Preview a fresh plan</button><button class="btn btn-ghost" data-go="#/companion/plan">${icon('chat')}Help me with my plan</button><button class="btn-text" data-nav="settings">Change availability</button></div>
      <p class="tiny muted" style="margin:10px 0 0">Plans fit inside your available hours with breaks, put the nearest deadline first, and keep everything you've already done. Nothing changes until you choose “Use this plan”, and deadlines are never moved.</p></div>
      ${preview}
      ${missed.length ? `<div class="notice lav" style="margin-top:14px">${icon('heart')}<p>${plural(missed.length, 'session')} from earlier didn't happen. That's normal; life happens. A fresh preview includes that work again, with no penalty.</p></div>` : ''}
      <div class="section-title"><h2>Coming up</h2></div>
      ${upcoming.length ? sessionsByDay(upcoming).map(([day, list]) => `<div class="day-block"><h4>${day === st.today ? 'Today' : fmtDate(day, { weekday: 'long', day: 'numeric', month: 'short' })}</h4><ul class="list">${list.map(s => `<li class="item ${s.completed ? 'done' : ''}"><span class="time">${hm(s.start_minute)}</span>
        <button class="check ${s.completed ? 'on' : ''}" data-act="session-toggle" data-id="${s.id}" aria-pressed="${s.completed}" aria-label="${s.completed ? 'Mark not done' : 'Mark done'}: ${esc(s.title)}">${s.completed ? icon('check') : ''}</button>
        <div class="main"><div class="title">${esc(s.title)}</div><div class="meta">${mins(s.minutes)} · ${esc(assignment(s.assignment_id)?.title || '')}</div></div></li>`).join('')}</ul></div>`).join('')
        : `<div class="empty"><p>No sessions planned yet. Preview a plan to see how your work could fit.</p></div>`}`,
  };
}

export function register(V, A, F) {
  V.plan = params => params[0] === 'a' ? viewAssignment(params[1]) : params[0] === 'week' ? viewWeek() : viewList();
  Object.assign(A, {
    'new-assignment': () => openAssignmentDialog(),
    'assignment-edit': b => openAssignmentDialog(assignment(b.dataset.id)),
    'assignment-toggle': b => guarded(b, async () => { const a = assignment(b.dataset.id); await act('assignment_toggle', { id: a.id }, { message: a.completed ? 'Reopened.' : 'Marked complete. Well carried.' }); }),
    'assignment-delete': b => { if (confirm('Delete this assignment, its steps and sessions?')) guarded(b, async () => { await act('assignment_delete', { id: +b.dataset.id }, { render: false, message: 'Deleted.' }); location.hash = '#/plan'; }); },
    breakdown: b => guarded(b, async () => {
      setNuru('thinking');
      const r = await act('breakdown', { id: +b.dataset.id });
      toast(modeNote(r.mode, r.fallback_reason), { ms: 7000 });
      nuruSay('Here are some steps to start from. Change anything that doesn’t fit how you work.', 'explaining');
    }),
    'focus-add-step': () => $('#add-step input[name=title]')?.focus(),
    'step-edit': b => {
      const a = S.state.assignments.find(x => x.steps.some(s => s.id === +b.dataset.id)); const s = a.steps.find(x => x.id === +b.dataset.id);
      const li = $(`#step-${s.id}`);
      li.outerHTML = `<li><form data-form="step-save" class="step-edit"><input type="hidden" name="id" value="${s.id}"><input type="hidden" name="assignment_id" value="${a.id}">
        <label>Step<input name="title" maxlength="180" required value="${esc(s.title)}"></label><label>Minutes<input type="number" name="minutes" min="1" max="1440" value="${s.minutes}"></label>
        <label>Stage${stageSelect(s.stage)}</label><div class="row"><button class="btn btn-soft btn-sm">Save</button><button type="button" class="btn-text" data-act="rerender">Cancel</button></div></form></li>`;
      document.querySelector(`form [name=id][value="${s.id}"]`)?.closest('form').querySelector('[name=title]').focus();
    },
    rerender: () => import('../core.js').then(m => m.rerender()),
    'step-move': b => guarded(b, () => act('step_move', { id: +b.dataset.id, direction: b.dataset.dir })),
    'step-delete': b => { if (confirm('Delete this step?')) guarded(b, () => act('step_delete', { id: +b.dataset.id })); },
    pace: b => guarded(b, async () => { await act('profile', { energy: b.dataset.value }); proposal = null; }),
    'plan-preview': b => guarded(b, async () => { const r = await act('plan_preview', {}, { render: false }); proposal = r.proposal; (await import('../core.js')).rerender();
      nuruSay(proposal.alerts.some(a => a.kind === 'infeasible') ? 'Some work does not fit before its deadline. That’s useful to know early, and there are a few options.' : 'Here’s a plan that fits the time you have. Nothing changes until you choose it.', 'thinking'); }),
    'plan-cancel': async () => { proposal = null; (await import('../core.js')).rerender(); },
    'plan-confirm': b => guarded(b, async () => { await act('plan_confirm', {}, { message: 'Plan saved. Completed work was kept.' }); proposal = null; (await import('../core.js')).rerender(); }),
  });
  Object.assign(F, {
    assignment: async (f, d) => {
      const r = await act('assignment_save', { id: d.id ? +d.id : null, title: d.title, course: d.course, due: d.due, minutes: +d.minutes, priority: d.priority, description: d.description }, { render: false, message: d.id ? 'Saved.' : 'Assignment added.' });
      closeDialog(); proposal = null;
      go(`#/plan/a/${r.assignment_id}`);
    },
    'step-add': (f, d) => act('step_save', { assignment_id: +d.assignment_id, title: d.title, minutes: +d.minutes, stage: d.stage }, { message: 'Step added.' }),
    'step-save': (f, d) => act('step_save', { id: +d.id, assignment_id: +d.assignment_id, title: d.title, minutes: +d.minutes, stage: d.stage }, { message: 'Saved.' }),
  });
}
