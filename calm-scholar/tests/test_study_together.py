"""Regression tests for the Study Together redesign.

Covers: clear terminology, the Today screen, "Help me here" contexts and their
ownership checks, resume pointers, working notes, the recall-first revision
journey, feeling-first results, rewards and AI failure handling.
All provider calls are mocked; none of this is evidence of live-model quality.
"""
import json
import re
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
from django.test import Client, override_settings
from django.utils import timezone

from conftest import make_student, post
from scholar.models import (Assignment, CheckAttempt, CheckIn, Concept, FocusLog, Material, Passage, ResultEntry,
                            RevisionSession, RewardEvent, StudySession, Subtask)

pytestmark = pytest.mark.django_db
LIVE = override_settings(OPENAI_API_KEY='test-key-not-real')
ROOT = Path(__file__).resolve().parent.parent


def front_end_text():
    files = list((ROOT / 'templates').rglob('*.html')) + list((ROOT / 'static/js/app').rglob('*.js')) + [ROOT / 'static/js/landing.js']
    return '\n'.join(f.read_text(encoding='utf-8') for f in files)


def make_assignment(user, title='Essay', steps=('Read the brief', 'Draft the intro')):
    a = Assignment.objects.create(user=user, title=title, course='History', due=timezone.localdate() + timedelta(days=5), minutes=120, description='Write 1500 words.')
    for i, t in enumerate(steps):
        Subtask.objects.create(assignment=a, title=t, minutes=25, order=i)
    return a


def make_note(client, title='Cell notes', body='Mitochondria release energy through respiration. Ribosomes build proteins from amino acids.'):
    return post(client, 'note_save', title=title, body=body).json()['material_id']


# ---------------------------------------------------------------- 1. terminology and first action
def test_old_room_terminology_is_gone_from_the_interface():
    text = front_end_text()
    for phrase in ['Noticeboard', 'Bookshelf', 'Keepsake shelf', 'Enter my room', 'Open the adventure', 'Back to my room',
                   'Ordinary code (not AI)', 'Choose anything in the room', 'Your room', 'Results Journal</button>']:
        assert phrase not in text, phrase
    assert "I'm ${esc(nm)}, your AI study buddy. We can organize your work, understand something together, revise, or talk through how things are going." in text
    assert 'Start studying with Nuru' in text and 'View assignment steps' in text and 'Back to Today' in text


def test_today_offers_six_clear_actions_grouped_by_purpose():
    js = (ROOT / 'static/js/app/views/today.js').read_text(encoding='utf-8')
    assert 'What would help you today?' in js
    for label in ['Help me understand something', 'Work on an assignment', 'Revise with me', 'Plan my study time', 'I got my results', 'I need to talk']:
        assert label in js
    for group in ['Organize', 'Learn &amp; revise', 'Talk it through']:
        assert group in js
    for card in ["Today's next step", 'Upcoming deadlines', 'Continue where we stopped', 'Ready to revisit']:
        assert card in js


def test_a_new_student_sees_honest_empty_state(client, student):
    st = client.get('/api/state/').json()
    assert st['assignments'] == [] and st['concepts'] == [] and st['resume'] is None and st['next_action'] == {'kind': 'empty'}
    assert st['progress'] == {'steps_done': 0, 'assignments_done': 0, 'focus_sessions': 0, 'practice_attempts': 0,
                              'checked_on_track': 0, 'self_checks': 0, 'revisions_finished': 0}


def test_study_together_controls_are_real_buttons_with_text():
    js = (ROOT / 'static/js/app/views/study.js').read_text(encoding='utf-8')
    assert js.count('Help me here') >= 3 and 'data-act="companion-collapse"' in js and 'aria-expanded' in js
    assert 'Back to Today' in js and 'Switch task' in js and 'Escape' in js
    assert not re.search(r'<(div|span|g)[^>]*data-act=', js)  # actions are never on non-button elements


