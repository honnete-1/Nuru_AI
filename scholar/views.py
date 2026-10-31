import json
import random
import re
import uuid
import zoneinfo
from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from . import ai, results, retrieval, rewards
from .models import (Assignment, ChatMessage, CheckAttempt, CheckIn, Concept, Course, FocusLog, Material,
                     MemoryItem, Passage, Profile, ResultEntry, RevisionSession, RewardEvent, Room, StudySession, Subtask)
from .planner import propose_plan, quick_start
from .seed import seed_demo

AI_ACTIONS = {'chat', 'tutor', 'check_submit', 'breakdown', 'challenge_new', 'challenge_submit', 'revision_question', 'revision_answer'}
AVATAR = {'skin': ['s1', 's2', 's3', 's4'], 'hair': ['short', 'long', 'curly', 'wrap'], 'outfit': ['lavender', 'sage', 'amber', 'plum']}
AVATAR_DEFAULT = {'skin': 's2', 'hair': 'short', 'outfit': 'lavender'}
HUES = ['amber', 'lavender', 'sage']
FEELINGS = results.FEELINGS


class Invalid(ValueError):
    """A validation error whose message is safe and helpful to show."""


def profile_for(user):
    return Profile.objects.get_or_create(user=user, defaults={'display_name': user.first_name or user.username[:60]})[0]


def room_for(user):
    return Room.objects.get_or_create(user=user, defaults={'placed': list(rewards.STARTER)})[0]


# ------------------------------------------------------------------ pages
def home(request):
    feelings = [('proud', 'Proud'), ('relieved', 'Relieved'), ('disappointed', 'Disappointed'), ('worried', 'Worried'), ('mixed', 'Mixed')]
    openings = [{'key': k, 'label': l, 'message': results.opening(k)['message'], 'nuru': results.opening(k)['nuru']} for k, l in feelings]
    return render(request, 'home.html', {'live_ai': bool(settings.OPENAI_API_KEY), 'openings': openings})


def register(request):
    form = UserCreationForm(request.POST or None)
    if request.method == 'POST' and form.is_valid():
        user = form.save(commit=False)
        user.first_name = request.POST.get('display_name', 'Scholar').strip()[:60] or 'Scholar'
        user.save()
        profile_for(user)
        room_for(user)
        login(request, user)
        return redirect('workspace')
    return render(request, 'registration/register.html', {'form': form})


@require_POST
def demo(request):
    if request.user.is_authenticated:
        return redirect('workspace')
    ip_key = 'demo:' + request.META.get('REMOTE_ADDR', '')
    count = cache.get(ip_key, 0)
    if count >= 10:
        return HttpResponse('Too many sample workspaces were created from this network. Please wait an hour or create an account.', status=429)
    cache.set(ip_key, count + 1, 3600)
    user = User.objects.create_user('demo-' + uuid.uuid4().hex, first_name='Guest')
    p = profile_for(user)
    p.is_demo, p.onboarded, p.display_name = True, True, 'Guest'
    p.save()
    room_for(user)
    seed_demo(user)
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    return redirect('workspace')


@login_required
@ensure_csrf_cookie
def workspace(request):
    p = profile_for(request.user)
    room_for(request.user)
    return render(request, 'workspace.html', {'profile': p})


# ------------------------------------------------------------------ state
def ai_mode(p):
    return 'live' if settings.OPENAI_API_KEY and not p.is_demo else 'demo'


def next_action(user, today):
    s = StudySession.objects.filter(user=user, date=today, completed=False).order_by('start_minute').first()
    if s:
        return {'kind': 'session', 'id': s.id, 'assignment_id': s.assignment_id, 'title': s.title, 'minutes': s.minutes, 'start_minute': s.start_minute}
    step = (Subtask.objects.filter(assignment__user=user, assignment__completed=False, completed=False)
            .select_related('assignment').order_by('assignment__due', 'order', 'id').first())
    if step:
        return {'kind': 'step', 'id': step.id, 'assignment_id': step.assignment_id, 'title': step.title, 'minutes': step.minutes, 'assignment': step.assignment.title, 'stage': step.stage}
    a = Assignment.objects.filter(user=user, completed=False).order_by('due').first()
    if a:
        return {'kind': 'assignment', 'assignment_id': a.id, 'title': a.title}
    c = Concept.objects.filter(user=user, next_review__lte=today).first()
    if c:
        return {'kind': 'review', 'id': c.id, 'title': c.name}
    return {'kind': 'empty'}


def avatar_for(p):
    av = p.avatar if isinstance(p.avatar, dict) else {}
    return {k: av.get(k) if av.get(k) in AVATAR[k] else AVATAR_DEFAULT[k] for k in AVATAR}


def resolve_resume(user, p):
    """'Continue where we stopped', re-checked against the student's current records."""
    r = p.resume if isinstance(p.resume, dict) else {}
    kind = r.get('kind')
    if kind == 'assignment':
        a = Assignment.objects.filter(user=user, pk=r.get('id'), completed=False).first()
        if not a:
            return None
        step = a.steps.filter(pk=r.get('step_id')).first() if r.get('step_id') else None
        return {'kind': 'assignment', 'id': a.id, 'title': a.title, 'step_id': step.id if step and not step.completed else None,
                'step': step.title if step and not step.completed else '', 'at': r.get('at')}
    if kind == 'material':
        m = Material.objects.filter(user=user, pk=r.get('id')).first()
        return {'kind': 'material', 'id': m.id, 'title': m.title, 'at': r.get('at')} if m else None
    if kind == 'revise':
        rs = RevisionSession.objects.filter(user=user, pk=r.get('id'), finished_at__isnull=True).first()
        return {'kind': 'revise', 'id': rs.id, 'title': rs.topic, 'at': r.get('at')} if rs else None
    if kind == 'understand' and r.get('topic'):
        return {'kind': 'understand', 'title': r['topic'], 'at': r.get('at')}
    return None


def progress_for(user):
    attempts = CheckAttempt.objects.filter(user=user)
    return {
        'steps_done': Subtask.objects.filter(assignment__user=user, completed=True).count(),
        'assignments_done': Assignment.objects.filter(user=user, completed=True).count(),
        'focus_sessions': FocusLog.objects.filter(user=user).count(),
        'practice_attempts': attempts.count(),
        'checked_on_track': attempts.filter(verdict='on_track', mode__in=('live', 'checked'), flagged=False).count(),
        'self_checks': attempts.filter(verdict__startswith='self').count(),
        'revisions_finished': RevisionSession.objects.filter(user=user, finished_at__isnull=False).count(),
    }


