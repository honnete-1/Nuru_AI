from django.contrib import admin

from .models import Assignment, Course, Profile, Room, StudySession, Subtask

# Conversations, check-in notes, results, memory and uploaded materials are deliberately
# not registered here. (A database administrator can still technically read them.)
admin.site.register([Assignment, Subtask, StudySession, Profile, Course, Room])
