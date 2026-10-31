/* Talk to Nuru, and the shared chat component behind "Help me here" in Study Together.
   Context is always explicit: the panel says what is shared before anything is sent. */
import { S, act, guarded, go, assignment, thread, companionName, rerender, saveDrafts } from '../core.js';
import { esc, icon, rich, nuruSVG, toast, $, $$, FALLBACK_REASONS, STAGES } from '../util.js';
import { setNuru } from '../scene.js';
import { getPassage } from '../api.js';

/* ---------- shared rendering ---------- */
export function modeLine(r) {
  const m = r.mode || 'demo';
  const label = { live: 'Live AI', demo: 'Demo mode: scripted response', fallback: 'Fallback: scripted, not live AI', safety: 'Safety message', saved: 'Saved history', checked: 'Checked by the app', self: 'Self-check' }[m] || m;
  const why = m === 'fallback' ? ` <span class="tiny">(${esc(FALLBACK_REASONS[r.fallback_reason] || 'the live request failed')})</span>` : '';
  return `<span class="ai-badge ${m === 'live' ? 'live' : m === 'fallback' ? 'fallback' : m === 'safety' ? 'safety' : 'demo'}">${label}</span>${why}`;
}

export function citations(supported) {
  if (!supported?.length) return '';
  return `<div class="from-notes"><h5>From your notes</h5>${supported.map(s => `<p class="claim">${esc(s.text)}</p><div>${s.citations.map(c => `<button class="cite" data-act="cite" data-id="${c.id}" aria-expanded="false">${icon('book')}${esc(c.material)}${c.page ? `, p. ${c.page}` : ''}</button>`).join('')}</div>`).join('')}<div data-passage></div></div>`;
}

function notesNote(r) {
  if (r.notes_status === 'no_materials') return `<p class="tiny muted" style="margin:0">${icon('info')} You haven't added notes yet, so this explanation is general. Add notes in My Notes &amp; Courses to get cited answers.</p>`;
  if (r.notes_status === 'none_found') return `<p class="tiny muted" style="margin:0">${icon('info')} Your notes were searched but didn't cover this, so the explanation is general rather than from your materials.</p>`;
  if (r.notes_status === 'not_cited') return `<p class="tiny muted" style="margin:0">${icon('info')} Matching passages were found, but this reply doesn't rely on them.</p>`;
  return '';
}