def serialize(user):
    p = profile_for(user)
    room = room_for(user)
    today = timezone.localdate()
    now = timezone.localtime()
    courses = {c.id: c for c in Course.objects.filter(user=user)}
    assignments = []
    for a in Assignment.objects.filter(user=user).prefetch_related('steps').order_by('due', 'id'):
        assignments.append({'id': a.id, 'title': a.title, 'course': a.course, 'course_id': a.course_ref_id, 'description': a.description, 'working_notes': a.working_notes,
                            'due': str(a.due), 'minutes': a.minutes, 'priority': a.priority, 'completed': a.completed,
                            'steps': [{'id': s.id, 'title': s.title, 'minutes': s.minutes, 'completed': s.completed, 'stage': s.stage}
                                      for s in sorted(a.steps.all(), key=lambda s: (s.order, s.id))]})
    materials = [{'id': m.id, 'title': m.title, 'kind': m.kind, 'course_id': m.course_id, 'status': m.status, 'status_detail': m.status_detail,
                  'pages': m.pages, 'passages': m.passage_count, 'created_at': m.created_at.isoformat()}
                 for m in Material.objects.filter(user=user).order_by('-id').annotate(passage_count=Count('passages'))]
    concepts = []
    for c in Concept.objects.filter(user=user).prefetch_related('attempts').order_by('next_review', 'name'):
        atts = sorted(c.attempts.all(), key=lambda x: -x.id)
        concepts.append({'id': c.id, 'name': c.name, 'status': c.status, 'next_review': str(c.next_review) if c.next_review else None,
                         'due': bool(c.next_review and c.next_review <= today), 'attempts': len(atts),
                         'last': ({'id': atts[0].id, 'verdict': atts[0].verdict, 'feedback': atts[0].feedback[:600], 'mode': atts[0].mode, 'flagged': atts[0].flagged, 'question': atts[0].question[:300]} if atts else None)})
    focus = list(FocusLog.objects.filter(user=user).order_by('-id')[:60])
    return {
        'profile': {'name': p.display_name, 'daily_minutes': p.daily_minutes, 'start_hour': p.start_hour, 'end_hour': p.end_hour, 'energy': p.energy,
                    'timezone': p.timezone or settings.TIME_ZONE, 'remember_chat': p.remember_chat, 'share_workload': p.share_workload,
                    'use_memory': p.use_memory, 'reminders': p.reminders, 'is_demo': p.is_demo, 'onboarded': p.onboarded,
                    'companion_name': p.companion_name, 'companion_hue': p.companion_hue, 'celebration': p.celebration, 'motion': p.motion,
                    'avatar': avatar_for(p)},
        'resume': resolve_resume(user, p),
        'progress': progress_for(user),
        'revisions': [{'id': r.id, 'topic': r.topic, 'course_id': r.course_id, 'minutes': r.minutes, 'material_ids': r.material_ids,
                       'assessment_date': str(r.assessment_date) if r.assessment_date else None, 'finished': bool(r.finished_at),
                       'confidence': r.confidence, 'created_at': r.created_at.isoformat()}
                      for r in RevisionSession.objects.filter(user=user).order_by('-id')[:20]],
        'room': {'theme': room.theme, 'scenery': room.scenery, 'lamp': room.lamp, 'sound': room.sound, 'placed': room.placed,
                 'unlocked': rewards.unlocked(user)},
        'catalog': rewards.CATALOG,
        'rewards': [{'key': r.key, 'decoration': r.decoration, 'kind': r.kind, 'created_at': r.created_at.isoformat()} for r in RewardEvent.objects.filter(user=user).order_by('created_at')],
        'today': str(today), 'now_minute': now.hour * 60 + now.minute,
        'courses': [{'id': c.id, 'name': c.name, 'goal': c.goal, 'colour': c.colour} for c in courses.values()],
        'assignments': assignments, 'materials': materials, 'concepts': concepts,
        'memory': [{'id': m.id, 'kind': m.kind, 'text': m.text} for m in MemoryItem.objects.filter(user=user).order_by('kind', 'id')],
        'checkins': [{'id': c.id, 'mood': c.mood, 'energy': c.energy, 'note': c.note, 'created_at': c.created_at.isoformat()} for c in CheckIn.objects.filter(user=user).order_by('-id')[:30]],
        'results': [{'id': r.id, 'title': r.title, 'course': r.course, 'result': results.describe({'result_kind': r.result_kind, 'score': r.score, 'out_of': r.out_of, 'result_text': r.result_text}),
                     'result_kind': r.result_kind, 'goal': r.goal, 'feedback': r.feedback, 'feeling': r.feeling, 'feeling_words': r.feeling_words,
                     'support': r.support, 'helped': r.helped, 'next_focus': r.next_focus, 'assignment_id': r.assignment_id, 'created_at': r.created_at.isoformat()}
                    for r in ResultEntry.objects.filter(user=user).order_by('-id')[:50]],
        'sessions': list(StudySession.objects.filter(user=user, date__gte=today - timedelta(days=7)).order_by('date', 'start_minute').values('id', 'assignment_id', 'subtask_id', 'title', 'date', 'start_minute', 'minutes', 'completed')),
        'messages': list(reversed(list(ChatMessage.objects.filter(user=user).order_by('-id')[:40].values('role', 'content', 'mode')))) if p.remember_chat else [],
        'focus': [{'id': f.id, 'minutes': f.minutes, 'assignment_id': f.assignment_id, 'step_id': f.subtask_id, 'goal': f.goal, 'clearer': f.clearer, 'next_step': f.next_step, 'created_at': f.created_at.isoformat()} for f in focus],
        'focus_total': sum(f.minutes for f in FocusLog.objects.filter(user=user).only('minutes')),
        'next_action': next_action(user, today),
        'ai': {'mode': ai_mode(p), 'model': settings.OPENAI_MODEL if ai_mode(p) == 'live' else None, 'daily_limit': settings.AI_DEMO_DAILY_LIMIT if p.is_demo else settings.AI_DAILY_LIMIT},
        'support_contact': settings.SUPPORT_CONTACT_TEXT.strip(),
    }


@login_required
@require_GET
def state(request):
    return JsonResponse(serialize(request.user))


# ------------------------------------------------------------------ validation helpers
def text(data, key, maximum, default='', required=False, label=None):
    value = data.get(key, default)
    if value is None:
        value = ''
    if not isinstance(value, str) or len(value) > maximum:
        raise Invalid(f'{label or key.replace("_", " ").capitalize()}: up to {maximum} characters.')
    value = value.strip()
    if required and not value:
        raise Invalid(f'{label or key.replace("_", " ").capitalize()} is required.')
    return value


def integer(data, key, low, high, default=None, label=None):
    value = data.get(key, default)
    if isinstance(value, bool):
        raise Invalid(f'{label or key}: enter a whole number from {low} to {high}.')
    try:
        value = int(value)
    except (TypeError, ValueError):
        raise Invalid(f'{label or key.replace("_", " ").capitalize()}: enter a whole number from {low} to {high}.')
    if not low <= value <= high:
        raise Invalid(f'{label or key.replace("_", " ").capitalize()}: enter a whole number from {low} to {high}.')
    return value


def choice(data, key, choices, default):
    value = data.get(key, default)
    if value not in choices:
        raise Invalid(f'Choose a valid {key.replace("_", " ")}.')
    return value


def flag(data, key, default=False):
    value = data.get(key, default)
    if type(value) is not bool:
        raise Invalid(f'Invalid {key}.')
    return value


def optional_id(data, key):
    value = data.get(key)
    if value in (None, ''):
        return None
    if isinstance(value, bool) or not isinstance(value, (int, str)) or not str(value).isdigit():
        raise Invalid(f'Invalid {key}.')
    return int(value)


def course_named(user, name):
    name = (name or 'My course').strip()[:80] or 'My course'
    return Course.objects.get_or_create(user=user, name=name)[0]


def history_from(data):
    """In-session continuity: the browser holds the current conversation unless saving is on."""
    items = data.get('history', [])
    if not isinstance(items, list):
        raise Invalid('Invalid history.')
    clean = []
    for m in items[-12:]:
        if isinstance(m, dict) and m.get('role') in ('user', 'assistant') and isinstance(m.get('content'), str):
            clean.append({'role': m['role'], 'content': m['content'][:3000]})
    return clean


def rate_limit(user, p):
    key = f'ai:{user.pk}:{timezone.localdate()}'
    limit = settings.AI_DEMO_DAILY_LIMIT if p.is_demo else settings.AI_DAILY_LIMIT
    count = cache.get(key, 0)
    if count >= limit:
        return False
    cache.set(key, count + 1, 86400)
    return True


def workload_for(user):
    rows = list(Assignment.objects.filter(user=user, completed=False).order_by('due').values('id', 'title', 'course', 'due', 'minutes')[:15])
    for r in rows:
        r['due'] = str(r['due'])
    return rows


def memory_for(user, p):
    if not p.use_memory:
        return []
    return [{'kind': m.kind, 'text': m.text} for m in MemoryItem.objects.filter(user=user)[:20]]


def sources_for(user, query, material_ids=None, course_id=None):
    hits = retrieval.search(user, query, material_ids=material_ids, course_id=course_id)
    return [{'id': p.id, 'page': p.page, 'material': p.material.title, 'material_id': p.material_id, 'text': p.text} for p, _ in hits]


