"""Shared pytest fixtures for recipe-agent-memory server tests."""
import sys
import os

import dotenv
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

FAKE_ENV = {
    "AGORA_APP_ID": "test_app_id",
    "AGORA_APP_CERTIFICATE": "test_app_certificate",
}


@pytest.fixture
def fake_env(monkeypatch):
    """Neutralize dotenv and inject required env vars."""
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: False)
    for key, value in FAKE_ENV.items():
        monkeypatch.setenv(key, value)
    yield FAKE_ENV
