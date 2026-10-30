"""Original workflow tests from the starting project, updated for the new API shape."""
import json
from datetime import timedelta
from unittest.mock import patch
import pytest
from django.contrib.auth.models import User
from django.test import Client, override_settings
from django.utils import timezone
from scholar.models import Profile, Assignment, Subtask, StudySession, CheckIn, ChatMessage
from scholar.planner import propose_plan
from scholar import ai
from conftest import post

pytestmark = pytest.mark.django_db

def make_assignment(student, days=2, minutes=90):
    return Assignment.objects.create(user=student, title='Research project', course='Research', due=timezone.localdate()+timedelta(days=days), minutes=minutes)

def test_all_pages_render(client):
    for url in ['/', '/app/', '/accounts/register/', '/accounts/login/', '/health/']:
        assert client.get(url).status_code == 200
    response = client.get('/api/state/').json()
    assert response['profile']['name'] == 'Student'
    assert response['profile']['remember_chat'] is False

def test_authentication_required():
    for url in ['/app/', '/api/state/', '/api/export/']:
        assert Client().get(url).status_code == 302
    assert post(Client(), 'profile', name='Intruder').status_code == 302

def test_signup_validation_and_login():
    c = Client()
    r = c.post('/accounts/register/', {'username':'newstudent','display_name':'Honnete','password1':'My-long-uncommon-987!','password2':'My-long-uncommon-987!'})
    assert r.status_code == 302
    assert c.get('/api/state/').json()['profile']['name'] == 'Honnete'
    assert c.get('/accounts/logout/').status_code == 405
    assert c.post('/accounts/logout/').status_code == 302

def test_assignment_crud_and_step_edit(client, student):
    r = post(client,'assignment_save',title='Python assignment',course='Python',due=str(timezone.localdate()+timedelta(days=2)),minutes=100,priority='high')
    assert r.status_code == 200
    a = Assignment.objects.get(user=student)
    r = post(client,'breakdown',id=a.id)
    assert r.json()['mode'] == 'demo'
    assert 3 <= a.steps.count() <= 8
    assert sum(a.steps.values_list('minutes',flat=True)) == 100
    s = a.steps.first()
    assert post(client,'step_save',assignment_id=a.id,id=s.id,title='Read one example',minutes=10).status_code == 200
    post(client,'step_toggle',id=s.id)
    s.refresh_from_db()
    assert s.completed
    post(client,'assignment_toggle',id=a.id)
    assert not a.steps.filter(completed=False).exists()
    post(client,'step_save',assignment_id=a.id,title='One more review',minutes=10)
    a.refresh_from_db()
    assert not a.completed
    assert post(client,'assignment_delete',id=a.id).status_code == 200
    assert not Assignment.objects.filter(pk=a.id).exists()

def test_cannot_read_or_change_other_students_records(client, student):
    other = User.objects.create_user('other')
    a = make_assignment(other)
    s = Subtask.objects.create(assignment=a,title='Private task',minutes=20)
    assert client.get('/api/state/').json()['assignments'] == []
    for op in ['assignment_toggle','assignment_delete','breakdown']:
        assert post(client,op,id=a.id).status_code == 404
    assert post(client,'step_toggle',id=s.id).status_code == 404
    assert post(client,'step_save',id=s.id,assignment_id=a.id,title='bad',minutes=5).status_code == 404

def test_invalid_inputs_do_not_write(client, student):
    for extra in [{'minutes':-1},{'due':'not-a-date'},{'priority':'danger'},{'title':''}]:
        payload={'title':'Task','due':str(timezone.localdate()),'minutes':90,'priority':'normal'}
        payload.update(extra)
        assert post(client,'assignment_save',**payload).status_code == 400
    assert not Assignment.objects.filter(user=student).exists()
    assert post(client,'profile',remember_chat='true').status_code == 400

def test_csrf_is_enforced(student):
    c = Client(enforce_csrf_checks=True)
    c.force_login(student)
    assert post(c,'profile',name='Change').status_code == 403
    c.get('/app/')
    token = c.cookies['csrftoken'].value
    r = c.post('/api/action/',data=json.dumps({'action':'profile','name':'Safe'}),content_type='application/json',HTTP_X_CSRFTOKEN=token)
    assert r.status_code == 200

def test_planner_budget_deadline_and_nonoverlap(student):
    p = student.profile
    p.daily_minutes = 60
    a = make_assignment(student, days=1, minutes=120)
    plan = propose_plan(student,p,now_minute=8*60)
    assert all(0 < s['minutes'] <= 25 for s in plan['sessions'])
    assert all(s['date'] <= str(a.due) for s in plan['sessions'])
    for day in {s['date'] for s in plan['sessions']}:
        rows=[s for s in plan['sessions'] if s['date']==day]
        assert sum(s['minutes'] for s in rows)+5*(len(rows)-1) <= 60
        assert all(x['start_minute']+x['minutes']+5 <= y['start_minute'] for x,y in zip(rows,rows[1:]))
    assert plan['alerts']  # All 120 study minutes cannot fit once breaks are included.