def resolve_citations(user, supported):
    ids = {i for s in supported for i in s['passage_ids']}
    passages = {p.id: p for p in Passage.objects.filter(user=user, id__in=ids).select_related('material')}
    out = []
    for s in supported:
        cites = [retrieval.cite(passages[i]) for i in s['passage_ids'] if i in passages]
        if cites:
            out.append({'text': s['text'], 'citations': cites})
    return out


def build_context(user, data):
    """Explicitly chosen context only. Every lookup is scoped to the current user."""
    ctx = data.get('context') or None
    if ctx is None:
        return None, [], None, None
    if not isinstance(ctx, dict):
        raise Invalid('Invalid context.')
    kind = ctx.get('type')
    sent = []
    if kind == 'assignment':
        a = get_object_or_404(Assignment, pk=optional_id(ctx, 'id'), user=user)
        steps = [{'title': s.title, 'minutes': s.minutes, 'stage': s.stage, 'done': s.completed} for s in a.steps.all().order_by('order', 'id')]
        sent.append(f'Assignment: {a.title} (brief, due date, steps)')
        out = {'type': 'assignment', 'id': a.id, 'title': a.title, 'course': a.course, 'brief': a.description[:3000], 'due': str(a.due), 'steps': steps}
        step_id = optional_id(ctx, 'step_id')
        if step_id:
            step = get_object_or_404(Subtask, pk=step_id, assignment=a)
            out['current_step'] = {'title': step.title, 'minutes': step.minutes, 'stage': step.stage, 'done': step.completed}
            sent.append(f'The step you are working on: {step.title}')
        return out, sent, None, a.course_ref_id
    if kind == 'passage':
        pz = get_object_or_404(Passage.objects.select_related('material'), pk=optional_id(ctx, 'id'), user=user)
        sent.append(f'The passage you selected from {pz.material.title}' + (f', page {pz.page}' if pz.page else ''))
        return {'type': 'passage', 'id': pz.id, 'material': pz.material.title}, sent, [pz.material_id], pz.material.course_id
    if kind == 'plan':
        p = profile_for(user)
        proposal = propose_plan(user, p)
        rows = workload_for(user)
        sent.append(f'Your plan summary: daily availability, {len(rows)} assignment title(s), due dates, estimates and plan warnings')
        return ({'type': 'plan', 'availability': {'minutes_per_day': p.daily_minutes, 'from_hour': p.start_hour, 'to_hour': p.end_hour, 'pace': p.energy},
                 'assignments': rows, 'alerts': [{'kind': al['kind'], 'title': al['title'], 'message': al['message']} for al in proposal['alerts']]},
                sent, None, None)
    if kind == 'revision':
        rs = get_object_or_404(RevisionSession, pk=optional_id(ctx, 'id'), user=user)
        out = {'type': 'revision', 'id': rs.id, 'topic': rs.topic}
        prev = text(ctx, 'previous_question', 600)
        if prev:
            out['previous_question'] = prev
        sent.append(f'Revision topic: {rs.topic}')
        mats = list(Material.objects.filter(user=user, pk__in=rs.material_ids).values_list('id', flat=True)) or None
        return out, sent, mats, rs.course_id
    if kind == 'material':
        m = get_object_or_404(Material, pk=optional_id(ctx, 'id'), user=user)
        return {'type': 'material', 'id': m.id, 'title': m.title}, sent, [m.id], None
    if kind == 'concept':
        c = get_object_or_404(Concept, pk=optional_id(ctx, 'id'), user=user)
        return {'type': 'concept', 'id': c.id, 'name': c.name, 'status': c.status}, [f'Concept: {c.name}'], None, c.course_id
    if kind in ('result', 'result_temp'):
        share = ctx.get('share') or {}
        if not isinstance(share, dict):
            raise Invalid('Invalid sharing choice.')
        if kind == 'result':
            r = get_object_or_404(ResultEntry, pk=optional_id(ctx, 'id'), user=user)
            fields = {'title': r.title, 'course': r.course, 'result_kind': r.result_kind, 'score': r.score, 'out_of': r.out_of,
                      'result_text': r.result_text, 'goal': r.goal, 'feedback': r.feedback, 'feeling': r.feeling, 'feeling_words': r.feeling_words,
                      'assignment_id': r.assignment_id}
        else:
            raw = ctx.get('result') or {}
            if not isinstance(raw, dict):
                raise Invalid('Invalid result.')
            fields = results.parse_result(raw)
            fields.update({'title': text(raw, 'title', 160), 'course': text(raw, 'course', 80), 'goal': text(raw, 'goal', 60),
                           'feedback': text(raw, 'feedback', 4000), 'feeling': choice(raw, 'feeling', FEELINGS + [''], ''),
                           'feeling_words': text(raw, 'feeling_words', 200), 'assignment_id': None})
            aid = optional_id(raw, 'assignment_id')
            if aid:
                fields['assignment_id'] = get_object_or_404(Assignment, pk=aid, user=user).id
        out = {'type': 'result', 'title': fields['title'], 'course': fields['course'], 'feeling': fields['feeling'],
               'feeling_words': fields['feeling_words'], 'assignment_id': fields['assignment_id']}
        sent.append(f'Result title and how you feel ({fields["feeling"] or "not shared"})')
        if share.get('score') is True:
            out['result'] = results.describe(fields)
            out['goal'] = fields['goal']
            sent.append('Your mark and goal')
        if share.get('feedback') is True and fields['feedback']:
            out['lecturer_feedback'] = fields['feedback'][:4000]
            sent.append('Lecturer feedback')
        return out, sent, None, None
    raise Invalid('Unknown context.')


def run_chat(request, p, data, intent=None):
    message = text(data, 'message', 3000, required=True, label='Message')
    intent = intent or choice(data, 'intent', list(ai.INTENT_GUIDE.keys()), 'chat')
    ctx, sent, material_ids, course_id = build_context(request.user, data)
    if ctx and ctx['type'] == 'assignment' and intent == 'chat':
        intent = 'assignment'
    use_notes = flag(data, 'use_notes', bool(material_ids))
    if ctx and ctx['type'] == 'passage':
        use_notes = True
    sources, notes_status = [], 'not_used'
    if use_notes and not Material.objects.filter(user=request.user, status='ready').exists():
        notes_status = 'no_materials'
    elif use_notes:
        query = message + ' ' + (ctx.get('title', '') if ctx else '') + ' ' + text(data, 'topic', 200)
        sources = sources_for(request.user, query, material_ids=material_ids, course_id=course_id)
        if ctx and ctx['type'] == 'passage':
            chosen = Passage.objects.select_related('material').get(pk=ctx['id'], user=request.user)
            sources = [{'id': chosen.id, 'page': chosen.page, 'material': chosen.material.title, 'material_id': chosen.material_id, 'text': chosen.text}] + [
                x for x in sources if x['id'] != chosen.id][:2]
        notes_status = 'used' if sources else 'none_found'
        if sources:
            sent.append(f'{len(sources)} matching passage(s) from your notes')
    workload = workload_for(request.user) if p.share_workload else []
    if workload:
        sent.append(f'Workload summary ({len(workload)} assignments: titles, due dates, estimates)')
    memory = memory_for(request.user, p)
    if memory:
        sent.append(f'Learning memory ({len(memory)} items)')
    if p.remember_chat:
        history = list(reversed(list(ChatMessage.objects.filter(user=request.user).order_by('-id')[:10].values('role', 'content'))))
    else:
        history = history_from(data)
    if history:
        sent.append('Recent turns of this conversation')
    sent.insert(0, 'Your message')
    result = ai.companion(message, name=p.companion_name, context=ctx, sources=sources, workload=workload, memory=memory,
                          history=history, intent=intent, topic=text(data, 'topic', 200), allow_live=not p.is_demo)
    result['supported'] = resolve_citations(request.user, result.get('supported', []))
    if notes_status == 'used' and not result['supported']:
        notes_status = 'not_cited'
    result['notes_status'] = notes_status
    result['sources_searched'] = [retrieval.cite(Passage.objects.select_related('material').get(pk=s['id'])) for s in sources]
    result['sent'] = sent if result['mode'] == 'live' else []
    result['would_send'] = sent
    if p.remember_chat:
        ChatMessage.objects.create(user=request.user, role='user', content=message, mode='')
        ChatMessage.objects.create(user=request.user, role='assistant', content=result['reply'], mode=result['mode'])
    return result