function proposals(list, key) {
  return (list || []).map((p, i) => p.type === 'add_step' ? `<form class="proposal" data-form="proposal" data-thread="${esc(key)}" data-i="${i}">
      <h5>Suggested step · a proposal until you approve it</h5>
      <input type="hidden" name="type" value="add_step"><input type="hidden" name="assignment_id" value="${p.assignment_id}">
      <label>Step for “${esc(assignment(p.assignment_id)?.title || 'assignment')}”<input name="title" maxlength="180" value="${esc(p.title)}" required></label>
      <div class="field-grid"><label>Minutes<input type="number" name="minutes" min="5" max="240" value="${p.minutes}"></label><label>Stage<select name="stage">${STAGES.map(([k, l]) => `<option value="${k}" ${k === p.stage ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="row"><button class="btn btn-primary btn-sm">Add this step</button><button type="button" class="btn-text" data-act="dismiss-proposal">Not now</button></div></form>`
    : `<form class="proposal" data-form="proposal" data-thread="${esc(key)}" data-i="${i}"><h5>Remember this? · only saved if you approve</h5>
      <input type="hidden" name="type" value="remember"><input type="hidden" name="kind" value="${esc(p.kind)}">
      <label>Learning memory<input name="text" maxlength="240" value="${esc(p.text)}" required></label>
      <div class="row"><button class="btn btn-primary btn-sm">Remember</button><button type="button" class="btn-text" data-act="dismiss-proposal">No thanks</button></div></form>`).join('');
}

export function aiMessage(m, key, isLast = false) {
  const r = m.meta || {};
  return `<div class="msg ai"><div class="who">${nuruSVG(r.nuru || 'explaining', S.state.profile.companion_hue)}<b>${companionName()}</b>${modeLine(r)}</div>
    ${citations(r.supported)}
    <div class="bubble">${r.supported?.length ? `<div class="explain-label">${companionName()}'s explanation · not from your notes</div>` : ''}${rich(m.content)}</div>
    ${notesNote(r)}${r.sent?.length ? `<details class="disclose tiny"><summary>What was sent to the AI provider</summary><ul>${r.sent.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
    ${proposals(r.proposals, key)}
    ${r.suggestions?.length && isLast ? `<div class="chips">${r.suggestions.map(s => `<button class="chip" data-act="suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}</div>`;
}

function renderLog(key) {
  const msgs = thread(key);
  return msgs.map((m, i) => m.role === 'user' ? `<div class="msg user ${m.failed ? 'failed' : ''}"><div class="bubble">${rich(m.content)}</div>${m.failed ? `<div class="who" style="justify-content:flex-end"><span class="err">${esc(m.failed)} Your message is kept below.</span><button class="btn btn-sm btn-soft" data-act="retry" data-thread="${esc(key)}">Try again</button></div>` : ''}</div>` : aiMessage(m, key, i === msgs.length - 1)).join('');
}

/* ---------- contexts ---------- */
export function contextFor(params) {
  const [kind, id, sub, extra] = params;
  if (kind === 'a' && assignment(id)) {
    const a = assignment(id);
    if (sub === 'draft') return { key: `a:${id}:draft`, ctx: { type: 'assignment', id: a.id }, label: a.title, kindLabel: 'Assignment', intent: 'draft_request',
      sends: ['the assignment title, brief, due date and steps'], useNotes: false,
      prefill: `Please help me draft a short, polite message to my lecturer about "${a.title}". With my current availability, about ${extra || 'some'} minutes of work don't fit before the deadline (${a.due}). I'd like to ask about options.` };
    const step = sub === 's' ? a.steps.find(s => String(s.id) === String(extra)) : null;
    return { key: `a:${id}`, ctx: { type: 'assignment', id: a.id, ...(step ? { step_id: step.id } : {}) }, label: step ? `${step.title} · ${a.title}` : a.title, kindLabel: step ? 'Step' : 'Assignment',
      intent: step ? 'step_help' : 'assignment', sends: ['the assignment title, brief, due date and steps', ...(step ? ['the step you are working on'] : [])], useNotes: false,
      prompts: step ? [['What exactly does this step ask?'], ['Suggest a smaller first step'], ['Help me interpret the brief', 'assignment']]
        : [['Clarify the requirements'], ['Suggest a smaller step'], ['Help me interpret the brief']] };
  }
  if (kind === 'm') {
    const m = S.state.materials.find(x => String(x.id) === String(id));
    if (m) return { key: `m:${id}`, ctx: { type: 'material', id: m.id }, label: m.title, kindLabel: 'Notes', intent: 'chat', sends: ['matching passages from this material'], useNotes: true,
      prompts: [['Summarise the key ideas in these notes'], ['What should I make sure I understand here?']] };
  }
  if (kind === 'p') {
    const p = S.passages?.get(String(id));
    return { key: `p:${id}`, ctx: { type: 'passage', id: +id }, label: p ? `${p.material}${p.page ? ', p. ' + p.page : ''}` : 'Selected passage', kindLabel: 'Passage', intent: 'passage_explain',
      sends: ['the passage you selected'], useNotes: true, prompts: [['Explain this passage in plain words'], ['Give me an example of this'], ['Ask me a question about it', 'revise_recall']] };
  }
  if (kind === 'plan') return { key: 'plan', ctx: { type: 'plan' }, label: 'My study plan', kindLabel: 'Plan', intent: 'plan_help',
    sends: ['your availability, assignment titles, due dates, estimates and plan warnings'], useNotes: false,
    prompts: [["Why doesn't all my work fit?"], ['What could I adjust this week?'], ['Which deadline should come first?']] };
  if (kind === 'rev' && S.revise?.id === +id) {
    const R = S.revise;
    return { key: `rev:${id}`, ctx: { type: 'revision', id: R.id, previous_question: R.question || '' }, label: R.topic, kindLabel: 'Revision', intent: 'chat',
      sends: ['the revision topic', ...(R.materialIds?.length ? ['matching passages from the notes you chose'] : [])], useNotes: !!R.materialIds?.length,
      prompts: R.answered ? [['Give me a hint about what I missed', 'tutor_hint'], ['Show me a worked example', 'tutor_worked'], ['Explain it another way', 'tutor_explain']]
        : [['Give me a hint, not the answer', 'tutor_hint']] };
  }
  if (kind === 'r' && S.resultCtx) {
    const rc = S.resultCtx;
    return { key: `r:${rc.id || 'temp'}`, ctx: rc.context, label: `${rc.title}${rc.saved ? '' : ' (not saved)'}`, kindLabel: 'Result', intent: id || 'result_talk', sends: rc.sends, useNotes: false, prefill: rc.prefill || '' };
  }
  if (kind === 'support') return { key: 'support', ctx: null, label: '', intent: 'support_talk', sends: [], useNotes: false,
    prompts: [['I just need to get something off my chest'], ['I need a pause'], ['Help me pick one small thing']] };
  return { key: 'general', ctx: null, label: '', intent: 'chat', sends: [], useNotes: false,
    prompts: [['Can you explain a concept I\'m stuck on?'], ["I'm feeling behind. Can we pick one thing to start?"], ['Help me plan my week']] };
}

function predictedSends(c, useNotes) {
  const p = S.state.profile, out = ['your message', 'recent turns of this conversation'];
  if (c.sends?.length) out.push(...c.sends);
  if (useNotes && !c.sends.some(s => /passage/.test(s))) out.push('passages from your notes that match your question');
  if (p.share_workload) out.push('your workload summary (titles, due dates, estimates)');
  if (p.use_memory && S.state.memory.length) out.push(`${S.state.memory.length} learning-memory item(s)`);
  return out;
}

function greetingFor(c) {
  const p = S.state.profile;
  if (c.intent === 'support_talk') return `<p>I'm here, ${esc(p.name)}. How are you feeling? We can talk, take a pause, or choose one small next step. Whatever suits you.</p><p class="tiny muted">I'm an AI study buddy, not a counsellor. If things feel heavy, a friend, lecturer or campus support can help too.</p>`;
  if (c.ctx?.type === 'result') return `<p>I'm here. We can take this at whatever pace suits you.</p>`;
  if (c.ctx?.type === 'plan') return `<p>Let's look at your plan together. I can explain where things don't fit and what you could adjust. Nothing changes unless you approve it.</p>`;
  if (c.ctx?.type === 'passage') return `<p>You picked a passage from your notes. I can explain it, give an example, or ask you about it.</p>`;
  if (c.ctx?.type === 'revision') return `<p>I'm here while you revise. ${S.revise?.answered ? 'Ask for a hint, an example or another explanation.' : "Try the question first; I'll keep the explanation until you've had a go."}</p>`;
  if (c.ctx) return `<p>We're looking at <b>${esc(c.label)}</b> together. What would help first?</p>`;
  return `<p>Hello ${esc(p.name)}. I'm ${companionName()}, your AI study buddy. We can organize your work, understand something together, revise, or talk through how things are going.</p>`;
}

/** The chat component. Used by Talk to Nuru and by the Help me here panel. */
export function chatPanel(c, params, { compact = false } = {}) {
  const p = S.state.profile, live = S.state.ai.mode === 'live';
  const msgs = thread(c.key), draftKey = 'draft:' + c.key;
  if (!S.drafts.has(draftKey) && c.prefill) S.drafts.set(draftKey, c.prefill);
  const useNotes = S.drafts.has('notes:' + c.key) ? S.drafts.get('notes:' + c.key) : c.useNotes;
  const greeting = msgs.length ? '' : `<div class="msg ai"><div class="who">${nuruSVG('welcoming', p.companion_hue)}<b>${companionName()}</b><span class="tiny muted">Welcome note from the app</span></div><div class="bubble">${greetingFor(c)}</div></div>`;
  const prompts = (c.prompts || []).map(([t, intent]) => `<button class="chip" data-act="ask" data-text="${esc(t)}"${intent ? ` data-intent="${intent}"` : ''}>${esc(t)}</button>`).join('');
  return `${c.ctx ? `<div class="context-chip"><span class="tag lav">${esc(c.kindLabel || 'Context')}</span><span>Shared with ${companionName()}: <b>${esc(c.label)}</b></span>${compact ? '' : `<button class="icon-btn x" data-go="#/companion" aria-label="Talk without this context">${icon('close')}</button>`}</div>` : ''}
    <div class="chat-log" id="chat-log" aria-live="polite" aria-relevant="additions">${greeting}${renderLog(c.key)}</div>
    ${prompts ? `<div class="chips prompt-chips" role="group" aria-label="Quick requests">${prompts}</div>` : ''}
    <form class="composer" data-form="chat" data-thread="${esc(c.key)}" data-params="${esc(params.join('/'))}">
      <div class="composer-box">
        <label class="sr-only" for="chat-input">Message ${companionName()}</label>
        <textarea id="chat-input" name="message" maxlength="3000" rows="2" placeholder="Write to ${companionName()}… (Enter to send, Shift+Enter for a new line)">${esc(S.drafts.get(draftKey) || '')}</textarea>
        <div class="bar">
          ${c.ctx?.type === 'passage' ? '' : `<label class="toggle-mini"><input type="checkbox" name="use_notes" ${useNotes ? 'checked' : ''} data-notes-toggle> Use my notes</label>`}
          <details class="disclose tiny"><summary>${live ? 'What gets sent' : 'Demo mode: nothing is sent'}</summary>${live ? `<ul>${predictedSends(c, useNotes).map(s => `<li>${esc(s)}</li>`).join('')}</ul><span>Grades and check-in notes are only included when you choose them.</span>` : '<p style="margin:6px 0 0">No AI provider is configured, so replies are scripted and nothing leaves this installation.</p>'}</details>
          <button class="btn btn-primary btn-sm">${icon('send')}Send</button>
        </div>
      </div>
      ${p.remember_chat || compact ? '' : '<p class="tiny muted" style="margin:6px 4px 0">This conversation lasts while this tab is open. Saving history is off (see Settings).</p>'}
    </form>`;
}

export function mountChat(root, c, { focusInput = false } = {}) {
  const ta = $('#chat-input', root); if (!ta) return;
  const draftKey = 'draft:' + c.key;
  ta.addEventListener('input', () => { S.drafts.set(draftKey, ta.value); saveDrafts(); });
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ta.form.requestSubmit(); } });
  root.querySelector('[data-notes-toggle]')?.addEventListener('change', e => { S.drafts.set('notes:' + c.key, e.target.checked); });
  const log = $('#chat-log', root); if (log) log.scrollTop = log.scrollHeight;
  if (focusInput) ta.focus({ preventScroll: true });
}

function viewTalk(params) {
  const c = contextFor(params);
  return {
    title: c.intent === 'support_talk' ? `Talk with ${companionName()}` : c.ctx ? 'Talking it through' : `Talk to ${companionName()}`,
    sub: c.ctx ? esc(c.label) : 'Your AI study buddy. Always labelled as AI.', nuru: c.intent === 'support_talk' ? 'supporting' : 'listening', keepNuru: true,
    back: c.ctx?.type === 'assignment' ? `#/study/a/${c.ctx.id}` : c.ctx?.type === 'result' ? '#/journal' : '', bodyClass: 'chat-body',
    body: chatPanel(c, params),
    mount: root => { mountChat(root, c, { focusInput: thread(c.key).length > 0 || !!c.prefill }); const b = root.querySelector('.panel-body'); b.scrollTop = b.scrollHeight; },
  };
}

export async function sendChat(key, params, message, useNotes, intentOverride = null) {
  const c = contextFor(params.split('/').filter(Boolean));
  const msgs = thread(key);
  const history = msgs.filter(m => !m.failed).slice(-12).map(m => ({ role: m.role, content: m.content }));
  msgs.push({ role: 'user', content: message });
  S.drafts.delete('draft:' + key); saveDrafts();
  rerender();
  const log = $('#chat-log');
  log?.insertAdjacentHTML('beforeend', `<div class="msg ai" id="typing"><div class="who">${nuruSVG('thinking', S.state.profile.companion_hue)}<b>${companionName()}</b> is thinking…</div><div class="bubble typing" aria-label="${companionName()} is thinking"><i></i><i></i><i></i></div></div>`);
  scrollChatEnd();
  setNuru('thinking');
  try {
    const { chat } = await act('chat', { message, history, context: c.ctx, intent: intentOverride || c.intent, use_notes: useNotes, topic: c.ctx?.type === 'revision' ? c.label : '' }, { render: false, timeout: 45000 });
    msgs.push({ role: 'assistant', content: chat.reply, meta: chat });
    setNuru(chat.nuru || 'explaining');
    if (chat.mode === 'fallback') toast(`Live AI was unavailable, so a scripted fallback is shown (${FALLBACK_REASONS[chat.fallback_reason] || 'error'}).`, { error: true, ms: 7000 });
  } catch (e) {
    msgs[msgs.length - 1].failed = e.message;
    S.drafts.set('draft:' + key, message); saveDrafts(); // keep what they typed
    setNuru('supporting');
  }
  rerender();
  scrollChatEnd();
}

function scrollChatEnd() {
  const log = document.querySelector('#chat-log'); if (log) log.scrollTop = 1e9;
  const body = document.querySelector('.panel-body.chat-body'); if (body) body.scrollTop = 1e9;
}

/* ---------- "Help me understand something": explanation-first learning ---------- */
S.learn = S.learn || { topic: '', step: 1, turns: [], practice: '', feedback: null, useNotes: true };

function stepper(n) {
  const names = ['Ask', 'Explain', 'Try', 'Your reasoning', 'Feedback'];
  return `<ol class="stepper" aria-label="Learning steps">${names.map((l, i) => `<li class="${i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''}" ${i + 1 === n ? 'aria-current="step"' : ''}><b>${i + 1}</b>${l}</li>`).join('')}</ol>`;
}

export function feedbackBlock(r) {
  const verdictLabel = { on_track: ['sage', 'On track · checked by AI'], partly: ['amber', 'Partly there · checked by AI'], not_yet: ['lav', 'Not yet, and that’s useful to know'] }[r.verdict];
  return `<div class="msg ai" style="max-width:100%"><div class="who">${nuruSVG(r.nuru || 'explaining', S.state.profile.companion_hue)}<b>${companionName()}</b>${modeLine(r)}${verdictLabel ? `<span class="tag ${verdictLabel[0]}">${verdictLabel[1]}</span>` : ''}</div>
    ${citations(r.supported)}<div class="bubble">${rich(r.reply)}${r.next_activity ? `<p><b>Next:</b> ${esc(r.next_activity)}</p>` : ''}</div>
    ${r.verdict === 'self' ? `<div class="paper pad" style="padding:14px"><p class="small" style="margin:0 0 8px"><b>How confident do you feel?</b> This is a self-check, recorded as practice, not as a checked answer.</p>
      <div class="chips"><button class="chip" data-act="self-rate" data-id="${r.attempt_id}" data-rating="self_got">I think I've got it</button><button class="chip" data-act="self-rate" data-id="${r.attempt_id}" data-rating="self_unsure">Partly</button><button class="chip" data-act="self-rate" data-id="${r.attempt_id}" data-rating="self_not">Not yet</button></div></div>` : ''}
    ${r.attempt_id && r.verdict !== 'self' ? `<div class="row"><button class="btn-text" data-act="flag" data-id="${r.attempt_id}">${icon('flag')} This feedback seems wrong</button></div>` : ''}</div>`;
}

export function learnBody(params) {
  const L = S.learn;
  if (params[0] && params[0] !== L.topic && L.step === 1) L.topic = params[0];
  const due = S.state.concepts.filter(c => c.due);
  const turns = L.turns.map((t, i) => t.role === 'user' ? `<div class="msg user"><div class="bubble">${rich(t.content)}</div></div>` : aiMessage(t, 'learn', i === L.turns.length - 1)).join('');
  let stage = '';
  if (L.step === 1) {
    stage = `<form data-form="learn-start" class="stack">
      <label>What would you like to understand?<input name="topic" maxlength="200" required value="${esc(L.topic)}" placeholder="e.g. limiting factors in photosynthesis"></label>
      <label class="checkline"><input type="checkbox" name="use_notes" ${L.useNotes ? 'checked' : ''}><span>Look in my notes first<small>Statements backed by your notes are cited with the exact passage. Everything else is labelled as ${companionName()}'s own explanation.</small></span></label>
      <div class="row"><button class="btn btn-lamp">${icon('spark')}Explain it to me</button></div></form>
      ${due.length ? `<div class="section-title"><h2>Ready to revisit</h2></div><div class="chips">${due.map(c => `<button class="chip" data-act="learn-topic" data-topic="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>` : ''}`;
  } else if (L.step === 2 || L.step === 3) {
    stage = `<div class="paper pad" style="padding:16px"><p class="small" style="margin:0 0 10px"><b>What would help next?</b></p><div class="chips">
      <button class="chip" data-act="tutor" data-step="hint">A hint</button><button class="chip" data-act="tutor" data-step="worked">A worked example</button>
      <button class="chip" data-act="tutor" data-step="practice">A practice question</button><button class="chip" data-act="tutor" data-step="explain" data-again="1">Explain it differently</button></div>
      <div class="row" style="margin-top:10px"><button class="btn-text" data-act="learn-remember">Remember to revisit “${esc(L.topic)}”</button><button class="btn-text" data-act="learn-reset">Choose another topic</button></div></div>`;
  } else if (L.step === 4) {
    stage = `<form data-form="learn-answer" class="stack"><div><span class="jtab">Practice</span><p class="question-text">${esc(L.practice)}</p></div>
      <label>Explain your reasoning in your own words<textarea name="answer" maxlength="3000" required placeholder="It's fine to be unsure. Say what you think and why."></textarea></label>
      <div class="row"><button class="btn btn-primary">Check my thinking</button><button type="button" class="btn-text" data-act="tutor" data-step="hint">I'd like a hint first</button></div></form>`;
  } else if (L.step === 5) {
    stage = `${feedbackBlock(L.feedback)}<div class="row" style="margin-top:10px"><button class="btn btn-soft" data-act="tutor" data-step="practice">Another practice question</button><button class="btn btn-ghost" data-act="tutor" data-step="explain" data-again="1">Go over it again</button><button class="btn-text" data-act="learn-reset">New topic</button></div>
      <p class="tiny muted" style="margin-top:8px">This topic is now ready to revisit in Revise with ${companionName()}.</p>`;
  }
  return `${stepper(L.step)}<div class="chat-log learn-log" aria-live="polite">${turns}</div>${stage}`;
}

async function tutor(step, again = false) {
  const L = S.learn;
  const message = again ? `I'm still not sure about ${L.topic}. Could you explain it differently, more simply, with another example?` : { explain: `Help me understand ${L.topic}.`, hint: `Could I have a hint about ${L.topic}?`, worked: `Could you show a worked example about ${L.topic}?`, practice: `Give me a small practice question about ${L.topic}.` }[step];
  L.turns.push({ role: 'user', content: message });
  rerender();
  document.querySelector('.learn-log')?.insertAdjacentHTML('beforeend', `<div class="msg ai"><div class="bubble typing" aria-label="${companionName()} is thinking"><i></i><i></i><i></i></div></div>`);
  setNuru('thinking');
  try {
    const history = L.turns.slice(-8, -1).map(t => ({ role: t.role, content: t.content }));
    const { chat } = await act('tutor', { step, topic: L.topic, message, history, use_notes: L.useNotes }, { render: false, timeout: 45000 });
    L.turns.push({ role: 'assistant', content: chat.reply, meta: chat });
    if (step === 'practice') { L.practice = chat.practice_question; L.step = 4; } else L.step = 3;
    setNuru(chat.nuru || 'explaining');
  } catch (e) { L.turns.pop(); toast(e.message, { error: true }); setNuru('supporting'); }
  rerender();
}

export function register(V, A, F) {
  V.companion = params => params[0] === 'learn' ? { redirect: '#/study/understand' + (params[1] ? '/' + encodeURIComponent(params[1]) : '') } : viewTalk(params);
  Object.assign(A, {
    suggest: b => { const form = $('form[data-form="chat"]'); if (!form) { go('#/companion'); return; } form.querySelector('textarea').value = b.dataset.text; form.requestSubmit(); },
    ask: b => { const form = $('form[data-form="chat"]'); if (!form) return; sendChat(form.dataset.thread, form.dataset.params, b.dataset.text, !!form.querySelector('[name=use_notes]')?.checked, b.dataset.intent || null); },
    retry: b => { const key = b.dataset.thread, msgs = thread(key), last = msgs[msgs.length - 1]; if (!last?.failed) return; msgs.pop(); const form = $('form[data-form="chat"]'); sendChat(key, form.dataset.params, last.content, !!form.querySelector('[name=use_notes]')?.checked); },
    cite: async b => {
      const box = b.closest('.from-notes').querySelector('[data-passage]');
      if (b.getAttribute('aria-expanded') === 'true') { box.innerHTML = ''; b.setAttribute('aria-expanded', 'false'); return; }
      try { const p = await getPassage(b.dataset.id); box.innerHTML = `<div class="passage"><b>${esc(p.material)}${p.page ? `, page ${p.page}` : ''}</b>\n${esc(p.text)}</div>`; b.setAttribute('aria-expanded', 'true'); }
      catch (e) { toast(e.message, { error: true }); }
    },
    'dismiss-proposal': b => { b.closest('.proposal').remove(); },
    'learn-topic': b => { S.learn.topic = b.dataset.topic; rerender(); document.querySelector('[name=topic]')?.focus(); },
    'learn-reset': () => { S.learn = { topic: '', step: 1, turns: [], practice: '', feedback: null, useNotes: true }; go('#/study/understand'); },
    'learn-remember': b => guarded(b, () => act('memory_save', { kind: 'revisit', text: S.learn.topic }, { render: false, message: 'Saved to your learning memory. You can see it in Settings.' })),
    tutor: b => tutor(b.dataset.step, !!b.dataset.again),
    'self-rate': b => guarded(b, async () => { await act('check_self', { id: +b.dataset.id, rating: b.dataset.rating }, { render: false, message: 'Noted as a self-check. It is scheduled for review.' }); b.closest('.paper').innerHTML = '<p class="small" style="margin:0">Thanks. Recorded as a self-check (practice, not a checked answer).</p>'; }),
    flag: b => { const note = prompt('What seems wrong about this feedback? (optional)'); if (note === null) return; guarded(b, async () => { await act('check_flag', { id: +b.dataset.id, note }, { render: false, message: 'Flagged. This feedback no longer counts towards your record.' }); b.replaceWith(Object.assign(document.createElement('span'), { className: 'tiny muted', textContent: 'Flagged as possibly incorrect.' })); }); },
  });
  Object.assign(F, {
    chat: async (f, d) => {
      const message = (d.message || '').trim(); if (!message) return;
      await sendChat(f.dataset.thread, f.dataset.params, message, !!d.use_notes);
    },
    proposal: async (f, d) => {
      const key = f.dataset.thread, i = +f.dataset.i;
      await act('proposal_apply', d.type === 'add_step' ? { type: 'add_step', assignment_id: +d.assignment_id, title: d.title, minutes: +d.minutes, stage: d.stage } : { type: 'remember', kind: d.kind, text: d.text },
        { render: false, message: d.type === 'add_step' ? 'Added to your assignment. You approved it, so it’s yours to change.' : 'Remembered. You can edit or forget it in Settings.' });
      const msg = (key === 'learn' ? S.learn.turns : thread(key)).filter(m => m.meta?.proposals).at(-1);
      if (msg) msg.meta.proposals = msg.meta.proposals.filter((_, j) => j !== i);
      const { setState } = await import('../core.js'); const { getState } = await import('../api.js'); setState(await getState());
    },
    'learn-start': async (f, d) => { S.learn = { topic: d.topic.trim(), step: 2, turns: [], practice: '', feedback: null, useNotes: !!d.use_notes }; act('resume_save', { kind: 'understand', topic: S.learn.topic }, { render: false }).catch(() => {}); await tutor('explain'); },
    'learn-answer': async (f, d) => {
      const L = S.learn; setNuru('thinking');
      const { chat } = await act('check_submit', { question: L.practice, answer: d.answer, topic: L.topic, use_notes: L.useNotes }, { timeout: 45000, render: false });
      L.turns.push({ role: 'user', content: d.answer });
      L.feedback = chat; L.step = 5; setNuru(chat.nuru || 'explaining');
      rerender();
    },
  });
}
