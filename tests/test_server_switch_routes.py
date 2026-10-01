"""Server-wide switches (telemetry, CivitAI lookups) through /mobile/api.

Under multiuser they belong to the admin: any signed-in user can POST
preferences, so the route itself must drop a switch a non-admin sends.
"""
import asyncio
from types import SimpleNamespace

import pytest

import mobile_routes_push as routes


class _Request:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


@pytest.fixture
def stored(monkeypatch):
    """What reaches the preferences store; env overrides off, telemetry on."""
    calls = []
    monkeypatch.setattr(routes._mobile_app_prefs, "set_prefs", lambda body: calls.append(body) or body)
    monkeypatch.setattr(routes, "web", SimpleNamespace(json_response=lambda body, status=200: (status, body)))
    monkeypatch.setattr(routes._mobile_telemetry, "env_override", lambda: None)
    monkeypatch.setattr(routes._mobile_telemetry, "is_enabled", lambda: True)
    return calls


def _as(monkeypatch, admin):
    monkeypatch.setattr(routes._mobile_auth, "may_change_server_settings", lambda: admin)


def test_a_non_admin_cannot_flip_telemetry(stored, monkeypatch):
    _as(monkeypatch, admin=False)
    asyncio.run(routes.api_app_prefs_set(_Request({"telemetryEnabled": False, "autocompleteEnabled": True})))
    assert stored == [{"autocompleteEnabled": True}]


def test_an_admin_can_flip_telemetry(stored, monkeypatch):
    _as(monkeypatch, admin=True)
    asyncio.run(routes.api_app_prefs_set(_Request({"telemetryEnabled": False})))
    assert stored == [{"telemetryEnabled": False}]


@pytest.mark.parametrize("admin", [True, False])
def test_telemetry_status_says_whether_this_user_may_change_it(stored, monkeypatch, admin):
    _as(monkeypatch, admin)
    monkeypatch.setattr(routes._mobile_telemetry, "status", lambda: {"enabled": True, "forcedByEnvironment": False})
    status, body = asyncio.run(routes.api_telemetry_status(_Request(None)))
    assert status == 200
    assert body["adminOnly"] is (not admin)