# ---------------------------------------------------------------- 2. help me here: assignment step
def test_help_with_a_step_shares_that_step_and_proposals_wait_for_approval(client, student):
    a = make_assignment(student)
    step = a.steps.first()
    chat = post(client, 'chat', message='Help me here', context={'type': 'assignment', 'id': a.id, 'step_id': step.id}, intent='step_help').json()['chat']
    assert chat['mode'] == 'demo' and 'The step you are working on: Read the brief' in chat['would_send']
    assert chat['proposals'] and chat['proposals'][0]['assignment_id'] == a.id
    assert a.steps.count() == 2  # a suggestion is only a proposal
    post(client, 'proposal_apply', type='add_step', assignment_id=a.id, title='Edited by me', minutes=10, stage='discover')
    assert a.steps.filter(title='Edited by me').exists()


def test_step_context_must_belong_to_the_assignment_and_the_student(client, student):
    a, b = make_assignment(student, 'A'), make_assignment(student, 'B')
    other = make_assignment(make_student('other'), 'Theirs')
    assert post(client, 'chat', message='hi', context={'type': 'assignment', 'id': a.id, 'step_id': b.steps.first().id}).status_code == 404
    assert post(client, 'chat', message='hi', context={'type': 'assignment', 'id': other.id}).status_code == 404


def test_live_step_help_sends_only_the_chosen_context(client, student):
    a = make_assignment(student)
    ResultEntry.objects.create(user=student, title='Secret exam', result_kind='percent', score=41, feeling='disappointed')
    CheckIn.objects.create(user=student, mood='low', energy='gentle', note='private note')
    with LIVE, patch('scholar.ai.completion', return_value={'reply': 'Start by listing the verbs.'}) as call:
        chat = post(client, 'chat', message='What does this step ask?', context={'type': 'assignment', 'id': a.id, 'step_id': a.steps.first().id}, intent='step_help').json()['chat']
    payload = json.dumps(call.call_args.args[1])
    assert chat['mode'] == 'live' and 'Read the brief' in payload
    assert 'Secret exam' not in payload and 'private note' not in payload  # grades and check-ins are never sent automatically
    assert 'step_help' in call.call_args.args[0] or 'Help me here' in call.call_args.args[0]


# ---------------------------------------------------------------- 3. help me here: notes, plan, support
def test_selected_passage_is_cited_and_owned(client, student):
    mid = make_note(client)
    pz = Passage.objects.filter(material_id=mid).first()
    chat = post(client, 'chat', message='Explain this', context={'type': 'passage', 'id': pz.id}, intent='passage_explain').json()['chat']
    assert chat['supported'] and chat['supported'][0]['citations'][0]['id'] == pz.id
    other = Client(); other.force_login(make_student('reader2'))
    assert post(other, 'chat', message='Explain', context={'type': 'passage', 'id': pz.id}).status_code == 404


def test_plan_help_explains_conflicts_without_changing_anything(client, student):
    Assignment.objects.create(user=student, title='Huge thesis', course='X', due=timezone.localdate() + timedelta(days=1), minutes=1400)
    with LIVE, patch('scholar.ai.completion', return_value={'reply': 'About 20 hours do not fit before tomorrow.'}) as call:
        chat = post(client, 'chat', message="Why doesn't my work fit?", context={'type': 'plan'}, intent='plan_help').json()['chat']
    data = call.call_args.args[1]['data']['context']
    assert chat['mode'] == 'live' and any(al['kind'] == 'infeasible' for al in data['alerts'])
    assert data['availability']['minutes_per_day'] == 120 and 'results' not in json.dumps(data)
    assert not StudySession.objects.filter(user=student).exists()  # nothing saved without approval
    assert Assignment.objects.get(title='Huge thesis').due == timezone.localdate() + timedelta(days=1)  # deadline untouched


def test_i_need_to_talk_starts_without_records_and_asks_how_they_feel(client, student):
    make_assignment(student)
    with LIVE, patch('scholar.ai.completion', return_value={'reply': 'I am here. How are you feeling?', 'nuru': 'supporting'}) as call:
        chat = post(client, 'chat', message='Everything feels like too much', intent='support_talk').json()['chat']
    assert chat['mode'] == 'live' and call.call_args.args[1]['data']['context'] is None
    assert 'Do not push productivity' in call.call_args.args[0]
    demo = post(client, 'chat', message='rough week', intent='support_talk').json()['chat']
    assert demo['mode'] == 'demo' and 'feeling' in demo['reply'] and demo['nuru'] == 'supporting'


