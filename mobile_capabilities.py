"""Versioned native-app contract exposed at ``/mobile/api/capabilities``.

Keep this module free of ComfyUI imports so release tooling and unit tests can
verify the contract without booting a server. ``NODE_VERSION`` intentionally
matches pyproject.toml; the backend test suite locks that invariant.
"""

API_VERSION = 1
NODE_VERSION = "3.2.1"


def build_capabilities(*, app_push_available: bool,
                       app_push_pairing_enabled: bool,
                       relay_origins: list[str]) -> dict:
    return {
        "apiVersion": API_VERSION,
        "nodeVersion": NODE_VERSION,
        "features": {
            "nativeShareQueue": {
                "available": True,
                "apiVersion": 1,
            },
            "nativeAppPush": {
                "available": bool(app_push_available),
                "pairingEnabled": bool(app_push_pairing_enabled),
                "relayOrigins": sorted(set(relay_origins)),
            },
        },
    }
