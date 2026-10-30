from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone

from scholar.models import Material


class Command(BaseCommand):
    help = 'Delete expired sample workspaces (7 days without login), including any files they uploaded.'

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=7)
        users = User.objects.filter(profile__is_demo=True, last_login__lt=cutoff)
        count = users.count()
        for m in Material.objects.filter(user__in=users):
            m.delete()
        users.delete()
        self.stdout.write(self.style.SUCCESS(f'Deleted {count} expired demo workspaces.'))
