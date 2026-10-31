/* Reusable guided challenge: order a process, spot an error, or explain a concept.
   One component for every subject. Order challenges are checked by the server,
   deterministically; explanations go through the companion's feedback step. */
import { act, guarded, S } from '../core.js';
import { esc, icon, rich } from '../util.js';
import { modeLine, feedbackBlock } from './companion.js';

export function challengeLauncher(topic, assignmentId = '') {
  return `<div class="paper challenge" data-challenge-root data-topic="${esc(topic)}" data-assignment="${assignmentId}">
    <h3 style="margin:0 0 4px">Guided challenge</h3>
    <p class="small muted" style="margin:0 0 12px">A short, optional way to practise. Hints are always there, and you can ask for another explanation.</p>
    <div class="chips" role="group" aria-label="Challenge type">
      <button class="chip" data-act="challenge-new" data-kind="order">Put a process in order</button>
      <button class="chip" data-act="challenge-new" data-kind="spot_error">Find the error</button>
      <button class="chip" data-act="challenge-new" data-kind="explain">Explain it</button>
    </div><div data-challenge-out aria-live="polite"></div></div>`;
}

function renderOrder(out, ch) {
  out.dataset.order = JSON.stringify(ch.items.map((_, i) => i));
  const draw = () => {
    const order = JSON.parse(out.dataset.order);
    out.querySelector('.order-list').innerHTML = order.map((idx, pos) => `<li data-pos="${pos}"><span>${esc(ch.items[idx])}</span>
      <button class="icon-btn" data-act="ord-move" data-dir="-1" data-pos="${pos}" aria-label="Move up: ${esc(ch.items[idx])}" ${pos === 0 ? 'disabled' : ''}>${icon('up')}</button>
      <button class="icon-btn" data-act="ord-move" data-dir="1" data-pos="${pos}" aria-label="Move down: ${esc(ch.items[idx])}" ${pos === order.length - 1 ? 'disabled' : ''}>${icon('down')}</button></li>`).join('');
  };
  out.innerHTML = `${modeLine(ch)}<p style="margin:10px 0 0"><b>${esc(ch.prompt)}</b></p><p class="tiny muted">Use the arrow buttons to reorder. No dragging needed.</p>
    <ol class="order-list"></ol>${hints(ch)}
    <div class="row"><button class="btn btn-primary btn-sm" data-act="challenge-check">Check my order</button></div><div data-challenge-result></div>`;
  out._draw = draw; draw();
}

const hints = ch => ch.hints?.length ? `<details class="disclose" style="margin:8px 0"><summary>Need a hint?</summary><ul>${ch.hints.map(h => `<li>${esc(h)}</li>`).join('')}</ul></details>` : '';

function renderText(out, ch) {
  out.innerHTML = `${modeLine(ch)}<p style="margin:10px 0 6px"><b>${esc(ch.prompt)}</b></p>
    ${ch.statement ? `<blockquote class="passage" style="border-left-color:var(--amber)">${esc(ch.statement)}</blockquote>` : ''}${hints(ch)}
    <form data-form="challenge-answer" class="stack" style="gap:8px"><label>Your answer, in your own words<textarea name="answer" maxlength="3000" required></textarea></label>
    <div class="row"><button class="btn btn-primary btn-sm">Send for feedback</button><button type="button" class="btn-text" data-act="challenge-new" data-kind="explain">Explain it differently</button></div></form><div data-challenge-result></div>`;
}

export function register(V, A, F) {
  Object.assign(A, {
    'challenge-new': b => {
      const root = b.closest('[data-challenge-root]'), out = root.querySelector('[data-challenge-out]');
      return guarded(b, async () => {
        out.innerHTML = '<div class="typing" aria-label="Preparing a challenge"><i></i><i></i><i></i></div>';
        const { challenge: ch } = await act('challenge_new', { topic: root.dataset.topic, kind: b.dataset.kind, assignment_id: root.dataset.assignment || null }, { render: false });
        ch.type === 'order' ? renderOrder(out, ch) : renderText(out, ch);
      }).then(r => { if (r === null) out.innerHTML = ''; });
    },
    'ord-move': b => {
      const out = b.closest('[data-challenge-out]'); const order = JSON.parse(out.dataset.order);
      const pos = +b.dataset.pos, to = pos + +b.dataset.dir;
      [order[pos], order[to]] = [order[to], order[pos]]; out.dataset.order = JSON.stringify(order); out._draw();
      out.querySelectorAll('[data-act="ord-move"]')[to * 2 + (+b.dataset.dir > 0 ? 1 : 0)]?.focus();
    },
    'challenge-check': b => {
      const out = b.closest('[data-challenge-out]');
      return guarded(b, async () => {
        const { challenge_result: r } = await act('challenge_submit', { order: JSON.parse(out.dataset.order) }, { render: false });
        const lis = out.querySelectorAll('.order-list li');
        lis.forEach((li, i) => { li.classList.toggle('right', r.correct || (r.first_wrong !== null && i < r.first_wrong)); li.classList.toggle('wrong', !r.correct && i === r.first_wrong); });
        out.querySelector('[data-challenge-result]').innerHTML = `<div class="notice ${r.correct ? 'sage' : 'lav'}" style="margin-top:10px"><p>${esc(r.feedback)}</p></div>`;
        if (r.correct) b.remove();
      });
    },
  });
  Object.assign(F, {
    'challenge-answer': async (f, d) => {
      const out = f.closest('[data-challenge-out]'), res = out.querySelector('[data-challenge-result]');
      res.innerHTML = '<div class="typing" aria-label="Reading your answer"><i></i><i></i><i></i></div>';
      try {
        const { chat } = await act('challenge_submit', { answer: d.answer }, { render: false });
        res.innerHTML = feedbackBlock(chat);
      } catch (e) { res.innerHTML = `<div class="notice rose"><p>${esc(e.message)} Your answer is still in the box.</p></div>`; throw e; }
    },
  });
}
