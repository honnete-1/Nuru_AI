/* My Notes & Courses: courses, uploaded materials, notes, and topics to revisit. */
import { S, act, guarded, go, setState, companionName, course, rerender } from '../core.js';
import { esc, icon, fmtDate, toast, openDialog, closeDialog, $, plural } from '../util.js';
import { upload, getMaterialPassages } from '../api.js';
import { nuruSay } from '../scene.js';

const STATUS = { attempted: 'Attempted', practiced: 'Practised', checked: 'Checked' };
const STATUS_HELP = 'Attempted: you answered a check. Practised: several attempts, or a self-check. Checked: an answer was evaluated (live AI or an exact-answer challenge) as on track. These are records, not mastery scores.';

function materialRow(m) {
  const tone = m.status === 'ready' ? 'sage' : m.status === 'no_text' ? 'amber' : 'rose';
  const label = m.status === 'ready' ? `${plural(m.passages, 'passage')}${m.pages ? ` · ${m.pages} pages` : ''}` : m.status === 'no_text' ? 'No readable text' : 'Could not read';
  return `<li><button class="item clickable" data-go="#/library/m/${m.id}"><span class="main"><span class="title">${esc(m.title)}</span><span class="meta">${m.kind.toUpperCase()} · ${fmtDate(m.created_at)}${m.course_id && course(m.course_id) ? ' · ' + esc(course(m.course_id).name) : ''}</span></span><span class="tag ${tone}">${label}</span></button></li>`;
}

function courseOptions(sel = '') {
  return `<option value="">No course</option>${S.state.courses.map(c => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
}

function viewOverview() {
  const st = S.state;
  const due = st.concepts.filter(c => c.due), others = st.concepts.filter(c => !c.due);
  return {
    title: 'My Notes & Courses', sub: 'Your courses and materials, and the topics ready to revisit.', nuru: 'explaining',
    body: `<div class="section-title"><h2>Courses</h2><button class="btn-text" data-act="course-new">${icon('plus')} Add course</button></div>
      ${st.courses.length ? `<div class="chips">${st.courses.map(c => `<button class="chip" data-act="course-edit" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>` : '<p class="small muted">Courses appear here when you add one or create an assignment.</p>'}

      <div class="section-title"><h2>Materials &amp; notes</h2></div>
      <div class="paper pad stack">
        <form data-form="upload" class="stack" style="gap:10px" enctype="multipart/form-data">
          <label>Upload a PDF or TXT<input type="file" name="file" accept=".pdf,.txt,application/pdf,text/plain" required><span class="hint">Text-based files up to 5 MB. Files stay private to your account and are never placed in public folders. Scanned (image-only) PDFs can't be read yet; you'll be told rather than shown guesses.</span></label>
          <div class="field-grid"><label>Title (optional)<input name="title" maxlength="160"></label><label>Course<select name="course_id">${courseOptions()}</select></label></div>
          <div class="row"><button class="btn btn-soft">${icon('upload')}Upload and index</button></div>
        </form>
        <details class="disclose"><summary>Or write a note</summary>
          <form data-form="note" class="stack" style="gap:10px;margin-top:10px"><div class="field-grid"><label>Title<input name="title" maxlength="160" required></label><label>Course<select name="course_id">${courseOptions()}</select></label></div>
          <label>Note<textarea name="body" maxlength="20000" required placeholder="Lecture notes, definitions, a summary in your own words…"></textarea></label><div class="row"><button class="btn btn-soft">Save note</button></div></form></details>
      </div>
      ${st.materials.length ? `<ul class="list" style="margin-top:12px">${st.materials.map(materialRow).join('')}</ul>` : '<div class="empty" style="margin-top:12px"><p>No notes yet. Add notes so explanations can point to your own material.</p></div>'}

      <div class="section-title"><h2>Ready to revisit</h2><button class="btn btn-soft btn-sm" data-go="#/study/revise">${icon('spark')}Revise with ${companionName()}</button></div>
      <p class="tiny muted" style="margin:-4px 0 10px">${STATUS_HELP}</p>
      ${due.length ? `<ul class="list">${due.map(conceptRow).join('')}</ul>` : '<p class="small muted">Nothing due today.</p>'}
      ${others.length ? `<details class="disclose" style="margin-top:10px"><summary>All practised concepts (${others.length})</summary><ul class="list" style="margin-top:8px">${others.map(conceptRow).join('')}</ul></details>` : ''}`,
  };
}

function conceptRow(c) {
  return `<li class="item"><div class="main"><div class="title">${esc(c.name)}</div><div class="meta">${plural(c.attempts, 'attempt')}${c.next_review ? ` · review ${c.due ? 'now' : fmtDate(c.next_review)}` : ''}${c.last?.flagged ? ' · last feedback flagged' : ''}</div></div>
    <span class="status-pill ${c.status}">${STATUS[c.status] || c.status}</span>
    <button class="btn btn-sm btn-soft" data-act="learn-review" data-topic="${esc(c.name)}">Review</button>
    <button class="icon-btn" data-act="concept-delete" data-id="${c.id}" aria-label="Remove ${esc(c.name)} from topics to revisit">${icon('trash')}</button></li>`;
}