def test_overdue_and_infeasible_work_is_visible(student):
    a=make_assignment(student, days=-1, minutes=1440)
    p=student.profile
    p.energy='gentle'
    plan=propose_plan(student,p,now_minute=8*60)
    assert plan['capacity'] == 60
    assert any(x['kind'] == 'overdue' for x in plan['alerts'])
    assert any(x['kind'] == 'infeasible' for x in plan['alerts'])
    assert all(s['date']==str(timezone.localdate()) for s in plan['sessions'])

def test_completed_sessions_reduce_capacity_and_do_not_overlap(student):
    a=make_assignment(student,minutes=100)
    p=student.profile;p.daily_minutes=60
    completed=StudySession.objects.create(user=student,assignment=a,title='Done',date=timezone.localdate(),start_minute=540,minutes=25,completed=True)
    plan=propose_plan(student,p,now_minute=480)
    rows=[s for s in plan['sessions'] if s['date']==str(timezone.localdate())]
    assert rows[0]['start_minute'] >= completed.start_minute+completed.minutes+5
    assert sum(s['minutes'] for s in rows)+completed.minutes <= 60
    assert sum(s['minutes'] for s in plan['sessions']) == 75

def test_plan_requires_preview_and_ignores_client_sessions(client,student):
    make_assignment(student)
    assert post(client,'plan_confirm').status_code==400
    post(client,'plan_preview')
    assert post(client,'plan_confirm',sessions=[{'assignment_id':999}]).status_code==200
    assert StudySession.objects.filter(user=student).exists() or timezone.localtime().hour >= 22
    assert post(client,'plan_confirm').status_code==400

def test_plan_invalidated_when_work_changes(client,student):
    a=make_assignment(student)
    post(client,'plan_preview')
    post(client,'assignment_toggle',id=a.id)
    assert post(client,'plan_confirm').status_code==400

def test_checkin_and_chat_history_privacy(client, student):
    assert post(client,'checkin',mood='low',energy='gentle',note='Private reflection').status_code==200
    assert CheckIn.objects.get(user=student).note=='Private reflection'
    assert post(client,'chat',message='I feel overwhelmed').status_code==200
    assert not ChatMessage.objects.filter(user=student).exists()
    post(client,'profile',remember_chat=True)
    post(client,'chat',message='My grades disappointed me')
    assert ChatMessage.objects.filter(user=student).count()==2
    post(client,'profile',remember_chat=False)
    assert not ChatMessage.objects.filter(user=student).exists()

@override_settings(OPENAI_API_KEY='fake-test-key')
def test_live_chat_uses_only_consented_context(client,student):
    make_assignment(student)
    CheckIn.objects.create(user=student,mood='low',energy='gentle',note='Never send this')
    with patch('scholar.ai.completion',return_value={'reply':'Try a small first step.'}) as call:
        assert post(client,'chat',message='Help me begin').json()['chat']['mode']=='live'
        assert call.call_args.args[1]['data']['workload']==[]
        post(client,'profile',share_workload=True)
        post(client,'chat',message='Help me begin')
        payload=call.call_args.args[1]
        assert payload['data']['workload'][0]['title']=='Research project'
        assert 'Never send this' not in json.dumps(payload)

@override_settings(OPENAI_API_KEY='fake-test-key')
def test_provider_failure_falls_back_and_invalid_steps_are_rejected(student):
    a=make_assignment(student)
    with patch('scholar.ai.completion',side_effect=RuntimeError('secret provider error')):
        reply=ai.companion('I feel stressed')
        assert reply['mode']=='fallback'
        assert 'secret' not in reply['reply']
    with patch('scholar.ai.completion',return_value={'steps':[{'title':'Bad','minutes':-9}]*3}):
        result=ai.breakdown(a)
        assert result['mode']=='fallback'
        assert all(s['minutes']>0 for s in result['steps'])

def test_immediate_safety_message_does_not_call_provider():
    with patch('scholar.ai.completion') as call:
        reply=ai.companion('I want to kill myself')
        assert reply['mode']=='safety'
        assert 'emergency' in reply['reply']
        call.assert_not_called()

def test_demo_workspaces_are_separate_and_never_use_live_ai():
    c1,c2=Client(),Client()
    assert c1.post('/accounts/demo/').status_code==302
    assert c2.post('/accounts/demo/').status_code==302
    a1=c1.get('/api/state/').json()['assignments'][0]['id']
    assert all(a['id']!=a1 for a in c2.get('/api/state/').json()['assignments'])
    assert post(c2,'assignment_delete',id=a1).status_code==404
    with override_settings(OPENAI_API_KEY='fake-test-key'),patch('scholar.ai.completion') as call:
        assert post(c1,'chat',message='Hello').json()['chat']['mode']=='demo'
        call.assert_not_called()

def test_export_and_delete_cascade(client,student):
    a=make_assignment(student)
    CheckIn.objects.create(user=student,mood='okay',energy='balanced',note='My note')
    response=client.get('/api/export/')
    assert response.status_code==200
    assert response.json()['checkins'][0]['note']=='My note'
    assert 'attachment' in response['Content-Disposition']
    assert post(client,'delete_account',confirmation='no').status_code==400
    assert post(client,'delete_account',confirmation='DELETE').json()['deleted']
    assert not User.objects.filter(pk=student.pk).exists()
    assert not Assignment.objects.filter(pk=a.pk).exists()
    assert not CheckIn.objects.exists()
