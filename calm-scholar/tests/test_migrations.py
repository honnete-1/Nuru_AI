"""Upgrading an existing Calm Scholar database keeps every record (brief section 2)."""
import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone


@pytest.mark.django_db(transaction=True)
def test_existing_records_survive_the_upgrade():
    executor = MigrationExecutor(connection)
    executor.migrate([('scholar', '0001_initial')])
    old = executor.loader.project_state([('scholar', '0001_initial')]).apps
    User = old.get_model('auth', 'User')
    u = User.objects.create(username='longtime')
    old.get_model('scholar', 'Profile').objects.create(user=u, display_name='Long-time student')
    a = old.get_model('scholar', 'Assignment').objects.create(user=u, title='Old essay', course='History', due=timezone.localdate(), minutes=60)
    old.get_model('scholar', 'Subtask').objects.create(assignment=a, title='Old step', minutes=20, completed=True)
    old.get_model('scholar', 'CheckIn').objects.create(user=u, mood='okay', energy='balanced', note='kept')

    executor = MigrationExecutor(connection)
    executor.loader.build_graph()
    executor.migrate(executor.loader.graph.leaf_nodes())
    from scholar.models import Assignment, CheckIn, Profile, Subtask
    a2 = Assignment.objects.get(title='Old essay')
    assert a2.course_ref.name == 'History' and a2.course_ref.user_id == u.id
    assert Subtask.objects.get(title='Old step').completed and Subtask.objects.get(title='Old step').stage == 'explore'
    assert CheckIn.objects.get().note == 'kept'
    p = Profile.objects.get(user_id=u.id)
    assert p.onboarded and p.companion_name == 'Nuru' and p.remember_chat is False
    # 0004 (Study Together) adds fields without touching existing values
    assert a2.working_notes == '' and p.avatar == {} and p.resume == {}
