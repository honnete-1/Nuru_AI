"""Small, deterministic keepsake loop.

Each rule is tied to a real academic action and evaluated from database
records, so re-running it can never grant a milestone twice
(unique (user, key) constraint + get_or_create). Grades, check-ins, chat volume
and clicks on the companion are deliberately NOT inputs. Nothing is ever taken
away after absence.
"""
from django.db import IntegrityError, transaction

from .models import Assignment, Concept, FocusLog, RevisionSession, RewardEvent, Subtask

STARTER = ['reading_lamp', 'succulent']

CATALOG = {
    'reading_lamp': {'name': 'Brass reading lamp', 'kind': 'starter', 'why': 'Here from your first visit.'},
    'succulent': {'name': 'Small succulent', 'kind': 'starter', 'why': 'Here from your first visit.'},
    'trailing_fern': {'name': 'Trailing fern', 'kind': 'participation', 'why': 'You completed your first assignment step.'},
    'tea_set': {'name': 'Teapot and cup', 'kind': 'time', 'why': 'You saved your first focus session. (Time studied, self-reported.)'},
    'paper_garland': {'name': 'Folded-paper garland', 'kind': 'participation', 'why': 'You wrote your first focus reflection.'},
    'brass_clock': {'name': 'Little brass clock', 'kind': 'time', 'why': 'You saved five focus sessions. (Time studied, self-reported.)'},
    'desk_globe': {'name': 'Desk globe', 'kind': 'understanding', 'why': 'You passed an understanding check that was evaluated, not self-reported.'},
    'star_chart': {'name': 'Star chart', 'kind': 'participation', 'why': 'You finished a whole assignment.'},
    'index_cards': {'name': 'Stack of revision cards', 'kind': 'participation', 'why': 'You finished a revision session with Nuru.'},
}

RULES = [
    ('first_step', 'trailing_fern', 'participation', lambda u: Subtask.objects.filter(assignment__user=u, completed=True).exists()),
    ('first_focus', 'tea_set', 'time', lambda u: FocusLog.objects.filter(user=u).exists()),
    ('first_reflection', 'paper_garland', 'participation', lambda u: FocusLog.objects.filter(user=u).exclude(clearer='').exists()),
    ('five_focus', 'brass_clock', 'time', lambda u: FocusLog.objects.filter(user=u).count() >= 5),
    ('first_checked', 'desk_globe', 'understanding', lambda u: Concept.objects.filter(user=u, status='checked').exists()),
    ('first_assignment', 'star_chart', 'participation', lambda u: Assignment.objects.filter(user=u, completed=True).exists()),
    ('first_revision', 'index_cards', 'participation', lambda u: RevisionSession.objects.filter(user=u, finished_at__isnull=False, attempts__isnull=False).exists()),
]


def evaluate(user):
    """Grant any newly earned milestones. Returns the list of new decoration keys."""
    new = []
    have = set(RewardEvent.objects.filter(user=user).values_list('key', flat=True))
    for key, decoration, kind, rule in RULES:
        if key in have or not rule(user):
            continue
        try:
            with transaction.atomic():
                _, created = RewardEvent.objects.get_or_create(user=user, key=key, defaults={'decoration': decoration, 'kind': kind})
        except IntegrityError:
            created = False
        if created:
            new.append(decoration)
            room = getattr(user, 'room', None)
            if room is not None and decoration not in room.placed:
                room.placed = room.placed + [decoration]
                room.save(update_fields=['placed'])
    return new


def unlocked(user):
    return STARTER + list(RewardEvent.objects.filter(user=user).order_by('created_at').values_list('decoration', flat=True))