def set_review(concept, verdict):
    today = timezone.localdate()
    concept.next_review = today + timedelta(days={'on_track': 7, 'partly': 2, 'not_yet': 1, 'self_got': 4, 'self_unsure': 2, 'self_not': 1, 'self': 2}.get(verdict, 2))


def recompute_concept(concept):
    atts = list(concept.attempts.filter(flagged=False))
    if any(a.verdict == 'on_track' and a.mode in ('live', 'checked') for a in atts):
        concept.status = 'checked'
    elif len(atts) >= 2 or any(a.verdict in ('on_track', 'partly') for a in atts):
        concept.status = 'practiced'
    else:
        concept.status = 'attempted'
    concept.save()


def concept_for(user, name):
    name = (name or '').strip()[:120] or 'General practice'
    return Concept.objects.get_or_create(user=user, name=name)[0]


def material_from_text(user, title, body, course, kind='note'):
    chunks = retrieval.extract('note', body)
    m = Material.objects.create(user=user, course=course, title=title, kind=kind, status='ready' if chunks else 'no_text',
                                status_detail='' if chunks else 'This note is too short to search. Add a few sentences.')
    Passage.objects.bulk_create([Passage(user=user, material=m, page=pg, ordinal=i, text=t) for i, (pg, t) in enumerate(chunks)])
    return m


# ------------------------------------------------------------------ the action endpoint
@login_required
@require_POST
def action(request):
    try:
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise Invalid('The request could not be read.')
        if not isinstance(data, dict):
            raise Invalid('Expected an object.')
        operation = data.get('action')
        p = profile_for(request.user)
        if operation in AI_ACTIONS and not rate_limit(request.user, p):
            return JsonResponse({'error': "You've reached today's companion limit for this installation. Your planner, focus room and journal still work, and the limit resets tomorrow.", 'code': 'rate_limited'}, status=429)
        handler = HANDLERS.get(operation)
        if handler is None:
            raise Invalid('Unknown action.')
        response = handler(request, p, data) or {}
        if operation in INVALIDATES_PLAN:
            request.session.pop('proposal', None)
        if operation in REWARD_TRIGGERS:
            new = rewards.evaluate(request.user)
            if new:
                response['new_keepsakes'] = [{'key': k, **rewards.CATALOG[k]} for k in new]
        if response.get('deleted'):
            return JsonResponse(response)
        response['state'] = serialize(request.user)
        return JsonResponse(response)
    except Invalid as error:
        return JsonResponse({'error': str(error)}, status=400)
    except (ValueError, TypeError, KeyError):
        return JsonResponse({'error': 'Please check the form values and try again.'}, status=400)


# --- profile, onboarding, room
def h_profile(request, p, data):
    was_memory = p.use_memory
    p.display_name = text(data, 'name', 60, p.display_name) or 'Scholar'
    p.daily_minutes = integer(data, 'daily_minutes', 15, 360, p.daily_minutes, 'Daily minutes')
    p.start_hour = integer(data, 'start_hour', 5, 22, p.start_hour, 'Start hour')
    p.end_hour = integer(data, 'end_hour', 6, 23, p.end_hour, 'End hour')
    if p.end_hour <= p.start_hour:
        raise Invalid('Your study window must end after it starts.')
    p.energy = choice(data, 'energy', ['gentle', 'balanced', 'focused'], p.energy)
    p.remember_chat = flag(data, 'remember_chat', p.remember_chat)
    p.share_workload = flag(data, 'share_workload', p.share_workload)
    p.use_memory = flag(data, 'use_memory', p.use_memory)
    p.reminders = flag(data, 'reminders', p.reminders)
    p.companion_name = text(data, 'companion_name', 30, p.companion_name) or 'Nuru'
    p.companion_hue = choice(data, 'companion_hue', HUES, p.companion_hue)
    p.celebration = choice(data, 'celebration', ['quiet', 'gentle', 'sparkle'], p.celebration)
    p.motion = choice(data, 'motion', ['system', 'reduce', 'full'], p.motion)
    tz = text(data, 'timezone', 64, p.timezone)
    if tz:
        try:
            zoneinfo.ZoneInfo(tz)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            raise Invalid('Choose a valid time zone.')
    p.timezone = tz
    p.save()
    if not p.remember_chat:
        ChatMessage.objects.filter(user=request.user).delete()
    if was_memory and not p.use_memory:
        MemoryItem.objects.filter(user=request.user).delete()


def h_avatar(request, p, data):
    av = data.get('avatar')
    if not isinstance(av, dict):
        raise Invalid('Choose how your seat looks.')
    current = avatar_for(p)
    for k, allowed in AVATAR.items():
        if k in av:
            if av[k] not in allowed:
                raise Invalid(f'Choose a valid {k}.')
            current[k] = av[k]
    p.avatar = current
    p.save(update_fields=['avatar'])


def h_resume_save(request, p, data):
    """Remember where we stopped. Every id is checked against the student's own records."""
    kind = choice(data, 'kind', ['assignment', 'material', 'revise', 'understand', 'clear'], None)
    at = timezone.now().isoformat()
    if kind == 'assignment':
        a = get_object_or_404(Assignment, pk=optional_id(data, 'id'), user=request.user)
        sid = optional_id(data, 'step_id')
        if sid:
            get_object_or_404(Subtask, pk=sid, assignment=a)
        p.resume = {'kind': kind, 'id': a.id, 'step_id': sid, 'at': at}
    elif kind == 'material':
        p.resume = {'kind': kind, 'id': get_object_or_404(Material, pk=optional_id(data, 'id'), user=request.user).id, 'at': at}
    elif kind == 'revise':
        p.resume = {'kind': kind, 'id': get_object_or_404(RevisionSession, pk=optional_id(data, 'id'), user=request.user).id, 'at': at}
    elif kind == 'understand':
        p.resume = {'kind': kind, 'topic': text(data, 'topic', 200, required=True, label='Topic'), 'at': at}
    else:
        p.resume = {}
    p.save(update_fields=['resume'])


def h_working_notes(request, p, data):
    a = get_object_or_404(Assignment, pk=optional_id(data, 'id'), user=request.user)
    a.working_notes = text(data, 'notes', 20000, label='Notes')
    a.save(update_fields=['working_notes'])
    return {'saved_at': timezone.now().isoformat()}


def h_onboard(request, p, data):
    h_profile(request, p, data)
    if isinstance(data.get('avatar'), dict):
        h_avatar(request, p, data)
    course_name = text(data, 'course', 80)
    goal = text(data, 'goal', 240)
    if course_name:
        c = course_named(request.user, course_name)
        if goal:
            c.goal = goal
            c.save()
    if goal and flag(data, 'remember_goal', False) and p.use_memory:
        MemoryItem.objects.get_or_create(user=request.user, kind='goal', text=goal)
    p.onboarded = True
    p.save(update_fields=['onboarded'])


def h_room(request, p, data):
    room = room_for(request.user)
    room.theme = choice(data, 'theme', ['auto', 'day', 'evening'], room.theme)
    room.scenery = choice(data, 'scenery', ['garden', 'city', 'rain'], room.scenery)
    room.lamp = choice(data, 'lamp', ['warm', 'soft', 'off'], room.lamp)
    room.sound = choice(data, 'sound', ['off', 'rain', 'hearth'], room.sound)
    if 'placed' in data:
        placed = data['placed']
        allowed = set(rewards.unlocked(request.user))
        if not isinstance(placed, list) or any(k not in allowed for k in placed):
            raise Invalid('You can only place keepsakes you have unlocked.')
        room.placed = list(dict.fromkeys(placed))
    room.save()


