import json

import pytest
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import Client

from scholar.models import Profile, Room


@pytest.fixture(autouse=True)
def isolated(settings, tmp_path):
    """Every test gets an empty cache and its own private upload folder; never a real key."""
    cache.clear()
    settings.PRIVATE_MEDIA_ROOT = tmp_path / 'private'
    settings.OPENAI_API_KEY = ''
    from scholar import models
    models.private_storage.location = str(tmp_path / 'private')
    models.private_storage._location = str(tmp_path / 'private')
    for attr in ('base_location', 'location'):
        models.private_storage.__dict__.pop(attr, None)
    yield


def make_student(username='student'):
    u = User.objects.create_user(username, password='A-secure-example-823!')
    Profile.objects.create(user=u, display_name=username.title(), start_hour=9, onboarded=True)
    Room.objects.create(user=u, placed=['reading_lamp', 'succulent'])
    return u


@pytest.fixture
def student(db):
    return make_student()


@pytest.fixture
def client(student):
    c = Client()
    c.force_login(student)
    return c


def post(client, action, **data):
    return client.post('/api/action/', data=json.dumps({'action': action, **data}), content_type='application/json')