# ---------------------------------------------------------------- 4. resume and drafts
def test_resume_pointer_is_validated_and_survives_reload(client, student):
    a = make_assignment(student)
    step = a.steps.last()
    assert post(client, 'resume_save', kind='assignment', id=a.id, step_id=step.id).status_code == 200
    r = client.get('/api/state/').json()['resume']
    assert r['kind'] == 'assignment' and r['id'] == a.id and r['step'] == 'Draft the intro'
    other = make_assignment(make_student('x'))
    assert post(client, 'resume_save', kind='assignment', id=other.id).status_code == 404
    assert post(client, 'resume_save', kind='assignment', id=a.id, step_id=other.steps.first().id).status_code == 404
    post(client, 'assignment_toggle', id=a.id)  # finished work is not offered as "continue"
    assert client.get('/api/state/').json()['resume'] is None


def test_working_notes_are_private_saved_and_exported(client, student):
    a = make_assignment(student)
    assert post(client, 'working_notes', id=a.id, notes='Quote from p.12 to check').status_code == 200
    assert client.get('/api/state/').json()['assignments'][0]['working_notes'] == 'Quote from p.12 to check'
    assert 'Quote from p.12' in client.get('/api/export/').content.decode()
    intruder = Client(); intruder.force_login(make_student('intruder'))
    assert post(intruder, 'working_notes', id=a.id, notes='overwrite').status_code == 404
    assert Assignment.objects.get(pk=a.id).working_notes == 'Quote from p.12 to check'


def test_focus_session_records_its_step_once(client, student):
    a, b = make_assignment(student, 'A'), make_assignment(student, 'B')
    token = 'tok-12345678'
    r1 = post(client, 'focus_log', minutes=25, goal='Read', assignment_id=a.id, step_id=a.steps.first().id, client_token=token).json()
    r2 = post(client, 'focus_log', minutes=25, goal='Read', assignment_id=a.id, step_id=a.steps.first().id, client_token=token).json()
    assert r2['duplicate'] and FocusLog.objects.filter(user=student).count() == 1
    assert FocusLog.objects.get(pk=r1['focus_id']).subtask_id == a.steps.first().id
    assert post(client, 'focus_log', minutes=5, assignment_id=a.id, step_id=b.steps.first().id, client_token='tok-abcdefgh').status_code == 404


def test_avatar_choices_are_validated(client, student):
    post(client, 'avatar_save', avatar={'hair': 'curly', 'outfit': 'sage'})
    assert client.get('/api/state/').json()['profile']['avatar'] == {'skin': 's2', 'hair': 'curly', 'outfit': 'sage'}
    assert post(client, 'avatar_save', avatar={'hair': '<script>'}).status_code == 400


# ---------------------------------------------------------------- 5. revise with Nuru
def test_revision_journey_recall_first_then_summary_and_review(client, student):
    mid = make_note(client)
    exam = timezone.localdate() + timedelta(days=3)
    rid = post(client, 'revision_start', topic='Cell organelles', material_ids=[mid], minutes=20, assessment_date=str(exam)).json()['revision_id']
    q1 = post(client, 'revision_question', id=rid).json()['chat']
    assert q1['practice_question'] and q1['supported'] == [] and q1['mode'] == 'demo'  # nothing revealed before the attempt
    fb = post(client, 'revision_answer', id=rid, question=q1['practice_question'], answer='Mitochondria make energy.').json()['chat']
    assert fb['verdict'] == 'self'  # demo mode never claims to check an answer
    post(client, 'check_self', id=fb['attempt_id'], rating='self_unsure')
    q2 = post(client, 'revision_question', id=rid, previous_question=q1['practice_question']).json()['chat']
    assert q2['practice_question'] != q1['practice_question']
    post(client, 'revision_answer', id=rid, question=q2['practice_question'], answer='Ribosomes build proteins.')
    res = post(client, 'revision_finish', id=rid, confidence='some').json()
    s = res['summary']
    assert s['questions'] == 2 and s['checked_on_track'] == 0 and s['self_checks'] == 2 and s['confidence'] == 'some'
    assert timezone.localdate() < timezone.datetime.fromisoformat(s['next_review']).date() <= exam - timedelta(days=1)
    assert CheckAttempt.objects.filter(revision_id=rid).count() == 2
    assert RewardEvent.objects.filter(user=student, key='first_revision').count() == 1
    post(client, 'revision_finish', id=rid, confidence='good')  # repeating never grants twice
    assert RewardEvent.objects.filter(user=student, key='first_revision').count() == 1
    assert post(client, 'revision_question', id=rid).status_code == 404  # finished sessions are closed


