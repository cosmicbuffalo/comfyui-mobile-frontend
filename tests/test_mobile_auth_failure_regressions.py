"""Auth failures must remain distinct from an absent optional provider."""
import types

import pytest

import mobile_auth


@pytest.fixture(autouse=True)
def isolated_adapter(monkeypatch):
    monkeypatch.setattr(mobile_auth, "_resolved", True)
    monkeypatch.setattr(mobile_auth, "_warned", False)
    monkeypatch.setattr(mobile_auth, "_api", types.SimpleNamespace(is_enabled=lambda: True))


def test_an_explicit_read_denial_is_preserved():
    mobile_auth._api.can_read_file = lambda path, user=None: False
    assert mobile_auth.can_read_file("other-user/private.png") is False


def test_internal_attribute_error_in_read_permission_denies_access():
    def broken_read(path, user=None):
        raise AttributeError("auth record is missing an internal attribute")

    mobile_auth._api.can_read_file = broken_read
    assert mobile_auth.is_enabled() is True
    assert mobile_auth.can_read_file("other-user/private.png") is False


def test_internal_attribute_error_in_modify_permission_denies_access():
    def broken_modify(path, user=None):
        raise AttributeError("ownership record is missing an internal attribute")

    mobile_auth._api.can_modify_file = broken_modify
    mobile_auth._api.can_read_file = lambda path, user=None: True
    assert mobile_auth.can_modify_file("shared-but-not-owned.png") is False


@pytest.mark.parametrize("error", [
    RuntimeError("auth module initialization failed"),
    ModuleNotFoundError("auth dependency missing", name="auth_database_driver"),
    ImportError("auth dependency has an incompatible API"),
])
def test_broken_auth_import_does_not_disable_permission_checks(monkeypatch, error):
    def broken_import(name):
        raise error

    monkeypatch.setattr(mobile_auth, "_resolved", False)
    monkeypatch.setattr(mobile_auth, "importlib", types.SimpleNamespace(import_module=broken_import))
    assert mobile_auth.is_enabled() is True
    assert mobile_auth.can_read_file("other-user/private.png") is False
