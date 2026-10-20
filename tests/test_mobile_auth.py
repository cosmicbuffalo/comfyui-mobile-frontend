"""The soft dependency on the optional auth node.

The single most important property: a server WITHOUT comfyui-multiuser installed
must behave exactly as it always has. The second: a server WITH it installed but
broken must not silently revert to global access — that would turn a failed auth
layer into an open one.


Note: `scope_path` used to be part of this contract and is gone. It was a
no-op that outlived the behaviour it advertised — the auth node dropped it
from its public API, and the only apparent callers here were a local
parameter of the same name in file_utils.py.
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
    assert mobile_auth.can_manage_hidden()
    assert not mobile_auth.register_hidden_file_provider(lambda paths, user: [])
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
    assert mobile_auth.can_access_model("public/x.safetensors")
    assert not mobile_auth.can_access_model("private/x.safetensors")
    assert mobile_auth.filter_files(["users/u1/a.png", "users/u2/b.png"]) == [
        "users/u1/a.png"
    ]


def test_installed_but_switched_off_reports_disabled():
    _install_fake_auth_node(is_enabled=lambda: False)
    assert not mobile_auth.is_enabled()
    assert mobile_auth.can_manage_hidden()


def test_old_provider_keeps_existing_hidden_behavior():
    _install_fake_auth_node()
    assert mobile_auth.can_manage_hidden()
    assert not mobile_auth.register_hidden_file_provider(lambda paths, user: [])


def test_old_provider_has_no_workflow_or_model_registration():
    _install_fake_auth_node()
    assert not mobile_auth.register_hidden_workflow_provider(lambda paths, user: [])
    assert not mobile_auth.register_hidden_model_provider(lambda paths, user: [])


def test_workflow_and_model_registration_delegate_when_installed():
    recorded = []
    api = _install_fake_auth_node(
        register_hidden_workflow_provider=lambda provider: recorded.append(
            ('workflow', provider)),
        register_hidden_model_provider=lambda provider: recorded.append(
            ('model', provider)),
    )
    assert mobile_auth.register_hidden_workflow_provider(lambda paths, user: [])
    assert mobile_auth.register_hidden_model_provider(lambda paths, user: [])
    assert [kind for kind, _ in recorded] == ['workflow', 'model']


def test_user_deleted_hook_is_inert_without_the_auth_node():
    # No account announcements possible without the node; the sweep simply
    # never runs, which is the pre-hook behaviour.
    assert not mobile_auth.register_user_deleted_hook(lambda uid: None)


def test_user_deleted_hook_is_inert_on_an_old_auth_node():
    _install_fake_auth_node()  # deliberately without the hook attribute
    assert not mobile_auth.register_user_deleted_hook(lambda uid: None)


def test_user_deleted_hook_delegates_when_installed():
    registered = []
    _install_fake_auth_node(register_user_deleted_hook=registered.append)
    hook = lambda uid: None
    assert mobile_auth.register_user_deleted_hook(hook)
    assert registered == [hook]


def test_a_raising_user_deleted_hook_registration_is_reported_not_fatal():
    def broken(_hook):
        raise RuntimeError("registry went away")

    api = _install_fake_auth_node(register_user_deleted_hook=broken)
    assert not mobile_auth.register_user_deleted_hook(lambda uid: None)


def test_hidden_capability_delegates_and_errors_deny():
    api = _install_fake_auth_node(can_manage_hidden=lambda user=None: False)
    assert not mobile_auth.can_manage_hidden()
    api.can_manage_hidden = _boom
    assert not mobile_auth.can_manage_hidden()


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

# --- public route registration --------------------------------------------


def test_the_presence_probe_is_registered_with_the_gate():
    recorded = []
    _install_fake_auth_node(
        allow_public_route=lambda method, path, source=None: recorded.append(
            (method, path, source)
        )
    )
    assert mobile_auth.allow_public_route("GET", "/mobile/api/presence")
    # The source is how an operator reading a boot log knows which node opened
    # the hole, so it is part of the call, not decoration.
    assert recorded == [("GET", "/mobile/api/presence",
                        "comfyui-mobile-frontend")]


def test_registering_is_a_no_op_without_the_auth_node():
    """No gate, so the route already answers; there is nothing to exempt."""
    assert mobile_auth.allow_public_route("GET", "/mobile/api/presence") is False


def test_an_auth_node_predating_the_registry_leaves_the_probe_gated():
    """Refusing to force ourselves open is the right failure: the probe stays
    behind the gate, which is where every other route of ours already is."""
    _install_fake_auth_node()  # no allow_public_route attribute
    assert mobile_auth.allow_public_route("GET", "/mobile/api/presence") is False


def test_a_refused_registration_is_reported_and_survived(capsys):
    def refuse(method, path, source=None):
        raise ValueError("admin-only routes cannot be made public")

    _install_fake_auth_node(allow_public_route=refuse)
    assert mobile_auth.allow_public_route("GET", "/manager/queue/install") is False
    assert "refused" in capsys.readouterr().out


def test_an_attribute_error_inside_allow_public_route_is_a_refusal(capsys):
    """An AttributeError raised INSIDE a present allow_public_route is a bug
    or refusal to report — not evidence that the auth node predates the
    registration API, which used to swallow it silently."""
    def broken(method, path, source=None):
        raise AttributeError("internal bug in the auth node")

    _install_fake_auth_node(allow_public_route=broken)
    assert mobile_auth.allow_public_route("GET", "/mobile/api/presence") is False
    assert "refused" in capsys.readouterr().out


def test_a_raising_provider_registration_never_propagates(capsys):
    """Registration happens at node load; a raising register() must be
    reported and answered False, never allowed to take the node down."""
    def register(provider):
        raise RuntimeError("registry exploded")

    _install_fake_auth_node(register_hidden_file_provider=register)
    assert mobile_auth.register_hidden_file_provider(
        lambda paths, user: []) is False
    assert "register_hidden_file_provider" in capsys.readouterr().out


def test_raising_workflow_and_model_registrations_never_propagate():
    def register(provider):
        raise RuntimeError("registry exploded")

    _install_fake_auth_node(
        register_hidden_workflow_provider=register,
        register_hidden_model_provider=register,
    )
    assert mobile_auth.register_hidden_workflow_provider(
        lambda paths, user: []) is False
    assert mobile_auth.register_hidden_model_provider(
        lambda paths, user: []) is False


# --- model_role_tags: display metadata, never on the deny path --------------


def test_role_tags_are_empty_without_the_auth_node():
    assert mobile_auth.model_role_tags(["loras/x.safetensors"]) == {}


def test_role_tags_come_through_when_the_auth_node_reports_them():
    _install_fake_auth_node(model_role_tags=lambda rels: {
        rels[0]: {"roles": ["nsfw"], "restricted": True}})
    assert mobile_auth.model_role_tags(["loras/x.safetensors"]) == {
        "loras/x.safetensors": {"roles": ["nsfw"], "restricted": True}}


def test_role_tags_are_empty_on_an_auth_node_predating_the_call():
    _install_fake_auth_node()          # no model_role_tags attribute
    assert mobile_auth.model_role_tags(["loras/x.safetensors"]) == {}


def test_role_tags_are_empty_when_the_gate_is_switched_off():
    _install_fake_auth_node(is_enabled=lambda: False,
                            model_role_tags=lambda rels: {"x": {}})
    assert mobile_auth.model_role_tags(["loras/x.safetensors"]) == {}


def test_a_raising_auth_node_costs_a_badge_and_nothing_more():
    """The one helper here deliberately off the deny path: an empty answer
    loses a badge, and access was already decided by can_access_model."""
    def explode(rels):
        raise RuntimeError("rules table unreadable")

    _install_fake_auth_node(model_role_tags=explode)
    assert mobile_auth.model_role_tags(["loras/x.safetensors"]) == {}


def test_a_nonsense_answer_is_discarded_rather_than_handed_on():
    _install_fake_auth_node(model_role_tags=lambda rels: ["not", "a", "dict"])
    assert mobile_auth.model_role_tags(["loras/x.safetensors"]) == {}

# --- who may flip server-wide switches ---------------------------------------


def test_anyone_may_change_server_settings_without_the_auth_node():
    assert mobile_auth.may_change_server_settings()


@pytest.mark.parametrize("user, allowed", [
    ({"id": "u1", "roles": ["admin"]}, True),
    ({"id": "u1", "roles": ["Admin"]}, True),
    ({"id": "u1", "roles": ["user"]}, False),
    ({"id": "u1"}, False),
    (None, False),
])
def test_only_an_admin_may_change_server_settings_under_multiuser(user, allowed):
    _install_fake_auth_node(current_user=lambda: user)
    assert mobile_auth.may_change_server_settings() is allowed


def test_a_broken_auth_node_may_not_change_server_settings():
    def broken():
        raise RuntimeError("auth layer down")
    _install_fake_auth_node(is_enabled=broken)
    assert not mobile_auth.may_change_server_settings()