function viewMaterial(id) {
  const m = S.state.materials.find(x => String(x.id) === String(id));
  if (!m) return { title: 'Not found', back: '#/library', body: '<div class="empty"><p>This material was deleted.</p></div>' };
  const status = m.status === 'ready' ? `<div class="notice sage">${icon('check')}<p>Indexed into ${plural(m.passages, 'passage')}. Answers that use it will cite the passage${m.kind === 'pdf' ? ' and page' : ''}.${m.status_detail ? ' ' + esc(m.status_detail) : ''}</p></div>`
    : `<div class="notice ${m.status === 'error' ? 'rose' : ''}">${icon('info')}<p>${esc(m.status_detail)}</p></div>`;
  return {
    title: esc(m.title), sub: `${m.kind.toUpperCase()} · added ${fmtDate(m.created_at)}`, back: '#/library', nuru: 'studying',
    body: `${status}
      <div class="row" style="margin:14px 0">${m.status === 'ready' ? `<button class="btn btn-lamp" data-go="#/study/m/${m.id}">Study these notes together</button><button class="btn btn-ghost" data-act="revise-these" data-id="${m.id}">Revise these notes</button>` : ''}
        <a class="btn btn-ghost" href="/api/materials/${m.id}/file/">${icon('download')}Download</a>
        <button class="btn-text" style="color:var(--rose)" data-act="material-delete" data-id="${m.id}">Delete</button></div>
      ${m.status === 'ready' ? '<div class="section-title"><h2>Extracted passages</h2><span class="tiny muted">exactly what citations point to</span></div><div id="passages"><div class="typing"><i></i><i></i><i></i></div></div>' : ''}`,
    mount: async root => {
      if (m.status !== 'ready') return;
      try {
        const r = await getMaterialPassages(m.id);
        const box = $('#passages', root); if (!box) return;
        box.innerHTML = r.passages.map(p => `<div class="passage" style="margin-bottom:8px"><b>${p.page ? 'Page ' + p.page : 'Passage'}</b>\n${esc(p.text)}</div>`).join('') + (r.total > r.passages.length ? `<p class="tiny muted">Showing ${r.passages.length} of ${r.total}.</p>` : '');
      } catch (e) { const box = $('#passages', root); if (box) box.innerHTML = `<p class="small">${esc(e.message)}</p>`; }
    },
  };
}

function courseDialog(c = {}) {
  const inner = openDialog(c.id ? 'Edit course' : 'Add a course', `<form data-form="course" class="stack">${c.id ? `<input type="hidden" name="id" value="${c.id}">` : ''}
    <label>Course name<input name="name" maxlength="80" required value="${esc(c.name || '')}"></label>
    <label>A goal for this course (optional)<input name="goal" maxlength="240" value="${esc(c.goal || '')}" placeholder="e.g. feel confident explaining the key models"></label>
    <label>Colour<select name="colour">${['lavender', 'sage', 'amber', 'ink'].map(k => `<option ${c.colour === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <div class="row"><button class="btn btn-primary">Save</button>${c.id ? `<button type="button" class="btn-text" style="color:var(--rose)" data-act="course-delete" data-id="${c.id}">Delete course</button>` : ''}</div></form>`);
  return inner;
}

export function register(V, A, F) {
  V.library = params => params[0] === 'm' ? viewMaterial(params[1]) : viewOverview();
  Object.assign(A, {
    'course-new': () => courseDialog(),
    'course-edit': b => courseDialog(course(b.dataset.id)),
    'course-delete': b => { if (confirm('Delete this course? Assignments and materials stay, just without a course.')) guarded(b, async () => { await act('course_delete', { id: +b.dataset.id }, { message: 'Course removed.' }); closeDialog(); }); },
    'material-delete': b => { if (confirm('Delete this material and its stored file?')) guarded(b, async () => { await act('material_delete', { id: +b.dataset.id }, { render: false, message: 'Deleted, including the stored file.' }); go('#/library'); }); },
    'concept-delete': b => guarded(b, () => act('concept_delete', { id: +b.dataset.id }, { message: 'Removed from topics to revisit.' })),
    'learn-review': b => { S.revise = null; S.reviseSetup = { topic: b.dataset.topic }; location.hash = '#/study/revise'; },
  });
  Object.assign(F, {
    upload: async f => {
      const fd = new FormData(f);
      const file = fd.get('file');
      if (!file || !file.size) { toast('Choose a file first.', { error: true }); return; }
      if (file.size > 5 * 1024 * 1024) { toast('That file is over 5 MB.', { error: true }); return; }
      const r = await upload(fd);
      setState(r.state);
      toast(r.status === 'ready' ? 'Indexed. You can now ask about it.' : 'Uploaded, but no readable text was found. See the note on the material.', { error: r.status !== 'ready', ms: 7000 });
      if (r.status === 'ready') nuruSay('I can look through that now. Answers that use it will show the exact passage.', 'explaining');
      location.hash = `#/library/m/${r.material_id}`;
    },
    note: async (f, d) => { const r = await act('note_save', { title: d.title, body: d.body, course_id: d.course_id || null }, { render: false, message: 'Note saved and indexed.' }); go(`#/library/m/${r.material_id}`); },
    course: async (f, d) => { await act('course_save', { id: d.id ? +d.id : null, name: d.name, goal: d.goal, colour: d.colour }, { message: 'Saved.' }); closeDialog(); },
  });
}