# --- assignments and steps
def h_assignment_save(request, p, data):
    aid = optional_id(data, 'id')
    if not aid and Assignment.objects.filter(user=request.user).count() >= 150:
        raise Invalid('Keep at most 150 assignments. Delete old work first.')
    title = text(data, 'title', 160, required=True, label='Title')
    try:
        due = date.fromisoformat(text(data, 'due', 10, required=True, label='Due date'))
    except ValueError:
        raise Invalid('Enter the due date as YYYY-MM-DD.')
    a = get_object_or_404(Assignment, pk=aid, user=request.user) if aid else Assignment(user=request.user)
    course = course_named(request.user, text(data, 'course', 80, 'My course'))
    a.title, a.course, a.course_ref, a.description, a.due = title, course.name, course, text(data, 'description', 4000), due
    a.minutes = integer(data, 'minutes', 15, 1440, 90, 'Estimate (minutes)')
    a.priority = choice(data, 'priority', ['normal', 'high'], 'normal')
    a.save()
    return {'assignment_id': a.id}


def h_assignment_delete(request, p, data):
    get_object_or_404(Assignment, pk=optional_id(data, 'id'), user=request.user).delete()


def h_assignment_toggle(request, p, data):
    a = get_object_or_404(Assignment, pk=optional_id(data, 'id'), user=request.user)
    a.completed = not a.completed
    a.save()
    a.steps.update(completed=a.completed)
    StudySession.objects.filter(assignment=a, user=request.user).update(completed=a.completed)


def _sync_assignment(a):
    if a.steps.exists():
        a.completed = not a.steps.filter(completed=False).exists()
        a.save(update_fields=['completed'])


def h_step_toggle(request, p, data):
    s = get_object_or_404(Subtask, pk=optional_id(data, 'id'), assignment__user=request.user)
    s.completed = not s.completed
    s.save()
    StudySession.objects.filter(subtask=s, user=request.user).update(completed=s.completed)
    _sync_assignment(s.assignment)


def h_step_save(request, p, data):
    a = get_object_or_404(Assignment, pk=optional_id(data, 'assignment_id'), user=request.user)
    title = text(data, 'title', 180, required=True, label='Step')
    sid = optional_id(data, 'id')
    if not sid and a.steps.count() >= 30:
        raise Invalid('An assignment can have up to 30 steps.')
    s = get_object_or_404(Subtask, pk=sid, assignment=a) if sid else Subtask(assignment=a, order=a.steps.count())
    s.title, s.minutes = title, integer(data, 'minutes', 1, 1440, 25, 'Minutes')
    s.stage = choice(data, 'stage', [k for k, _ in Subtask._meta.get_field('stage').choices], s.stage or 'explore')
    s.save()
    _sync_assignment(a)


def h_step_delete(request, p, data):
    s = get_object_or_404(Subtask, pk=optional_id(data, 'id'), assignment__user=request.user)
    a = s.assignment
    s.delete()
    _sync_assignment(a)


def h_step_move(request, p, data):
    s = get_object_or_404(Subtask, pk=optional_id(data, 'id'), assignment__user=request.user)
    direction = choice(data, 'direction', ['up', 'down'], 'up')
    steps = list(s.assignment.steps.order_by('order', 'id'))
    i = steps.index(s)
    j = i - 1 if direction == 'up' else i + 1
    if 0 <= j < len(steps):
        steps[i], steps[j] = steps[j], steps[i]
        for n, step in enumerate(steps):
            if step.order != n:
                step.order = n
                step.save(update_fields=['order'])


def h_breakdown(request, p, data):
    a = get_object_or_404(Assignment, pk=optional_id(data, 'id'), user=request.user)
    if a.steps.exists():
        raise Invalid('This assignment already has steps. Edit those instead.')
    result = ai.breakdown(a, allow_live=not p.is_demo)
    with transaction.atomic():
        for i, s in enumerate(result['steps']):
            Subtask.objects.create(assignment=a, order=i, title=s['title'], minutes=s['minutes'], stage=s['stage'])
    return {'mode': result['mode'], 'fallback_reason': result.get('fallback_reason')}


# --- planning
def h_plan_preview(request, p, data):
    proposal = propose_plan(request.user, p)
    request.session['proposal'] = proposal
    return {'proposal': proposal}


def h_plan_confirm(request, p, data):
    proposal = request.session.pop('proposal', None)
    if not proposal or proposal.get('created_date') != str(timezone.localdate()):
        raise Invalid('Preview a fresh plan before confirming it.')
    with transaction.atomic():
        StudySession.objects.filter(user=request.user, completed=False, date__gte=timezone.localdate()).delete()
        for s in proposal['sessions']:
            a = get_object_or_404(Assignment, pk=s['assignment_id'], user=request.user)
            sub = Subtask.objects.filter(pk=s['subtask_id'], assignment=a).first() if s['subtask_id'] else None
            StudySession.objects.create(user=request.user, assignment=a, subtask=sub, title=s['title'], date=s['date'], start_minute=s['start_minute'], minutes=s['minutes'])


def h_session_toggle(request, p, data):
    s = get_object_or_404(StudySession, pk=optional_id(data, 'id'), user=request.user)
    s.completed = not s.completed
    s.save()
    if s.subtask:
        done = sum(StudySession.objects.filter(subtask=s.subtask, completed=True).values_list('minutes', flat=True))
        s.subtask.completed = done >= s.subtask.minutes
        s.subtask.save()
        _sync_assignment(s.assignment)
    else:
        done = sum(StudySession.objects.filter(assignment=s.assignment, completed=True).values_list('minutes', flat=True))
        s.assignment.completed = done >= s.assignment.minutes
        s.assignment.save()


def h_quick_start(request, p, data):
    return {'quick': quick_start(request.user, integer(data, 'minutes', 10, 90, 20, 'Minutes'))}


# --- focus, check-ins
def h_focus_log(request, p, data):
    minutes = integer(data, 'minutes', 1, 180, label='Minutes')
    token = text(data, 'client_token', 40, required=True, label='Session token')
    if not re.fullmatch(r'[A-Za-z0-9\-]{8,40}', token):
        raise Invalid('Invalid session token.')
    existing = FocusLog.objects.filter(user=request.user, client_token=token).first()
    if existing:
        return {'focus_id': existing.id, 'duplicate': True}
    aid = optional_id(data, 'assignment_id')
    a = get_object_or_404(Assignment, pk=aid, user=request.user) if aid else None
    sid = optional_id(data, 'step_id')
    step = get_object_or_404(Subtask, pk=sid, assignment=a) if sid and a else None
    f = FocusLog.objects.create(user=request.user, assignment=a, subtask=step, minutes=minutes, goal=text(data, 'goal', 200), client_token=token)
    return {'focus_id': f.id}


def h_focus_reflect(request, p, data):
    f = get_object_or_404(FocusLog, pk=optional_id(data, 'id'), user=request.user)
    f.clearer = text(data, 'clearer', 1000)
    f.next_step = text(data, 'next_step', 200)
    f.save()


def h_checkin(request, p, data):
    mood = choice(data, 'mood', ['overwhelmed', 'low', 'okay', 'good', 'great'], 'okay')
    energy = choice(data, 'energy', ['gentle', 'balanced', 'focused'], 'balanced')
    CheckIn.objects.create(user=request.user, mood=mood, energy=energy, note=text(data, 'note', 1000))
    if flag(data, 'apply_pace', False):
        p.energy = energy
        p.save(update_fields=['energy'])


def h_delete_checkins(request, p, data):
    CheckIn.objects.filter(user=request.user).delete()


# --- companion, memory, proposals
def h_chat(request, p, data):
    return {'chat': run_chat(request, p, data)}


