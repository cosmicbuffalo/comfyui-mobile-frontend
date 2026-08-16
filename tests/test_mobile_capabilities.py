import json
import pathlib
import re

from mobile_capabilities import API_VERSION, NODE_VERSION, build_capabilities

_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _pyproject_version() -> str:
    # Deliberately regex rather than tomllib: tomllib is 3.11+, and the node
    # supports 3.10 (ComfyUI's own floor). One `version = "..."` line under
    # [project] is all we need, so a parser dependency isn't worth it.
    text = (_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*["\']([^"\']+)["\']', text, re.MULTILINE)
    assert match, "version not found in pyproject.toml"
    return match.group(1)


def test_node_version_matches_pyproject():
    assert NODE_VERSION == _pyproject_version()


def test_every_declared_version_agrees():
    """The app gates on nodeVersion, so a stale bump anywhere reads as an older
    node than the user actually installed. 3.1.3 shipped with constants.ts still
    on 3.1.2; this keeps every declaration in lockstep."""
    package = json.loads((_ROOT / "package.json").read_text(encoding="utf-8"))
    package_lock = json.loads(
        (_ROOT / "package-lock.json").read_text(encoding="utf-8")
    )
    constants = (_ROOT / "src" / "constants.ts").read_text(encoding="utf-8")
    match = re.search(r"APP_VERSION\s*=\s*'([^']+)'", constants)
    assert match, "APP_VERSION not found in src/constants.ts"
    assert {
        NODE_VERSION,
        _pyproject_version(),
        package["version"],
        package_lock["version"],
        package_lock["packages"][""]["version"],
        match.group(1),
    } == {
        NODE_VERSION
    }


def test_capabilities_report_versioned_native_push_state():
    capabilities = build_capabilities(
        app_push_available=True,
        app_push_pairing_enabled=False,
        relay_origins=["https://relay-b.example", "https://relay-a.example"],
    )
    assert capabilities == {
        "apiVersion": API_VERSION,
        "nodeVersion": NODE_VERSION,
        "features": {
            "nativeShareQueue": {
                "available": True,
                "apiVersion": 1,
            },
            "nativeAppPush": {
                "available": True,
                "pairingEnabled": False,
                "relayOrigins": [
                    "https://relay-a.example",
                    "https://relay-b.example",
                ],
            },
        },
    }
