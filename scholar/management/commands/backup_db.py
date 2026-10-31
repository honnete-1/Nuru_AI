import sqlite3
from pathlib import Path
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

class Command(BaseCommand):
    help = 'Create a consistent SQLite backup using the SQLite backup API.'

    def add_arguments(self, parser):
        parser.add_argument('destination')

    def handle(self, *args, **options):
        source = Path(settings.DATABASES['default']['NAME']).resolve()
        target = Path(options['destination']).resolve()
        if source == target or target.exists():
            raise CommandError('Choose a new destination, different from the live database.')
        target.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
            src.backup(dst)
        target.chmod(0o600)
        self.stdout.write(self.style.SUCCESS('Backup completed. Store it securely; it contains private records.'))