def h_clear_chat(request, p, data):
    ChatMessage.objects.filter(user=request.user).delete()


def h_memory_save(request, p, data):
    if not p.use_memory:
        raise Invalid('Learning memory is switched off in Settings.')
    mid = optional_id(data, 'id')
    m = get_object_or_404(MemoryItem, pk=mid, user=request.user) if mid else MemoryItem(user=request.user)
    if not mid and MemoryItem.objects.filter(user=request.user).count() >= 40:
        raise Invalid('Memory holds up to 40 items. Forget one first.')
    m.kind = choice(data, 'kind', [k for k, _ in MemoryItem.KINDS], m.kind or 'goal')
    m.text = text(data, 'text', 240, required=True, label='Memory')
    m.save()


def h_memory_delete(request, p, data):
    get_object_or_404(MemoryItem, pk=optional_id(data, 'id'), user=request.user).delete()


def h_memory_clear(request, p, data):
    MemoryItem.objects.filter(user=request.user).delete()


def h_proposal_apply(request, p, data):
    """The only way a model suggestion becomes a record: the student approves (and may edit) it."""
    kind = choice(data, 'type', ['add_step', 'remember'], None)
    if kind == 'add_step':
        a = get_object_or_404(Assignment, pk=optional_id(data, 'assignment_id'), user=request.user)
        h_step_save(request, p, {'assignment_id': a.id, 'title': data.get('title'), 'minutes': data.get('minutes'), 'stage': data.get('stage', 'practice')})
        a.completed = False
        a.save(update_fields=['completed'])
        return {'applied': 'add_step'}
    h_memory_save(request, p, {'kind': data.get('kind'), 'text': data.get('text')})
    return {'applied': 'remember'}


# --- library
def h_course_save(request, p, data):
    cid = optional_id(data, 'id')
    c = get_object_or_404(Course, pk=cid, user=request.user) if cid else Course(user=request.user)
    c.name = text(data, 'name', 80, required=True, label='Course name')
    c.goal = text(data, 'goal', 240)
    c.colour = choice(data, 'colour', ['lavender', 'sage', 'amber', 'ink'], c.colour or 'lavender')
    try:
        with transaction.atomic():
            c.save()
    except IntegrityError:
        raise Invalid('You already have a course with that name.')
    if cid:
        Assignment.objects.filter(user=request.user, course_ref=c).update(course=c.name)


def h_course_delete(request, p, data):
    get_object_or_404(Course, pk=optional_id(data, 'id'), user=request.user).delete()


def h_note_save(request, p, data):
    if Material.objects.filter(user=request.user).count() >= 80:
        raise Invalid('Your library holds up to 80 items. Delete one first.')
    cid = optional_id(data, 'course_id')
    course = get_object_or_404(Course, pk=cid, user=request.user) if cid else None
    m = material_from_text(request.user, text(data, 'title', 160, required=True, label='Title'), text(data, 'body', 20000, required=True, label='Note'), course)
    return {'material_id': m.id}


def h_material_delete(request, p, data):
    get_object_or_404(Material, pk=optional_id(data, 'id'), user=request.user).delete()


# --- tutoring, checks, challenges
def h_tutor(request, p, data):
    step = choice(data, 'step', ['explain', 'hint', 'worked', 'practice'], 'explain')
    topic = text(data, 'topic', 200, required=True, label='Topic')
    data = dict(data)
    data.setdefault('message', topic)
    if not data.get('message'):
        data['message'] = topic
    data.setdefault('use_notes', True)
    result = run_chat(request, p, data, intent=f'tutor_{step}')
    if step == 'practice':
        match = re.search(r'Practice:\s*(.+)$', result['reply'], re.S | re.I)
        result['practice_question'] = (match.group(1).strip() if match else result['reply'])[:600]
    return {'chat': result}


def h_check_submit(request, p, data, revision=None):
    question = text(data, 'question', 600, required=True, label='Question')
    answer = text(data, 'answer', 3000, required=True, label='Your answer')
    concept = revision.concept if revision and revision.concept else concept_for(request.user, text(data, 'topic', 120, required=True, label='Topic'))
    material_ids = (revision.material_ids or None) if revision else None
    sources = sources_for(request.user, concept.name + ' ' + question, material_ids=material_ids) if flag(data, 'use_notes', True) else []
    result = ai.check_feedback(question, answer, concept.name, sources=sources, allow_live=not p.is_demo)
    if result.get('mode') == 'safety':
        return {'chat': result}
    attempt = CheckAttempt.objects.create(user=request.user, concept=concept, question=question, answer=answer, revision=revision,
                                          feedback=result['reply'], verdict=result['verdict'], mode=result['mode'])
    set_review(concept, result['verdict'])
    recompute_concept(concept)
    result['supported'] = resolve_citations(request.user, result.get('supported', []))
    result['attempt_id'] = attempt.id
    result['concept_id'] = concept.id
    return {'chat': result}


def h_revision_start(request, p, data):
    if RevisionSession.objects.filter(user=request.user).count() >= 500:
        raise Invalid('Delete some older revision records first.')
    topic = text(data, 'topic', 120, required=True, label='Topic')
    cid = optional_id(data, 'course_id')
    course = get_object_or_404(Course, pk=cid, user=request.user) if cid else None
    ids = data.get('material_ids') or []
    if not isinstance(ids, list) or len(ids) > 20 or any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
        raise Invalid('Choose up to 20 materials.')
    owned = list(Material.objects.filter(user=request.user, pk__in=ids).values_list('id', flat=True))
    if len(owned) != len(set(ids)):
        raise Http404
    when = text(data, 'assessment_date', 10)
    try:
        assessment = date.fromisoformat(when) if when else None
    except ValueError:
        raise Invalid('Enter the assessment date as YYYY-MM-DD.')
    concept = concept_for(request.user, topic)
    if course and not concept.course_id:
        concept.course = course
        concept.save(update_fields=['course'])
    rs = RevisionSession.objects.create(user=request.user, course=course, concept=concept, topic=concept.name, material_ids=owned,
                                        minutes=integer(data, 'minutes', 5, 180, 20, 'Minutes'), assessment_date=assessment)
    p.resume = {'kind': 'revise', 'id': rs.id, 'at': timezone.now().isoformat()}
    p.save(update_fields=['resume'])
    return {'revision_id': rs.id}


def h_revision_question(request, p, data):
    """Recall first: Nuru asks; the explanation is only offered after the student tries."""
    rs = get_object_or_404(RevisionSession, pk=optional_id(data, 'id'), user=request.user, finished_at__isnull=True)
    payload = {'message': f'Ask me one recall question about {rs.topic}. Do not explain it yet.', 'topic': rs.topic[:200],
               'context': {'type': 'revision', 'id': rs.id, 'previous_question': text(data, 'previous_question', 600)},
               'use_notes': bool(rs.material_ids), 'history': []}
    result = run_chat(request, p, payload, intent='revise_recall')
    match = re.search(r'Practice:\s*(.+)$', result['reply'], re.S | re.I)
    result['practice_question'] = (match.group(1).strip() if match else result['reply'])[:600]
    result['supported'] = []  # never reveal note passages before the attempt
    return {'chat': result}


def h_revision_answer(request, p, data):
    rs = get_object_or_404(RevisionSession, pk=optional_id(data, 'id'), user=request.user, finished_at__isnull=True)
    return h_check_submit(request, p, {'question': data.get('question'), 'answer': data.get('answer'), 'topic': rs.topic, 'use_notes': True}, revision=rs)


