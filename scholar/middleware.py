import zoneinfo
from django.utils import timezone


class StudentTimezoneMiddleware:
    """Plan dates and times in the student's own time zone when they set one."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        tz = None
        user = getattr(request, 'user', None)
        if user is not None and user.is_authenticated:
            name = getattr(getattr(user, 'profile', None), 'timezone', '')
            if name:
                try:
                    tz = zoneinfo.ZoneInfo(name)
                except (zoneinfo.ZoneInfoNotFoundError, ValueError):
                    tz = None
        if tz:
            timezone.activate(tz)
        else:
            timezone.deactivate()
        return self.get_response(request)
