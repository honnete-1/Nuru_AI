from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models

# Uploaded course materials live outside every public/static directory and are
# only served through an authenticated, owner-scoped view.
private_storage = FileSystemStorage(location=str(settings.PRIVATE_MEDIA_ROOT), base_url=None)


def get_private_storage():
    """Callable so migrations never record a machine-specific upload path."""
    return private_storage

PACES = [('gentle', 'Gentle'), ('balanced', 'Balanced'), ('focused', 'Focused')]
STAGES = [('discover', 'Discover'), ('explore', 'Explore'), ('practice', 'Practice'), ('create', 'Create'), ('reflect', 'Reflect')]


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    display_name = models.CharField(max_length=60, default='Scholar')
    daily_minutes = models.PositiveIntegerField(default=120)
    start_hour = models.PositiveIntegerField(default=16)
    end_hour = models.PositiveIntegerField(default=22)
    energy = models.CharField(max_length=12, default='balanced')  # the student's chosen pace
    timezone = models.CharField(max_length=64, blank=True, default='')
    remember_chat = models.BooleanField(default=False)
    share_workload = models.BooleanField(default=False)
    use_memory = models.BooleanField(default=True)
    reminders = models.BooleanField(default=True)
    is_demo = models.BooleanField(default=False)
    onboarded = models.BooleanField(default=False)
    companion_name = models.CharField(max_length=30, default='Nuru')
    companion_hue = models.CharField(max_length=12, default='amber')  # amber | lavender | sage
    celebration = models.CharField(max_length=12, default='gentle')  # quiet | gentle | sparkle
    motion = models.CharField(max_length=12, default='system')  # system | reduce | full
    avatar = models.JSONField(default=dict, blank=True)  # {skin, hair, outfit}: the student's seat in Study Together
    resume = models.JSONField(default=dict, blank=True)  # where we stopped: {kind, id, step_id, topic, at}


class Room(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='room')
    theme = models.CharField(max_length=12, default='auto')  # auto | day | evening
    scenery = models.CharField(max_length=12, default='garden')  # garden | city | rain
    lamp = models.CharField(max_length=12, default='warm')  # warm | soft | off
    sound = models.CharField(max_length=12, default='off')  # off | rain | hearth
    placed = models.JSONField(default=list, blank=True)  # decoration keys the student chose to display


class Course(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=80)
    goal = models.CharField(max_length=240, blank=True)
    colour = models.CharField(max_length=12, default='lavender')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'name')]


class Assignment(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    title = models.CharField(max_length=160)
    course = models.CharField(max_length=80, default='My course')
    course_ref = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, related_name='assignments')
    description = models.TextField(blank=True)
    due = models.DateField()
    minutes = models.PositiveIntegerField(default=90)
    priority = models.CharField(max_length=12, default='normal')
    completed = models.BooleanField(default=False)
    working_notes = models.TextField(blank=True)  # the student's own notebook page for this assignment
    created_at = models.DateTimeField(auto_now_add=True)


class Subtask(models.Model):
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE, related_name='steps')
    title = models.CharField(max_length=180)
    minutes = models.PositiveIntegerField(default=25)
    completed = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)
    stage = models.CharField(max_length=12, choices=STAGES, default='explore')