def h_revision_finish(request, p, data):
    rs = get_object_or_404(RevisionSession, pk=optional_id(data, 'id'), user=request.user)
    rs.confidence = choice(data, 'confidence', ['low', 'some', 'good', ''], '')
    rs.finished_at = rs.finished_at or timezone.now()
    rs.save()
    atts = list(rs.attempts.all())
    today = timezone.localdate()
    concept = rs.concept
    if concept:
        if not concept.next_review:
            concept.next_review = today + timedelta(days={'low': 1, 'some': 2, 'good': 4}.get(rs.confidence, 2))
        if rs.assessment_date and rs.assessment_date > today:
            concept.next_review = min(concept.next_review, rs.assessment_date - timedelta(days=1))
        concept.next_review = max(concept.next_review, today + timedelta(days=1))
        concept.save(update_fields=['next_review'])
    if (p.resume or {}).get('kind') == 'revise' and (p.resume or {}).get('id') == rs.id:
        p.resume = {}
        p.save(update_fields=['resume'])
    return {'summary': {
        'topic': rs.topic, 'questions': len(atts),
        'checked_on_track': sum(1 for a in atts if a.verdict == 'on_track' and a.mode in ('live', 'checked') and not a.flagged),
        'feedback_given': sum(1 for a in atts if a.mode in ('live', 'checked')),
        'self_checks': sum(1 for a in atts if a.verdict.startswith('self')),
        'flagged': sum(1 for a in atts if a.flagged),
        'confidence': rs.confidence, 'next_review': str(concept.next_review) if concept and concept.next_review else None,
        'assessment_date': str(rs.assessment_date) if rs.assessment_date else None,
    }}


def h_check_self(request, p, data):
    """In demo/fallback mode the student rates their own answer. Self-reports never count as 'checked'."""
    attempt = get_object_or_404(CheckAttempt, pk=optional_id(data, 'id'), user=request.user)
    rating = choice(data, 'rating', ['self_got', 'self_unsure', 'self_not'], 'self_unsure')
    if attempt.verdict not in ('self', 'self_got', 'self_unsure', 'self_not'):
        raise Invalid('This answer already has feedback.')
    attempt.verdict = rating
    attempt.save()
    set_review(attempt.concept, rating)
    recompute_concept(attempt.concept)


def h_check_flag(request, p, data):
    attempt = get_object_or_404(CheckAttempt, pk=optional_id(data, 'id'), user=request.user)
    attempt.flagged = True
    attempt.flag_note = text(data, 'note', 300)
    attempt.save()
    recompute_concept(attempt.concept)


def h_review_done(request, p, data):
    c = get_object_or_404(Concept, pk=optional_id(data, 'id'), user=request.user)
    c.next_review = timezone.localdate() + timedelta(days=integer(data, 'days', 1, 30, 3))
    c.save()


def h_concept_delete(request, p, data):
    get_object_or_404(Concept, pk=optional_id(data, 'id'), user=request.user).delete()


def h_challenge_new(request, p, data):
    topic = text(data, 'topic', 200, required=True, label='Topic')
    kind = choice(data, 'kind', ['order', 'spot_error', 'explain'], 'order')
    aid = optional_id(data, 'assignment_id')
    steps = None
    if aid:
        a = get_object_or_404(Assignment, pk=aid, user=request.user)
        steps = [s.title for s in a.steps.order_by('order', 'id')]
    result = ai.challenge(topic, kind, steps=steps, sources=[s['text'][:600] for s in sources_for(request.user, topic)][:2], allow_live=not p.is_demo)
    stored = {'topic': topic, 'type': result['type'], 'mode': result['mode'], 'self_generated': bool(result.get('self_generated')),
              'prompt': result['prompt'], 'items': result.get('items'), 'statement': result.get('statement'), 'error_explained': result.get('error_explained')}
    public = {k: result.get(k) for k in ('type', 'prompt', 'statement', 'hints', 'mode', 'fallback_reason')}
    if result['type'] == 'order':
        order = list(range(len(result['items'])))
        rnd = random.Random()
        for _ in range(5):
            rnd.shuffle(order)
            if order != sorted(order):
                break
        stored['shuffled'] = order  # shuffled[i] = index of the item shown at position i
        public['items'] = [result['items'][i] for i in order]
    request.session['challenge'] = stored
    return {'challenge': public}


def h_challenge_submit(request, p, data):
    ch = request.session.get('challenge')
    if not ch:
        raise Invalid('Start a new challenge first.')
    concept = concept_for(request.user, ch['topic'])
    if ch['type'] == 'order':
        order = data.get('order')
        n = len(ch['items'])
        if not isinstance(order, list) or sorted(order) != list(range(n)) or any(type(i) is not int for i in order):
            raise Invalid('Submit every item once.')
        # order lists shown positions in the student's chosen sequence
        chosen = [ch['shuffled'][i] for i in order]
        correct = chosen == list(range(n))
        first_wrong = next((k for k, v in enumerate(chosen) if v != k), None)
        verdict = 'on_track' if correct else 'not_yet'
        if ch['self_generated']:
            mode, feedback = 'self', ('That matches the order of your own plan.' if correct else 'That differs from the order in your plan. Either may be fine; this only compares with your saved steps.')
        else:
            mode = 'checked' if ch['mode'] == 'live' else 'demo'
            feedback = 'Exactly right: every item is in order.' if correct else f'Not quite. Positions 1 to {first_wrong} are right; look again from item {first_wrong + 1}.'
        attempt = CheckAttempt.objects.create(user=request.user, concept=concept, question=ch['prompt'], answer=json.dumps(order),
                                              feedback=feedback, verdict=verdict if mode != 'self' else 'self_got' if correct else 'self_unsure', mode=mode)
        set_review(concept, verdict)
        recompute_concept(concept)
        if correct:
            request.session.pop('challenge', None)
        else:
            request.session.modified = True
        return {'challenge_result': {'correct': correct, 'feedback': feedback, 'attempt_id': attempt.id, 'first_wrong': first_wrong}}
    answer = text(data, 'answer', 3000, required=True, label='Your answer')
    question = ch['prompt'] + ('\n' + ch['statement'] if ch.get('statement') else '')
    request.session.pop('challenge', None)
    return h_check_submit(request, p, {'question': question[:600], 'answer': answer, 'topic': ch['topic'], 'use_notes': True})


# --- results journal
def h_result_open(request, p, data):
    parsed = results.parse_result(data)
    feeling = choice(data, 'feeling', FEELINGS, 'skip')
    words = text(data, 'feeling_words', 200)
    opening = results.opening(feeling, words)
    if not flag(data, 'save', False):
        return {'opening': opening, 'saved': False}
    if ResultEntry.objects.filter(user=request.user).count() >= 300:
        raise Invalid('Your journal is full. Delete older entries first.')
    aid = optional_id(data, 'assignment_id')
    a = get_object_or_404(Assignment, pk=aid, user=request.user) if aid else None
    entry = ResultEntry.objects.create(user=request.user, assignment=a, title=text(data, 'title', 160, required=True, label='Title'),
                                       course=text(data, 'course', 80), goal=text(data, 'goal', 60), feedback=text(data, 'feedback', 4000),
                                       feeling=feeling, feeling_words=words, **parsed)
    return {'opening': opening, 'saved': True, 'result_id': entry.id}


def h_result_update(request, p, data):
    r = get_object_or_404(ResultEntry, pk=optional_id(data, 'id'), user=request.user)
    if 'support' in data:
        r.support = choice(data, 'support', ['talk', 'pause', 'feedback', 'question', 'plan', 'celebrate', 'quiet', 'strategy', 'break', 'next_goal', ''], r.support)
    if 'helped' in data:
        r.helped = text(data, 'helped', 2000)
    if 'next_focus' in data:
        r.next_focus = text(data, 'next_focus', 240)
    if 'feeling' in data:
        r.feeling = choice(data, 'feeling', FEELINGS, r.feeling)
        r.feeling_words = text(data, 'feeling_words', 200)
    r.save()


def h_result_delete(request, p, data):
    get_object_or_404(ResultEntry, pk=optional_id(data, 'id'), user=request.user).delete()


def h_results_clear(request, p, data):
    ResultEntry.objects.filter(user=request.user).delete()


def h_delete_account(request, p, data):
    if data.get('confirmation') != 'DELETE':
        raise Invalid('Type DELETE to confirm account deletion.')
    user = request.user
    for m in Material.objects.filter(user=user):
        m.delete()  # removes private files too
    logout(request)
    user.delete()
    return {'deleted': True}