def test_live_revision_distinguishes_checked_answers_and_flags(client, student):
    rid = post(client, 'revision_start', topic='Osmosis').json()['revision_id']
    with LIVE, patch('scholar.ai.completion', side_effect=[
            {'reply': 'Practice: What drives water across a membrane?'},
            {'reply': 'Yes: a concentration gradient.', 'verdict': 'on_track', 'next_activity': 'Try a plant-cell example.'}]) as call:
        q = post(client, 'revision_question', id=rid).json()['chat']
        assert q['practice_question'] == 'What drives water across a membrane?' and q['mode'] == 'live'
        assert 'Do NOT explain the topic or reveal the answer' in call.call_args.args[0]
        fb = post(client, 'revision_answer', id=rid, question=q['practice_question'], answer='Differences in water concentration.').json()['chat']
    assert fb['verdict'] == 'on_track' and fb['mode'] == 'live'
    post(client, 'check_flag', id=fb['attempt_id'], note='Not quite right')
    s = post(client, 'revision_finish', id=rid).json()['summary']
    assert s['checked_on_track'] == 0 and s['flagged'] == 1  # flagged feedback never counts


def test_revision_failures_are_labelled_and_sessions_are_private(client, student):
    rid = post(client, 'revision_start', topic='Entropy').json()['revision_id']
    with LIVE, patch('scholar.ai.completion', side_effect=ai_failure()):
        q = post(client, 'revision_question', id=rid).json()['chat']
    assert q['mode'] == 'fallback' and q['fallback_reason'] == 'timeout' and q['practice_question']
    other = Client(); other.force_login(make_student('peer'))
    for action in ('revision_question', 'revision_answer', 'revision_finish'):
        assert post(other, action, id=rid, question='q', answer='a').status_code == 404
    theirs = Material.objects.create(user=make_student('third'), title='Not yours', kind='note')
    assert post(client, 'revision_start', topic='X', material_ids=[theirs.id]).status_code == 404
    assert post(client, 'revision_start', topic='X', assessment_date='soon').status_code == 400


def ai_failure():
    from scholar.ai import ProviderFailure
    def raise_timeout(*a, **k):
        raise ProviderFailure('timeout')
    return raise_timeout


# ---------------------------------------------------------------- 6. results: feeling first
@pytest.mark.parametrize('score,feeling,first_option', [(92, 'disappointed', 'talk'), (48, 'proud', 'celebrate'), (70, 'mixed', 'talk')])
def test_results_follow_the_stated_feeling_not_the_mark(client, student, score, feeling, first_option):
    r = post(client, 'result_open', title='Essay', result_kind='percent', score=score, feeling=feeling, save=True).json()
    keys = [o['key'] for o in r['opening']['options']]
    assert keys[0] == first_option
    if feeling == 'disappointed':
        assert 'question' in keys and 'pause' in keys and keys.index('plan') > keys.index('talk')  # no forced checklist
    assert post(client, 'result_update', id=r['result_id'], support='question').status_code == 200
    assert not RewardEvent.objects.filter(user=student).exists()  # grades never earn rewards


def test_lecturer_question_uses_only_consented_fields(client, student):
    rid = post(client, 'result_open', title='Lab', result_kind='percent', score=55, feedback='Link structure to function.', feeling='worried', save=True).json()['result_id']
    with LIVE, patch('scholar.ai.completion', return_value={'reply': 'You could ask: could you show an example?'}) as call:
        chat = post(client, 'chat', message='Help me ask my lecturer', intent='result_question',
                    context={'type': 'result', 'id': rid, 'share': {'feedback': True}}).json()['chat']
    ctx = call.call_args.args[1]['data']['context']
    assert chat['mode'] == 'live' and ctx['lecturer_feedback'] and 'result' not in ctx  # the mark stayed private