class StudySession(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    assignment = models.ForeignKey(Assignment, on_delete=models.CASCADE)
    subtask = models.ForeignKey(Subtask, on_delete=models.CASCADE, null=True)
    date = models.DateField()
    start_minute = models.PositiveIntegerField()
    minutes = models.PositiveIntegerField()
    title = models.CharField(max_length=180)
    completed = models.BooleanField(default=False)


class CheckIn(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    mood = models.CharField(max_length=20)
    energy = models.CharField(max_length=12)
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ChatMessage(models.Model):
    """Only written when the student has opted into saved history."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(max_length=12)
    content = models.TextField()
    mode = models.CharField(max_length=12, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class FocusLog(models.Model):
    """Self-reported focus time. A record of time, not proof of learning."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    assignment = models.ForeignKey(Assignment, on_delete=models.SET_NULL, null=True)
    subtask = models.ForeignKey(Subtask, on_delete=models.SET_NULL, null=True, blank=True)
    minutes = models.PositiveIntegerField()
    goal = models.CharField(max_length=200, blank=True)
    clearer = models.TextField(blank=True)
    next_step = models.CharField(max_length=200, blank=True)
    client_token = models.CharField(max_length=40, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)


class MemoryItem(models.Model):
    """Explicit, student-approved learning memory. Never inferred silently."""
    KINDS = [('goal', 'Learning goal'), ('preference', 'Explanation preference'), ('revisit', 'Concept to revisit'), ('course', 'Course note')]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    kind = models.CharField(max_length=12, choices=KINDS)
    text = models.CharField(max_length=240)
    created_at = models.DateTimeField(auto_now_add=True)


class Material(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, related_name='materials')
    title = models.CharField(max_length=160)
    kind = models.CharField(max_length=8)  # note | txt | pdf
    file = models.FileField(storage=get_private_storage, upload_to='materials/%Y/%m/', blank=True)
    original_name = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=12, default='ready')  # ready | no_text | error
    status_detail = models.CharField(max_length=300, blank=True)
    pages = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def delete(self, *args, **kwargs):
        stored = self.file.name if self.file else None
        result = super().delete(*args, **kwargs)
        if stored:
            private_storage.delete(stored)
        return result


class Passage(models.Model):
    """An exact extracted chunk of a material. Citations always point here."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    material = models.ForeignKey(Material, on_delete=models.CASCADE, related_name='passages')
    page = models.PositiveIntegerField(null=True, blank=True)
    ordinal = models.PositiveIntegerField(default=0)
    text = models.TextField()


class Concept(models.Model):
    """Practice record. attempted → practiced → checked; no mastery percentages."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=12, default='attempted')
    next_review = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'name')]


class RevisionSession(models.Model):
    """One 'Revise with Nuru' sitting: recall first, feedback, a related question, then a summary."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True)
    concept = models.ForeignKey(Concept, on_delete=models.SET_NULL, null=True, blank=True)
    topic = models.CharField(max_length=120)
    material_ids = models.JSONField(default=list, blank=True)
    minutes = models.PositiveIntegerField(default=20)
    assessment_date = models.DateField(null=True, blank=True)
    confidence = models.CharField(max_length=12, blank=True)  # self-reported: low | some | good
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class CheckAttempt(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    concept = models.ForeignKey(Concept, on_delete=models.CASCADE, related_name='attempts')
    revision = models.ForeignKey(RevisionSession, on_delete=models.SET_NULL, null=True, blank=True, related_name='attempts')
    question = models.TextField()
    answer = models.TextField()
    feedback = models.TextField()
    verdict = models.CharField(max_length=12)  # on_track | partly | not_yet
    mode = models.CharField(max_length=12)  # live | demo | fallback
    flagged = models.BooleanField(default=False)
    flag_note = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class ResultEntry(models.Model):
    """Private Results Journal entry. Never public, never ranked, never rewarded."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    assignment = models.ForeignKey(Assignment, on_delete=models.SET_NULL, null=True, blank=True)
    title = models.CharField(max_length=160)
    course = models.CharField(max_length=80, blank=True)
    result_kind = models.CharField(max_length=8)  # percent | points | text | none
    score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    out_of = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    result_text = models.CharField(max_length=60, blank=True)
    goal = models.CharField(max_length=60, blank=True)
    feedback = models.TextField(blank=True)
    feeling = models.CharField(max_length=14, blank=True)
    feeling_words = models.CharField(max_length=200, blank=True)
    support = models.CharField(max_length=14, blank=True)
    helped = models.TextField(blank=True)
    next_focus = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class RewardEvent(models.Model):
    """Deterministic, idempotent milestone. The model can never create one."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    key = models.CharField(max_length=60)
    kind = models.CharField(max_length=14)  # participation | understanding | time
    decoration = models.CharField(max_length=30)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'key')]