HANDLERS = {
    'profile': h_profile, 'onboard': h_onboard, 'room_save': h_room,
    'assignment_save': h_assignment_save, 'assignment_delete': h_assignment_delete, 'assignment_toggle': h_assignment_toggle,
    'step_toggle': h_step_toggle, 'step_save': h_step_save, 'step_delete': h_step_delete, 'step_move': h_step_move, 'breakdown': h_breakdown,
    'plan_preview': h_plan_preview, 'plan_confirm': h_plan_confirm, 'session_toggle': h_session_toggle, 'quick_start': h_quick_start,
    'focus_log': h_focus_log, 'focus_reflect': h_focus_reflect, 'checkin': h_checkin, 'delete_checkins': h_delete_checkins,
    'chat': h_chat, 'clear_chat': h_clear_chat, 'memory_save': h_memory_save, 'memory_delete': h_memory_delete, 'memory_clear': h_memory_clear,
    'proposal_apply': h_proposal_apply, 'course_save': h_course_save, 'course_delete': h_course_delete, 'note_save': h_note_save,
    'material_delete': h_material_delete, 'tutor': h_tutor, 'check_submit': h_check_submit, 'check_self': h_check_self, 'check_flag': h_check_flag,
    'review_done': h_review_done, 'concept_delete': h_concept_delete, 'challenge_new': h_challenge_new, 'challenge_submit': h_challenge_submit,
    'result_open': h_result_open, 'result_update': h_result_update, 'result_delete': h_result_delete, 'results_clear': h_results_clear,
    'delete_account': h_delete_account, 'avatar_save': h_avatar, 'resume_save': h_resume_save, 'working_notes': h_working_notes,
    'revision_start': h_revision_start, 'revision_question': h_revision_question, 'revision_answer': h_revision_answer, 'revision_finish': h_revision_finish,
}
INVALIDATES_PLAN = {'assignment_save', 'assignment_delete', 'assignment_toggle', 'step_toggle', 'step_save', 'step_delete', 'step_move', 'breakdown', 'checkin', 'profile', 'onboard', 'session_toggle', 'proposal_apply'}
REWARD_TRIGGERS = {'step_toggle', 'assignment_toggle', 'session_toggle', 'focus_log', 'focus_reflect', 'check_submit', 'check_self', 'challenge_submit', 'revision_answer', 'revision_finish'}


# ------------------------------------------------------------------ files
PDF_MAGIC = b'%PDF-'


@login_required
@require_POST
def upload_material(request):
    try:
        if Material.objects.filter(user=request.user).count() >= 80:
            raise Invalid('Your library holds up to 80 items. Delete one first.')
        f = request.FILES.get('file')
        if not f:
            raise Invalid('Choose a PDF or TXT file.')
        name = f.name or 'upload'
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        if ext not in ('pdf', 'txt'):
            raise Invalid('Only PDF and TXT files can be uploaded.')
        if f.size > settings.MATERIAL_MAX_BYTES:
            raise Invalid(f'Files can be up to {settings.MATERIAL_MAX_BYTES // (1024 * 1024)} MB.')
        raw = f.read()
        if ext == 'pdf' and not raw.startswith(PDF_MAGIC):
            raise Invalid('This file does not look like a PDF.')
        title = (request.POST.get('title') or name.rsplit('.', 1)[0]).strip()[:160] or 'Untitled'
        cid = request.POST.get('course_id')
        course = get_object_or_404(Course, pk=int(cid), user=request.user) if cid and cid.isdigit() else None
        status, detail, chunks = 'ready', '', []
        try:
            chunks = retrieval.extract(ext, raw)
        except retrieval.ExtractionError as e:
            status, detail = 'error', str(e)
        if status == 'ready' and not chunks:
            status = 'no_text'
            detail = ('No selectable text was found. This is usually a scanned PDF, where pages are images. '
                      'Calm Scholar cannot read scanned pages yet, and it will not guess their content. '
                      'Try a text-based copy, or paste the key passages as a note.')
        if status == 'ready' and len(chunks) > retrieval.MAX_PASSAGES_PER_MATERIAL:
            chunks = chunks[:retrieval.MAX_PASSAGES_PER_MATERIAL]
            detail = 'Only the first part of this long file was indexed.'
        from django.core.files.base import ContentFile
        with transaction.atomic():
            m = Material(user=request.user, course=course, title=title, kind=ext, original_name=name[:200], status=status, status_detail=detail,
                         pages=max([pg or 0 for pg, _ in chunks], default=0))
            m.file.save(f'{uuid.uuid4().hex}.{ext}', ContentFile(raw), save=False)
            m.save()
            Passage.objects.bulk_create([Passage(user=request.user, material=m, page=pg, ordinal=i, text=t) for i, (pg, t) in enumerate(chunks)])
        return JsonResponse({'material_id': m.id, 'status': status, 'detail': detail, 'state': serialize(request.user)})
    except Invalid as error:
        return JsonResponse({'error': str(error)}, status=400)


@login_required
@require_GET
def material_file(request, pk):
    m = get_object_or_404(Material, pk=pk, user=request.user)
    if m.kind == 'note':
        body = '\n\n'.join(m.passages.order_by('ordinal').values_list('text', flat=True))
        response = HttpResponse(body, content_type='text/plain; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="note.txt"'
        return response
    if not m.file:
        raise Http404
    response = FileResponse(m.file.open('rb'), as_attachment=True, filename=f'{re.sub(r"[^A-Za-z0-9_-]+", "-", m.title)[:60] or "material"}.{m.kind}',
                            content_type='application/pdf' if m.kind == 'pdf' else 'text/plain; charset=utf-8')
    response['Cache-Control'] = 'private, no-store'
    return response


@login_required
@require_GET
def material_passages(request, pk):
    m = get_object_or_404(Material, pk=pk, user=request.user)
    rows = [{'id': p.id, 'page': p.page, 'text': p.text[:600]} for p in m.passages.order_by('ordinal')[:40]]
    return JsonResponse({'id': m.id, 'title': m.title, 'status': m.status, 'detail': m.status_detail, 'passages': rows, 'total': m.passages.count()})


@login_required
@require_GET
def passage_view(request, pk):
    pz = get_object_or_404(Passage.objects.select_related('material'), pk=pk, user=request.user)
    return JsonResponse({'id': pz.id, 'material': pz.material.title, 'page': pz.page, 'text': pz.text})


@login_required
@require_GET
def export_data(request):
    u = request.user
    result = serialize(u)
    result['checkins'] = list(CheckIn.objects.filter(user=u).values('mood', 'energy', 'note', 'created_at'))
    result['messages'] = list(ChatMessage.objects.filter(user=u).values('role', 'content', 'mode', 'created_at'))
    result['focus'] = list(FocusLog.objects.filter(user=u).values('minutes', 'goal', 'clearer', 'next_step', 'created_at'))
    result['results'] = list(ResultEntry.objects.filter(user=u).values())
    for r in result['results']:
        r.pop('user_id', None)
    result['revisions'] = list(RevisionSession.objects.filter(user=u).values('topic', 'minutes', 'assessment_date', 'confidence', 'created_at', 'finished_at'))
    result['practice'] = list(CheckAttempt.objects.filter(user=u).values('concept__name', 'question', 'answer', 'feedback', 'verdict', 'mode', 'flagged', 'created_at'))
    result['notes'] = [{'title': m.title, 'kind': m.kind, 'text': '\n\n'.join(m.passages.order_by('ordinal').values_list('text', flat=True))} for m in Material.objects.filter(user=u)]
    result.pop('catalog', None)
    response = JsonResponse(result, json_dumps_params={'indent': 2, 'default': str})
    response['Content-Disposition'] = 'attachment; filename="calm-scholar-data.json"'
    return response


@require_GET
def health(request):
    return JsonResponse({'status': 'ok'})
