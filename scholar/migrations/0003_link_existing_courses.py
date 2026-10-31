"""Preserve existing records: create a Course for every course name already used
on an assignment, link it, and mark existing accounts as already onboarded."""
from django.db import migrations


def forwards(apps, schema_editor):
    Assignment = apps.get_model('scholar', 'Assignment')
    Course = apps.get_model('scholar', 'Course')
    Profile = apps.get_model('scholar', 'Profile')
    for a in Assignment.objects.filter(course_ref__isnull=True):
        name = (a.course or 'My course')[:80]
        course, _ = Course.objects.get_or_create(user_id=a.user_id, name=name)
        a.course_ref_id = course.id
        a.save(update_fields=['course_ref'])
    Profile.objects.update(onboarded=True)


class Migration(migrations.Migration):
    dependencies = [('scholar', '0002_sanctuary')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
