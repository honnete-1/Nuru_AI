"""Fictional sample data for the isolated demo workspace only (explicit request)."""
from datetime import timedelta

from django.utils import timezone

from .models import Assignment, CheckAttempt, Concept, Course, Material, Passage, ResultEntry, Subtask
from . import retrieval

NOTE = """Photosynthesis converts light energy into chemical energy stored in glucose. It takes place mainly in the chloroplasts of leaf cells.

The light-dependent reactions happen in the thylakoid membranes. They split water, release oxygen, and produce ATP and NADPH.

The Calvin cycle happens in the stroma. It uses ATP and NADPH to fix carbon dioxide into sugars. It does not need light directly, but it depends on the products of the light-dependent reactions.

Limiting factors include light intensity, carbon dioxide concentration and temperature. Increasing one factor only raises the rate until another factor becomes limiting."""


def seed_demo(user):
    today = timezone.localdate()
    bio = Course.objects.create(user=user, name='Plant Biology (sample)', goal='Understand photosynthesis well enough to explain it.', colour='sage')
    se = Course.objects.create(user=user, name='Software Engineering (sample)', colour='lavender')
    examples = [
        ('Design a student support platform', se, 3, 120, 'high', 'Write a 1500-word design report for a support platform, including user journeys and a risk section.',
         [('Read the brief and list the required sections', 'discover'), ('Sketch two user journeys', 'explore'), ('Outline the risk section', 'practice'), ('Draft the report in your own words', 'create'), ('Check against the rubric', 'reflect')]),
        ('Lab write-up: rate of photosynthesis', bio, 5, 90, 'normal', 'Explain how light intensity affected oxygen production in the pondweed experiment.',
         [('Re-read the method and results table', 'discover'), ('Explain limiting factors in your own words', 'practice'), ('Draft the discussion section', 'create')]),
    ]
    for title, course, days, minutes, priority, brief, steps in examples:
        a = Assignment.objects.create(user=user, title=title, course=course.name, course_ref=course, description=brief, due=today + timedelta(days=days), minutes=minutes, priority=priority)
        for i, (name, stage) in enumerate(steps):
            Subtask.objects.create(assignment=a, title=name, minutes=minutes // len(steps), order=i, stage=stage)
    m = Material.objects.create(user=user, course=bio, title='Lecture 4 notes: photosynthesis (sample)', kind='note')
    Passage.objects.bulk_create([Passage(user=user, material=m, page=pg, ordinal=i, text=t) for i, (pg, t) in enumerate(retrieval.extract('note', NOTE))])
    ResultEntry.objects.create(user=user, title='Quiz 2: cell structure (sample)', course=bio.name, result_kind='points', score=14, out_of=20,
                               feedback='Good labelling. Explanations of organelle function were brief; link structure to function.', feeling='mixed')
    c = Concept.objects.create(user=user, name='Limiting factors', course=bio, status='attempted', next_review=today)
    CheckAttempt.objects.create(user=user, concept=c, question='Why does increasing light stop raising the rate at some point?', answer='Because something else runs out.',
                                feedback='Sample record.', verdict='self_unsure', mode='demo')
