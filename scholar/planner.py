"""Deterministic planning. AI never decides whether a timetable is feasible.

Rules: a 7-day horizon in the student's time zone, deadline-first, 25-minute
sessions followed by 5-minute breaks that count against the daily budget, a cap
per pace, no sessions in the past, no overlap with completed sessions, and an
explicit, actionable warning whenever work does not fit.
"""
from datetime import timedelta

from django.utils import timezone

from .models import Assignment, StudySession, Subtask

PACE_CAP = {'gentle': 60, 'balanced': 240, 'focused': 360}
SESSION = 25
BREAK = 5
HORIZON = 7


def _now(today=None, now_minute=None):
    if today is None or now_minute is None:
        now = timezone.localtime()
        today = today or now.date()
        now_minute = now.hour * 60 + now.minute if now_minute is None else now_minute
    return today, now_minute


def propose_plan(user, profile, today=None, now_minute=None):
    today, now_minute = _now(today, now_minute)
    capacity = min(profile.daily_minutes, PACE_CAP.get(profile.energy, 240))
    day_end = max(profile.start_hour + 1, min(profile.end_hour or 22, 23)) * 60
    cursor, ends = {}, {}
    for i in range(HORIZON):
        day = today + timedelta(days=i)
        start = profile.start_hour * 60
        if i == 0:
            start = max(start, ((now_minute + 9) // 10) * 10)
        completed = list(StudySession.objects.filter(user=user, date=day, completed=True))
        used = sum(s.minutes + BREAK for s in completed)
        cursor[day] = max([start] + [s.start_minute + s.minutes + BREAK for s in completed])
        ends[day] = min(cursor[day] + max(0, capacity - used), day_end)
    sessions, alerts = [], []
    assignments = sorted(Assignment.objects.filter(user=user, completed=False).prefetch_related('steps'),
                         key=lambda a: (a.due, a.priority != 'high', a.id))
    for a in assignments:
        steps = sorted(a.steps.all(), key=lambda s: (s.order, s.id))
        items = [(s.id, s.title, s.minutes) for s in steps if not s.completed] if steps else [(None, a.title, a.minutes)]
        missed = StudySession.objects.filter(user=user, assignment=a, date__lt=today, completed=False).exists()
        if a.due < today:
            alerts.append({'kind': 'overdue', 'assignment_id': a.id, 'title': a.title,
                           'message': f'{a.title}: the deadline has passed. The plan offers catch-up time but does not move the official deadline. You might ask your lecturer what is still possible.'})
        if missed:
            alerts.append({'kind': 'missed', 'assignment_id': a.id, 'title': a.title,
                           'message': f'{a.title}: some earlier sessions did not happen. That is normal; the remaining work is included again here.'})
        short = 0
        latest = max(today, a.due)
        for sid, title, total in items:
            done = sum(StudySession.objects.filter(user=user, assignment=a, subtask_id=sid, completed=True).values_list('minutes', flat=True))
            remaining = max(0, total - done)
            for day in cursor:
                if day > latest:
                    break
                while remaining and ends[day] - cursor[day] >= 5:
                    duration = min(SESSION, remaining, ends[day] - cursor[day])
                    sessions.append({'assignment_id': a.id, 'subtask_id': sid, 'title': title, 'date': str(day), 'start_minute': cursor[day], 'minutes': duration})
                    cursor[day] += duration + BREAK
                    remaining -= duration
            short += remaining
        if short:
            alerts.append({'kind': 'infeasible', 'assignment_id': a.id, 'title': a.title, 'minutes_short': short,
                           'message': f'{a.title}: about {short} minutes do not fit before the deadline with your current availability and pace.',
                           'options': ['reduce_scope', 'adjust_availability', 'draft_request']})
    unfinished = StudySession.objects.filter(user=user, completed=False, date__gte=today).count()
    kept = StudySession.objects.filter(user=user, completed=True).count()
    return {'sessions': sessions[:300], 'alerts': alerts, 'capacity': capacity, 'created_date': str(today),
            'replaces': unfinished, 'keeps_completed': kept}


def quick_start(user, minutes):
    """'I have 20 minutes. Help me begin.' Picks one real next step, deterministically."""
    today = timezone.localdate()
    open_steps = (Subtask.objects.filter(assignment__user=user, assignment__completed=False, completed=False)
                  .select_related('assignment').order_by('assignment__due', 'assignment_id', 'order', 'id'))
    step = open_steps.first()
    if step:
        a = step.assignment
        target = step.title
        fits = step.minutes <= minutes
    else:
        a = Assignment.objects.filter(user=user, completed=False).order_by('due', 'id').first()
        if not a:
            return {'kind': 'empty', 'message': 'Nothing is waiting on your list. You could add an assignment, or use the time to review one concept in the Library.'}
        target = f'Open the brief for {a.title} and list what it asks for'
        fits = True
    work = max(5, minutes - 5)
    plan = [
        {'minutes': 2, 'text': 'Settle in: close one distracting tab and open what you need.'},
        {'minutes': work - 3 if work > 8 else work, 'text': target if fits else f'Make a start on: {target}. You do not need to finish it today.'},
        {'minutes': 3, 'text': 'Write one line about where you stopped, so next time is easier.'},
    ]
    if work <= 8:
        plan = plan[1:2]
    due_in = (a.due - today).days
    return {'kind': 'step', 'assignment_id': a.id, 'assignment': a.title, 'step_id': step.id if step else None,
            'goal': target[:200], 'minutes': minutes, 'plan': plan, 'due_in': due_in}
