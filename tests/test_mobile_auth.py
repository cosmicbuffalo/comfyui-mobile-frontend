"""The soft dependency on the optional auth node.

The single most important property: a server WITHOUT comfyui-multiuser installed
must behave exactly as it always has. The second: a server WITH it installed but
broken must not silently revert to global access — that would turn a failed auth
layer into an open one.
"""
import sys
import types

import pytest

import mobile_auth


@pytest.fixture(autouse=True)
def _clear_cache():
    mobile_auth.reset_cache()
    yield
    sys.modules.pop("comfyui_multiuser.api", None)
    sys.modules.pop("comfyui_multiuser", None)
    mobile_auth.reset_cache()


def _install_fake_auth_node(**overrides):
    """Register a stand-in comfyui_multiuser.api in sys.modules."""
    package = types.ModuleType("comfyui_multiuser")
    api = types.ModuleType("comfyui_multiuser.api")
    defaults = {
        "is_enabled": lambda: True,
        "current_user": lambda: {"id": "u1", "username": "tester"},
        "scope_path": lambda kind, path: f"users/u1/{path}",
        "can_access_model": lambda rel: rel.startswith("public/"),
        "filter_files": lambda paths, user=None: [p for p in paths if p.startswith("users/u1/")],
        "can_read_file": lambda path, user=None: path.startswith("users/u1/"),
        "badge_for_file": lambda path, user=None: {"globe": False},
    }
    defaults.update(overrides)
    for name, value in defaults.items():
        setattr(api, name, value)
    package.api = api
    sys.modules["comfyui_multiuser"] = package
    sys.modules["comfyui_multiuser.api"] = api
    return api


# --- auth node absent (the common case) -----------------------------------


def test_disabled_when_the_auth_node_is_not_installed():
    assert not mobile_auth.is_enabled()
    assert mobile_auth.current_user() is None


def test_every_helper_is_a_no_op_without_the_auth_node():
    assert mobile_auth.scope_path("output", "a/b.png") == "a/b.png"
    assert mobile_auth.can_access_model("loras/private/secret.safetensors")
    assert mobile_auth.filter_files(["a.png", "b.png"]) == ["a.png", "b.png"]


def test_filter_files_accepts_any_iterable_and_returns_a_list():
    assert mobile_auth.filter_files(iter(["a.png"])) == ["a.png"]


def test_absence_is_cached_rather_than_retried_per_call(monkeypatch):
    calls = []
    real_import = mobile_auth.importlib.import_module

    def counting_import(name, *args, **kwargs):
        calls.append(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(mobile_auth.importlib, "import_module", counting_import)
    for _ in range(5):
        mobile_auth.is_enabled()
    assert calls.count("comfyui_multiuser.api") == 1


# --- auth node present ----------------------------------------------------


def test_delegates_to_the_auth_node_when_installed():
    _install_fake_auth_node()
    assert mobile_auth.is_enabled()
    assert mobile_auth.current_user()["username"] == "tester"
    assert mobile_auth.scope_path("output", "a.png") == "users/u1/a.png"
    assert mobile_auth.can_access_model("public/x.safetensors")
    assert not mobile_auth.can_access_model("private/x.safetensors")
    assert mobile_auth.filter_files(["users/u1/a.png", "users/u2/b.png"]) == [
        "users/u1/a.png"
    ]


def test_installed_but_switched_off_reports_disabled():
    _install_fake_auth_node(is_enabled=lambda: False)
    assert not mobile_auth.is_enabled()


# --- auth node present but broken (must not fail open) --------------------


def _boom(*args, **kwargs):
    raise RuntimeError("auth backend down")


def test_a_broken_auth_node_still_reports_enabled():
    # Reporting "disabled" here would put every other helper back on its
    # permissive path, i.e. a crashed auth layer would open the server.
    _install_fake_auth_node(is_enabled=_boom)
    assert mobile_auth.is_enabled()


def test_a_broken_filter_hides_everything_rather_than_disclosing():
    _install_fake_auth_node(filter_files=_boom)
    assert mobile_auth.filter_files(["users/u1/a.png", "users/u2/b.png"]) == []


def test_a_broken_model_check_denies():
    _install_fake_auth_node(can_access_model=_boom)
    assert not mobile_auth.can_access_model("public/x.safetensors")


def test_a_broken_current_user_is_anonymous_not_a_crash():
    _install_fake_auth_node(current_user=_boom)
    assert mobile_auth.current_user() is None


def test_a_broken_scope_path_leaves_the_path_alone():
    # scope_path is a tidiness/attribution mechanism, not the access boundary
    # (that is filter_files / can_access_model), so failing it closed would
    # break writes without buying any safety.
    _install_fake_auth_node(scope_path=_boom)
    assert mobile_auth.scope_path("output", "a.png") == "a.png"


def test_new_contract_functions_degrade_without_the_auth_node():
    assert mobile_auth.can_read_file("anything.png") is True
    assert mobile_auth.badge_for_file("anything.png") is None


def test_can_read_file_falls_back_when_the_auth_node_predates_the_contract():
    # Upgrading this node alone must not lock a user out of their own outputs.
    api = _install_fake_auth_node()
    del api.can_read_file
    assert mobile_auth.can_read_file("users/u1/a.png") is True


def test_a_broken_read_check_denies():
    _install_fake_auth_node(can_read_file=_boom)
    assert mobile_auth.can_read_file("users/u1/a.png") is False


# --- folder badges (folder-level isolation) --------------------------------


def test_folder_badges_pass_through_without_the_auth_node():
    assert mobile_auth.folder_badges(["private", "shared"]) == {}


def test_folder_badges_relay_verdicts_from_the_auth_node():
    _install_fake_auth_node(
        folder_badges=lambda paths, tree="output", user=None: {
            "private": {"visible": False, "owned": False,
                        "globe": False, "avatarUserId": "u2"},
        }
    )
    badges = mobile_auth.folder_badges(["private", "unassigned"])
    assert badges["private"]["visible"] is False
    assert "unassigned" not in badges


def test_folder_badges_hide_nothing_when_the_auth_node_predates_them():
    # An older auth node without folder_badges: folders stay visible (their
    # contents are still filtered file-by-file) instead of locking out.
    _install_fake_auth_node()
    assert mobile_auth.folder_badges(["private"]) == {}


def test_folder_badges_swallow_auth_node_errors():
    def boom(paths, tree="output", user=None):
        raise RuntimeError("db locked")
    _install_fake_auth_node(folder_badges=boom)
    assert mobile_auth.folder_badges(["private"]) == {}
